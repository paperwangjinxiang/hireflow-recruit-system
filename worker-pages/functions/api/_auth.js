/**
 * 共享鉴权模块：X-HF-Token 头与服务端 KV 中的期望值比对。
 *
 * - 期望值：env.BLOBS.get('config:api-token') = sha256(团队口令 + ':hireflow-api-token-v1') 的 hex
 * - 客户端请求头携带 X-HF-Token: <同样的 hex>
 * - 等长时序安全比较；长度不一致直接拒绝
 * - KV 未配置令牌时放行（视为鉴权未启用，避免误锁）
 * - 期望值模块级缓存 60s，避免每个请求都打 KV
 * - 下划线前缀文件不会被 Pages 当作路由
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, X-HF-Token',
  'Access-Control-Max-Age': '86400',
}

const TOKEN_KV_KEY = 'config:api-token'
const CACHE_MS = 60 * 1000
let cachedToken = null
let cachedAt = 0

async function expectedToken(env) {
  const now = Date.now()
  if (cachedAt && now - cachedAt < CACHE_MS) return cachedToken
  let value = null
  try {
    value = await env.BLOBS.get(TOKEN_KV_KEY)
  } catch {
    value = null
  }
  cachedToken = typeof value === 'string' && value.trim() ? value.trim() : null
  cachedAt = now
  return cachedToken
}

/** 等长时序安全比较；长度不同直接 false（两者都是 hex 串，长度泄露无敏感信息） */
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * 校验请求。通过（或鉴权未启用）返回 null；失败返回 401 Response。
 * 用法：const unauth = await requireAuth(request, env); if (unauth) return unauth
 */
export async function requireAuth(request, env) {
  const expected = await expectedToken(env)
  if (!expected) return null
  const got = request.headers.get('X-HF-Token') || ''
  if (timingSafeEqualStr(got, expected)) return null
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
