import type { Interview, Job, Resume, User } from '@/types'

/**
 * 云端数据同步：默认使用免注册的公共 JSON 存储（JSONBlob）。
 * JSONBlob 匿名层单个 blob 上限 10KB，因此团队共享数据
 * 先 gzip 压缩 + base64，再分片为多个 blob 存储，由 manifest blob 索引。
 * 支持在设置中替换为自定义端点（任何支持 GET / PUT JSON 的存储均可，
 * 自定义端点使用 v1 整体存储格式，不做分片、不加密）。
 *
 * 加密（v2 envelope）：默认端点下若本机设置了「团队同步口令」，
 * 明文 state 先 gzip，再用 AES-GCM 加密（密钥由口令经 PBKDF2-SHA256 派生），
 * 打包为 envelope JSON 后再走原有的 gzip+分片流程：
 *   { v: 2, enc: true, iv: <hex>, fp: <密钥指纹>, data: <hex> }
 * envelope 本身是合法 JSON，保活脚本 cloud_keepalive.py 只做 gzip+JSON 的
 * 原样往返搬运、不解析业务字段，因此加密后保活逻辑不受影响。
 * 未设置口令前维持明文推送，避免首次启用时锁死。
 */

export interface SharedState {
  users: User[]
  resumes: Resume[]
  interviews: Interview[]
  jobs: Job[]
  /** 在线投递私钥（PKCS8 Base64）：随主库 AES 加密同步，仅管理员可配置；绝不明文回显 */
  applyPrivateKey?: string
}

export interface RemotePayload {
  version: 1
  updatedAt: number
  origin: string
  state: SharedState | null
}

interface ManifestV2 {
  version: 2
  updatedAt: number
  origin: string
  encoding: 'gzip-b64-chunks'
  parts: string[]
}

/** v3 单 blob 存储：整个压缩载荷一个 blob。拉取仅需 指针+manifest+数据 共 3 次请求
 * （v2 分片方案需 10+ 次，必踩公共存储 429 限流）；超出 SINGLE_BLOB_MAX 时回退 v2 分片 */
interface ManifestV3 {
  version: 3
  updatedAt: number
  origin: string
  encoding: 'gzip-b64-single'
  part: string
}

/** 加密信封：gzip 后的 payload 经 AES-GCM 加密（iv/data 为 hex） */
interface SyncEnvelope {
  v: 2
  enc: true
  iv: string
  /** 密钥指纹：派生密钥 SHA-256 的前 4 字节 hex，用于快速识别口令是否正确 */
  fp: string
  data: string
}

/** 拉取结果：ok=成功（可能为空库）；locked=云端已加密但本机无口令或口令不匹配；error=网络/解析失败 */
export type PullResult =
  | { status: 'ok'; payload: RemotePayload }
  | { status: 'locked'; fingerprint: string | null }
  | { status: 'error' }

/** 推送结果：pushed=成功；conflict=远端比本地新（应先拉取应用再推）；error=失败 */
export type PushResult =
  | { status: 'pushed'; updatedAt: number }
  | { status: 'conflict' }
  | { status: 'error' }

const API_BASE = 'https://hireflow-store-api.pages.dev/api/jsonBlob'

/**
 * 云端共享库 manifest 指针（部署在 GitHub Pages，永不过期）。
 * 存储后端为 Cloudflare Pages Functions + KV（2026-07-25 自 JSONBlob 迁入：
 * JSONBlob 匿名 blob 24h 过期且限流严格；KV 永久存储、限流宽松、国内可直连）。
 */
const POINTER_URL = 'https://paperwangjinxiang.github.io/hireflow-recruit-system/sync-config.json'

/** 兜底 manifest（指针不可达时使用） */
export const DEFAULT_SYNC_URL = `${API_BASE}/da886392-6355-4769-a391-f291b43f9731`

const SYNC_URL_KEY = 'hireflow-sync-url'
const CLIENT_ID_KEY = 'hireflow-client-id'
/** 团队同步口令仅存本机 localStorage，不随数据同步（口令本身绝不能上云） */
const PASSPHRASE_KEY = 'hireflow-sync-passphrase'
/** 单个分片的最大字符数。取值 24KB：远低于常见 JSON 存储的单 blob 上限（100KB~1MB），
 *  仅作为 v3 单 blob 放不下时的兜底分片大小 */
const CHUNK_SIZE = 24576
/** v3 单 blob 载荷阈值：压缩后 base64 在此长度内用单 blob（约 200KB），
 *  createChunk 失败（如服务端另有大小限制）时自动回退 v2 分片，双保险 */
const SINGLE_BLOB_MAX = 200_000
/** 同步密钥派生参数：固定盐 + 迭代次数（所有团队设备必须用相同参数才能派生出同一密钥） */
const SYNC_KDF_SALT = 'hireflow-sync-envelope-v2'
const SYNC_KDF_ITERATIONS = 100_000

/** 指针解析缓存 */
let pointerCache: { url: string; at: number } | null = null

/** 解析当前 manifest 地址：自定义端点 > 指针文件 > 兜底地址 */
export async function resolveManifestUrl(forceRefresh = false): Promise<string> {
  const custom = localStorage.getItem(SYNC_URL_KEY)
  if (custom) return custom
  if (!forceRefresh && pointerCache && Date.now() - pointerCache.at < 5 * 60 * 1000) {
    return pointerCache.url
  }
  try {
    const resp = await fetch(POINTER_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (resp.ok) {
      const data = await resp.json()
      if (typeof data?.manifestUrl === 'string' && data.manifestUrl.includes(API_BASE)) {
        pointerCache = { url: data.manifestUrl, at: Date.now() }
        return pointerCache.url
      }
    }
  } catch {
    // 指针不可达时用兜底
  }
  return DEFAULT_SYNC_URL
}

export function getSyncUrl(): string {
  return localStorage.getItem(SYNC_URL_KEY) || DEFAULT_SYNC_URL
}

export function setSyncUrl(url: string) {
  if (url.trim()) localStorage.setItem(SYNC_URL_KEY, url.trim())
  else localStorage.removeItem(SYNC_URL_KEY)
}

export function isCustomSyncUrl(): boolean {
  return !!localStorage.getItem(SYNC_URL_KEY)
}

export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}

// ---- 团队同步口令（本机存储，不上云） ----

export function getSyncPassphrase(): string {
  try {
    return localStorage.getItem(PASSPHRASE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 设置/清除团队同步口令（空字符串 = 清除，清除后回到明文推送） */
export function setSyncPassphrase(passphrase: string) {
  try {
    if (passphrase) localStorage.setItem(PASSPHRASE_KEY, passphrase)
    else localStorage.removeItem(PASSPHRASE_KEY)
  } catch {
    // 存储不可用时口令仅本次会话生效的愿望无法实现，静默忽略
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 带指数退避重试的 fetch：429 限流 / 5xx 服务端错误 / 网络错误按 1s / 3s / 9s 退避，最多重试 3 次 */
async function fetchWithRetry(input: string, init: RequestInit, retries = 3): Promise<Response | null> {
  const backoff = [1000, 3000, 9000]
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(input, { ...init, signal: AbortSignal.timeout(15000) })
      if ((resp.status === 429 || resp.status >= 500) && attempt < retries) {
        await sleep(backoff[Math.min(attempt, backoff.length - 1)])
        continue
      }
      return resp
    } catch {
      if (attempt < retries) {
        await sleep(backoff[Math.min(attempt, backoff.length - 1)])
        continue
      }
      return null
    }
  }
  return null
}

// ---- gzip + base64 编解码（浏览器原生 CompressionStream） ----

async function compressToBytes(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function compressToB64(text: string): Promise<string> {
  const bytes = await compressToBytes(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

async function decompressFromB64(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

async function decompressToBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ---- AES-GCM 加解密（密钥由团队同步口令经 PBKDF2 派生） ----

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

interface DerivedSyncKey {
  key: CryptoKey
  /** 密钥指纹（SHA-256 前 4 字节 hex），随 envelope 上云用于口令匹配校验，无法反推口令 */
  fingerprint: string
}

/** 由团队同步口令派生 AES-GCM 密钥与指纹；口令为空返回 null */
async function deriveSyncKey(passphrase: string): Promise<DerivedSyncKey | null> {
  if (!passphrase) return null
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey', 'deriveBits'],
  )
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(SYNC_KDF_SALT), iterations: SYNC_KDF_ITERATIONS },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const fpBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`${SYNC_KDF_SALT}:fp`), iterations: SYNC_KDF_ITERATIONS },
    keyMaterial,
    256,
  )
  const fingerprint = toHex(new Uint8Array(fpBits)).slice(0, 8)
  return { key, fingerprint }
}

/** 加密明文 state：json → gzip → AES-GCM → envelope */
async function encryptState(state: SharedState, passphrase: string): Promise<SyncEnvelope | null> {
  const derived = await deriveSyncKey(passphrase)
  if (!derived) return null
  const gzipped = await compressToBytes(JSON.stringify(state))
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, derived.key, gzipped as BufferSource)
  return { v: 2, enc: true, iv: toHex(iv), fp: derived.fingerprint, data: toHex(new Uint8Array(cipher)) }
}

/**
 * 解密 envelope：成功返回 state；无口令/指纹不匹配/解密失败返回 'locked'；结构异常返回 null
 */
async function decryptEnvelope(envelope: SyncEnvelope): Promise<SharedState | 'locked' | null> {
  if (typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') return null
  const passphrase = getSyncPassphrase()
  if (!passphrase) return 'locked'
  const derived = await deriveSyncKey(passphrase)
  if (!derived) return 'locked'
  // 指纹快速校验：口令错误时不必尝试解密
  if (typeof envelope.fp === 'string' && envelope.fp && envelope.fp !== derived.fingerprint) return 'locked'
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromHex(envelope.iv) as BufferSource },
      derived.key,
      fromHex(envelope.data) as BufferSource,
    )
    const textBytes = await decompressToBytes(new Uint8Array(plain))
    return JSON.parse(new TextDecoder().decode(textBytes)) as SharedState
  } catch {
    return 'locked'
  }
}

/** 判断对象是否为加密信封 */
function isEnvelope(data: unknown): data is SyncEnvelope {
  const d = data as SyncEnvelope | null
  return !!d && d.v === 2 && d.enc === true && typeof d.data === 'string'
}

/** 创建分片 blob，返回其 id；失败返回 null */
async function createChunk(chunk: string): Promise<string | null> {
  const resp = await fetchWithRetry(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(chunk),
  })
  if (!resp || resp.status !== 201) return null
  const id = resp.headers.get('X-jsonblob-id') ?? resp.headers.get('Location')?.split('/').pop()
  return id ?? null
}

async function fetchChunk(id: string): Promise<string | null> {
  const resp = await fetchWithRetry(`${API_BASE}/${id}`, { headers: { Accept: 'application/json' }, cache: 'no-store' }, 2)
  if (!resp || !resp.ok) return null
  try {
    const data = await resp.json()
    return typeof data === 'string' ? data : null
  } catch {
    return null
  }
}

async function deleteChunk(id: string): Promise<void> {
  await fetchWithRetry(`${API_BASE}/${id}`, { method: 'DELETE' }, 0)
}

/** 拉取云端数据；返回结构化结果（见 PullResult） */
export async function pullRemote(): Promise<PullResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = await resolveManifestUrl(attempt > 0)
    const resp = await fetchWithRetry(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }, 1)
    if (!resp) return { status: 'error' }
    if (resp.status === 404 && !isCustomSyncUrl() && attempt === 0) {
      continue // manifest 可能已过期，强制刷新指针重试一次
    }
    if (!resp.ok) return { status: 'error' }
    let data: unknown
    try {
      data = await resp.json()
    } catch {
      return { status: 'error' }
    }

    // v2 分片 / v3 单 blob 格式（仅默认端点）；未信任数据用宽松结构类型
    const manifest = data as { version?: number; updatedAt?: number; origin?: string; parts?: string[]; part?: string }
    const partIds: string[] | null =
      manifest?.version === 2 && Array.isArray(manifest.parts) ? manifest.parts
        : manifest?.version === 3 && typeof manifest.part === 'string' ? [manifest.part]
          : null
    if (partIds) {
      const chunks: string[] = []
      for (const id of partIds) {
        const chunk = await fetchChunk(id)
        if (chunk === null) return { status: 'error' } // 分片缺失视为本次拉取失败，下轮重试
        chunks.push(chunk)
      }
      try {
        const text = await decompressFromB64(chunks.join(''))
        const parsed: unknown = JSON.parse(text)
        // 加密信封：需要本机口令解密
        if (isEnvelope(parsed)) {
          const state = await decryptEnvelope(parsed)
          if (state === 'locked') return { status: 'locked', fingerprint: parsed.fp ?? null }
          if (state === null) return { status: 'error' }
          return { status: 'ok', payload: { version: 1, updatedAt: manifest.updatedAt ?? 0, origin: manifest.origin ?? '', state } }
        }
        // 旧明文格式：直接作为 SharedState 兼容解析
        const state = parsed as SharedState
        return { status: 'ok', payload: { version: 1, updatedAt: manifest.updatedAt ?? 0, origin: manifest.origin ?? '', state } }
      } catch {
        return { status: 'error' }
      }
    }

    // v1 整体格式（自定义端点或历史数据，明文）
    const legacy = data as RemotePayload
    if (typeof legacy?.updatedAt !== 'number') {
      return { status: 'ok', payload: { version: 1, updatedAt: 0, origin: '', state: null } }
    }
    return { status: 'ok', payload: legacy }
  }
  return { status: 'error' }
}

/**
 * 推送本地数据到云端。
 * - 推送前先 GET 远端 manifest 比对 updatedAt：远端更新（且非本端写入）时返回 conflict，
 *   调用方应先拉取应用远端数据再重新推送，避免整库覆盖别人的修改。
 * - 逻辑时钟：updatedAt = Math.max(远端updatedAt + 1, Date.now())，防止本机时钟漂移导致新旧判定失效。
 * - 本机已设置团队同步口令时（默认端点），payload 加密为 v2 envelope 后再分片推送。
 */
export async function pushRemote(state: SharedState, origin: string, knownRemoteTs = 0): Promise<PushResult> {
  // 自定义端点：保持 v1 整体存储（明文，不做冲突检测——单 blob PUT 无法原子比对）
  if (isCustomSyncUrl()) {
    const updatedAt = Math.max(knownRemoteTs + 1, Date.now())
    const payload: RemotePayload = { version: 1, updatedAt, origin, state }
    const resp = await fetchWithRetry(getSyncUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    return resp && resp.ok ? { status: 'pushed', updatedAt } : { status: 'error' }
  }

  // 默认端点：gzip + （可选加密）+ 分片
  try {
    const manifestUrl = await resolveManifestUrl()

    // 先读取旧 manifest：冲突检测 + 逻辑时钟基准 + 记录旧分片以便推送成功后清理
    let oldParts: string[] = []
    let remoteTs = 0
    let remoteOrigin = ''
    const prevResp = await fetchWithRetry(manifestUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' }, 1)
    if (!prevResp || (!prevResp.ok && prevResp.status !== 404)) {
      // 安全失败（fail-closed）：读不到远端状态（429 限流/5xx/网络故障）时绝不推送——
      // 否则冲突检测失效，本机旧数据可能整库覆盖云端更新的数据（2026-07-25 事故教训）；
      // 仅 404（manifest blob 过期被删、远端无数据）放行推送
      return { status: 'error' }
    }
    if (prevResp.ok) {
      try {
        const prev = await prevResp.json()
        if (prev?.version === 2 && Array.isArray(prev.parts)) oldParts = prev.parts
        if (prev?.version === 3 && typeof prev.part === 'string') oldParts = [prev.part]
        if (typeof prev?.updatedAt === 'number') remoteTs = prev.updatedAt
        if (typeof prev?.origin === 'string') remoteOrigin = prev.origin
      } catch {
        // 忽略
      }
    }
    // prevResp.status === 404：manifest blob 已过期被删，远端无数据，推送安全（无冲突可能）

    // 远端比别人新写入的数据：先放弃本次推送，由调用方拉取合并后再推
    if (remoteTs > knownRemoteTs && remoteOrigin && remoteOrigin !== origin) {
      return { status: 'conflict' }
    }

    // 逻辑时钟：保证本次写入的 updatedAt 一定大于远端已知的任何值
    const updatedAt = Math.max(remoteTs + 1, Date.now())

    // 已设置团队同步口令 → 加密推送；未设置维持明文（首次启用不锁死，由设置页引导 admin 配置）
    const passphrase = getSyncPassphrase()
    let payloadText: string
    if (passphrase) {
      const envelope = await encryptState(state, passphrase)
      if (!envelope) return { status: 'error' }
      payloadText = JSON.stringify(envelope)
    } else {
      payloadText = JSON.stringify(state)
    }

    const b64 = await compressToB64(payloadText)

    // v3 优先：整个载荷单 blob（请求数最少）；超阈值或服务端拒绝时回退 v2 分片
    let manifest: ManifestV2 | ManifestV3 | null = null
    const partIds: string[] = []
    if (b64.length <= SINGLE_BLOB_MAX) {
      // 复用已有数据 blob：直接 PUT 覆盖，全程 0 次 POST。
      // 实测 JSONBlob 对「POST 创建新 blob」限流远严于「PUT 更新已有 blob」（2026-07-25：
      // 浏览器端 POST 连续 429 导致同步失败，而 PUT 正常），复用可显著降低同步失败率。
      const reuseId = oldParts.length === 1 ? oldParts[0] : null
      if (reuseId) {
        const putResp = await fetchWithRetry(`${API_BASE}/${reuseId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(b64),
        })
        if (putResp && putResp.ok) {
          manifest = { version: 3, updatedAt, origin, encoding: 'gzip-b64-single', part: reuseId }
          partIds.push(reuseId)
        }
        // PUT 失败（blob 已过期被删等）→ 回落到 POST 新建
      }
      if (!manifest) {
        const singleId = await createChunk(b64)
        if (singleId) {
          manifest = { version: 3, updatedAt, origin, encoding: 'gzip-b64-single', part: singleId }
          partIds.push(singleId)
        }
      }
    }
    if (!manifest) {
      const chunks: string[] = []
      for (let i = 0; i < b64.length; i += CHUNK_SIZE) chunks.push(b64.slice(i, i + CHUNK_SIZE))
      for (const chunk of chunks) {
        const id = await createChunk(chunk)
        if (!id) return { status: 'error' } // 已创建的分片留作垃圾，下轮覆盖后清理
        partIds.push(id)
      }
      manifest = { version: 2, updatedAt, origin, encoding: 'gzip-b64-chunks', parts: partIds }
    }
    const resp = await fetchWithRetry(manifestUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(manifest),
    })
    if (!resp || !resp.ok) return { status: 'error' }

    // 清理旧分片（尽力而为，不影响主流程）；复用中的 blob 绝不能删
    for (const id of oldParts) {
      if (!partIds.includes(id)) deleteChunk(id)
    }
    return { status: 'pushed', updatedAt }
  } catch {
    return { status: 'error' }
  }
}
