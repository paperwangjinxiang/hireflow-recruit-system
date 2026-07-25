/**
 * 可插拔附件存储层：getStore(env) 按优先级返回统一驱动的存储驱动。
 *
 * 优先级：
 *   ① KV `config:oss` 存在且 enabled !== false → 阿里云 OSS（REST + V1 签名）
 *   ② env.BUCKET 绑定存在 → Cloudflare R2
 *   ③ env.BLOBS 绑定存在 → KV 兜底（key 加 file: 前缀，metadata 存 mime/name/size/created）
 *
 * 驱动接口统一：
 *   name: 'oss' | 'r2' | 'kv'
 *   put(key, bytes, mime, name?)  → void
 *   get(key)                      → { body, mime } | null
 *   del(key)                      → void
 *   stats()                       → { count, totalBytes, byMonth } （kv 无此能力）
 *
 * 重要：OSS 模式下请求失败（签名错/网络错/配置错）抛 StoreError(502)，
 * 绝不静默降级 KV —— 避免同一逻辑 key 在 OSS 与 KV 双写分裂、对账失控。
 *
 * config:oss 的值（JSON，密钥只存服务端 KV，绝不进客户端）：
 *   {"provider":"aliyun","enabled":true,"bucket":"...","endpoint":"oss-cn-hangzhou.aliyuncs.com",
 *    "accessKeyId":"...","accessKeySecret":"...","prefix":"hireflow-attachments/"}
 */

const OSS_CONFIG_KV_KEY = 'config:oss'
const OSS_CACHE_MS = 60 * 1000
let ossCfgCache = null   // { cfg } | { cfg: null }
let ossCfgCachedAt = 0

/** 存储层可读错误：endpoints 捕获后按 status 返回，不泄漏密钥 */
export class StoreError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.isStoreError = true
    this.status = status
  }
}

/** 读取 KV config:oss（模块级缓存 60s，与 _auth.js 同模式） */
async function loadOssConfig(env) {
  const now = Date.now()
  if (ossCfgCachedAt && now - ossCfgCachedAt < OSS_CACHE_MS) return ossCfgCache
  let cfg = null
  try {
    const raw = env.BLOBS ? await env.BLOBS.get(OSS_CONFIG_KV_KEY) : null
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.provider === 'aliyun' && parsed.enabled !== false) {
        const missing = ['bucket', 'endpoint', 'accessKeyId', 'accessKeySecret'].filter(k => !parsed[k])
        if (missing.length) {
          throw new StoreError(`oss config incomplete: missing ${missing.join(', ')}`, 502)
        }
        cfg = {
          bucket: String(parsed.bucket),
          endpoint: String(parsed.endpoint).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
          accessKeyId: String(parsed.accessKeyId),
          accessKeySecret: String(parsed.accessKeySecret),
          prefix: typeof parsed.prefix === 'string' ? parsed.prefix : 'hireflow-attachments/',
        }
      }
    }
  } catch (e) {
    if (e && e.isStoreError) throw e
    if (e instanceof SyntaxError) throw new StoreError('oss config is not valid JSON', 502)
    cfg = null // KV 读失败按未配置处理（与 _auth.js 的放行策略一致）
  }
  ossCfgCache = cfg
  ossCfgCachedAt = now
  return cfg
}

/**
 * 按优先级返回存储驱动；全部不可用时返回 null（端点应回 501）。
 * config:oss 存在但损坏/不完整时抛 StoreError(502)（不静默降级）。
 */
export async function getStore(env) {
  const ossCfg = await loadOssConfig(env)
  if (ossCfg) return ossDriver(ossCfg)
  if (env.BUCKET) return r2Driver(env.BUCKET)
  if (env.BLOBS) return kvDriver(env.BLOBS)
  return null
}

/* ---------------- KV 驱动（兜底，行为与原实现逐字节一致） ---------------- */

function kvDriver(BLOBS) {
  return {
    name: 'kv',
    async put(key, bytes, mime, name) {
      await BLOBS.put(`file:${key}`, bytes, {
        metadata: { mime, name: name || 'file', size: bytes.length, created: Date.now() },
      })
    },
    async get(key) {
      const { value, metadata } = await BLOBS.getWithMetadata(`file:${key}`, 'arrayBuffer')
      if (value === null) return null
      return { body: value, mime: (metadata && metadata.mime) || null }
    },
    async del(key) {
      await BLOBS.delete(`file:${key}`)
    },
    // CF Pages 函数内无法列举 KV 键（需走 CF REST API，函数内没有账号凭证），无 stats
  }
}

/* ---------------- R2 驱动 ---------------- */

function r2Driver(BUCKET) {
  return {
    name: 'r2',
    async put(key, bytes, mime) {
      await BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } })
    },
    async get(key) {
      const obj = await BUCKET.get(key)
      if (obj === null) return null
      return { body: obj.body, mime: (obj.httpMetadata && obj.httpMetadata.contentType) || null }
    },
    async del(key) {
      await BUCKET.delete(key)
    },
    async stats() {
      let count = 0, totalBytes = 0
      const byMonth = {}
      let cursor
      do {
        const page = await BUCKET.list({ limit: 1000, cursor })
        for (const o of page.objects) {
          count++
          totalBytes += o.size || 0
          const m = (o.uploaded ? new Date(o.uploaded).toISOString() : '').slice(0, 7)
          if (m) byMonth[m] = (byMonth[m] || 0) + 1
        }
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
      return { count, totalBytes, byMonth }
    },
  }
}

/* ---------------- 阿里云 OSS 驱动（REST + V1 签名） ---------------- */

/**
 * OSS V1 签名，verified against OSS V1 signing docs
 * （https://help.aliyun.com/zh/oss/developer-reference/include-signatures-in-the-authorization-header）：
 *
 *   Signature = base64(hmac-sha1(AccessKeySecret,
 *     VERB + "\n" + Content-MD5 + "\n" + Content-Type + "\n" + Date + "\n"
 *     + CanonicalizedOSSHeaders + CanonicalizedResource))
 *
 * 本项目不发任何 x-oss- 头 → CanonicalizedOSSHeaders 为空串。
 * CanonicalizedResource = /{bucket}/{objectName}（raw UTF-8，不做 URL 编码）；
 * 仅 bucket 级请求为 /{bucket}/。list-type/prefix/continuation-token 等是普通
 * 请求参数而非子资源（SubResource），按官方文档不参与 CanonicalizedResource。
 */
export async function ossSign(cfg, verb, contentType, date, canonicalizedResource) {
  const stringToSign = `${verb}\n\n${contentType || ''}\n${date}\n${canonicalizedResource}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(cfg.accessKeySecret),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(stringToSign))
  let bin = ''
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b)
  return `OSS ${cfg.accessKeyId}:${btoa(bin)}`
}

/** URL 路径：逐段 encodeURIComponent（保留 '/'），兼容中文等非 ASCII object 名 */
function encodeOssPath(objectName) {
  return objectName.split('/').map(encodeURIComponent).join('/')
}

async function ossFetch(cfg, verb, objectName, { body, contentType, query } = {}) {
  const date = new Date().toUTCString() // RFC1123 GMT，OSS 要求 Date 头与签名串一致
  const resource = objectName ? `/${cfg.bucket}/${objectName}` : `/${cfg.bucket}/`
  const auth = await ossSign(cfg, verb, contentType, date, resource)
  let url = objectName
    ? `https://${cfg.bucket}.${cfg.endpoint}/${encodeOssPath(objectName)}`
    : `https://${cfg.bucket}.${cfg.endpoint}/`
  if (query) url += `?${query}`
  const headers = { Date: date, Authorization: auth }
  if (contentType) headers['Content-Type'] = contentType
  let resp
  try {
    resp = await fetch(url, { method: verb, headers, body })
  } catch (e) {
    throw new StoreError(`oss network error: ${e && e.message ? e.message : 'fetch failed'}`, 502)
  }
  if (!resp.ok && !(verb === 'GET' && resp.status === 404) && !(verb === 'HEAD' && resp.status === 404)) {
    const text = await resp.text().catch(() => '')
    const msg = (text.match(/<Message>([^<]*)<\/Message>/) || [])[1] || text.slice(0, 200) || resp.statusText
    const code = (text.match(/<Code>([^<]*)<\/Code>/) || [])[1] || ''
    throw new StoreError(`oss ${verb} failed: HTTP ${resp.status}${code ? ' ' + code : ''} ${msg}`, 502)
  }
  return resp
}

function ossDriver(cfg) {
  const fullKey = key => `${cfg.prefix}${key}` // 逻辑 key（resumes/...）不变，仅加桶内前缀
  return {
    name: 'oss',
    async put(key, bytes, mime) {
      // PUT Object：带 Content-Type，GET 时 OSS 原样返回
      await ossFetch(cfg, 'PUT', fullKey(key), { body: bytes, contentType: mime })
    },
    async get(key) {
      const resp = await ossFetch(cfg, 'GET', fullKey(key))
      if (resp.status === 404) return null
      return { body: resp.body, mime: resp.headers.get('Content-Type') || null }
    },
    async del(key) {
      await ossFetch(cfg, 'DELETE', fullKey(key))
    },
    async stats() {
      // ListObjectsV2 分页累计；list-type/prefix/continuation-token 非子资源，不参与签名
      let count = 0, totalBytes = 0
      const byMonth = {}
      let token = ''
      do {
        const q = new URLSearchParams({ 'list-type': '2', prefix: cfg.prefix, 'max-keys': '1000' })
        if (token) q.set('continuation-token', token)
        const resp = await ossFetch(cfg, 'GET', '', { query: q.toString() })
        const xml = await resp.text()
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          count++
          const size = parseInt(((m[1].match(/<Size>(\d+)<\/Size>/) || [])[1]) || '0', 10)
          totalBytes += isNaN(size) ? 0 : size
          const month = ((m[1].match(/<LastModified>([^<]+)<\/LastModified>/) || [])[1] || '').slice(0, 7)
          if (month) byMonth[month] = (byMonth[month] || 0) + 1
        }
        const trunc = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        token = trunc ? ((xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1] || '') : ''
      } while (token)
      return { count, totalBytes, byMonth }
    },
  }
}
