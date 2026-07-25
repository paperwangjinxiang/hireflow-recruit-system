/**
 * Pages Function: POST /api/ocr 云 OCR 代理（百度通用文字识别-高精度版）
 *
 * 设计要点：
 * - 密钥只存服务端：BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY 通过
 *   `npx wrangler pages secret put <NAME> --project-name=hireflow-store-api`
 *   或 Cloudflare Dashboard 配置，绝不下发客户端。
 * - 未配置密钥时返回 501 { error: 'cloud_ocr_not_configured' }，前端据此回退本地 Tesseract。
 * - access_token 有效期约 30 天，缓存进 KV（复用 BLOBS 命名空间，key: baidu_ocr_token），
 *   避免每次识别都走 client_credentials 换 token。
 * - 请求体：{ "image": "<base64>" }（PNG/JPEG 单页，容忍 dataURL 前缀），上限 4MB。
 * - 成功响应：{ "text": "拼接好的文字" }（按行换行）。
 *
 * CORS 处理方式与 functions/api/jsonBlob 保持一致（前端部署在 GitHub Pages，跨域调用）。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}

/** 单请求体上限 4MB（前端发送单页 JPEG 的 base64，正常 <1MB） */
const MAX_BODY = 4 * 1024 * 1024
/** KV 中缓存百度 access_token 的 key */
const TOKEN_KV_KEY = 'baidu_ocr_token'
/** 百度 token 提前 5 天视为过期，最长缓存 25 天（官方有效期约 30 天） */
const TOKEN_SKEW_SEC = 5 * 24 * 3600
const TOKEN_MAX_TTL_SEC = 25 * 24 * 3600

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost({ request, env }) {
  if (!env.BAIDU_OCR_API_KEY || !env.BAIDU_OCR_SECRET_KEY) {
    return jsonErr('cloud_ocr_not_configured', 501)
  }
  const body = await request.text()
  if (body.length > MAX_BODY) {
    return jsonErr('payload too large', 413)
  }
  let image
  try {
    image = JSON.parse(body)?.image
  } catch {
    return jsonErr('invalid json', 400)
  }
  if (typeof image !== 'string' || !image) {
    return jsonErr('missing image', 400)
  }
  // 容忍 dataURL 前缀（data:image/jpeg;base64,...）
  if (image.startsWith('data:')) image = image.split(',')[1] ?? ''

  try {
    const token = await getAccessToken(env)
    const text = await callBaiduOcr(token, image)
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return jsonErr(`cloud ocr failed: ${e?.message ?? e}`, 502)
  }
}

/** 取百度 access_token：先读 KV 缓存，失效再走 client_credentials 换新并回写缓存 */
async function getAccessToken(env) {
  try {
    const cached = await env.BLOBS.get(TOKEN_KV_KEY)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed?.token && typeof parsed.exp === 'number' && parsed.exp > Date.now()) {
        return parsed.token
      }
    }
  } catch {
    // 缓存不可读不致命，继续换新 token
  }
  const resp = await fetch('https://aip.baidubce.com/oauth/2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.BAIDU_OCR_API_KEY,
      client_secret: env.BAIDU_OCR_SECRET_KEY,
    }),
  })
  const data = await resp.json()
  if (!data.access_token) {
    throw new Error(`token error: ${data.error_description ?? data.error ?? 'unknown'}`)
  }
  const ttl = Math.max(60, Math.min((data.expires_in ?? 2592000) - TOKEN_SKEW_SEC, TOKEN_MAX_TTL_SEC))
  try {
    await env.BLOBS.put(
      TOKEN_KV_KEY,
      JSON.stringify({ token: data.access_token, exp: Date.now() + ttl * 1000 }),
      { expirationTtl: ttl },
    )
  } catch {
    // 缓存写入失败不影响本次识别
  }
  return data.access_token
}

/** 调百度通用文字识别（高精度版），返回按行拼接的纯文本 */
async function callBaiduOcr(token, base64) {
  // 百度要求 image 为标准 base64 后再做 URL encode；URLSearchParams 会自动转义 +/= 等字符
  const resp = await fetch(
    `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ image: base64 }),
    },
  )
  const data = await resp.json()
  if (data.error_code) {
    throw new Error(`baidu ${data.error_code}: ${data.error_msg ?? ''}`)
  }
  return (data.words_result ?? []).map((w) => w?.words ?? '').join('\n')
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
