/**
 * Pages Function: /api/files/* — R2 文件读取/删除（catch-all 路由处理 key 中的斜杠）
 *   GET    /api/files/resumes/xxx-yyy.pdf  按存储的 Content-Type 返回（支持 PDF 预览）
 *   DELETE /api/files/resumes/xxx-yyy.pdf  删除
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet({ env, params }) {
  if (!env.BUCKET && !env.BLOBS) return jsonErr('no storage configured', 501)
  const key = keyOf(params)
  if (!key) return jsonErr('key required', 400)
  const headers = { ...CORS }
  let body = null
  if (env.BUCKET) {
    const obj = await env.BUCKET.get(key)
    if (obj === null) return jsonErr('file not found', 404)
    body = obj.body
    headers['Content-Type'] = (obj.httpMetadata && obj.httpMetadata.contentType) || guessType(key)
  } else {
    const { value, metadata } = await env.BLOBS.getWithMetadata(`file:${key}`, 'arrayBuffer')
    if (value === null) return jsonErr('file not found', 404)
    body = value
    headers['Content-Type'] = (metadata && metadata.mime) || guessType(key)
  }
  headers['Content-Disposition'] = `inline; filename="${encodeURIComponent(key.split('/').pop())}"`
  headers['Cache-Control'] = 'private, max-age=3600'
  return new Response(body, { status: 200, headers })
}

export async function onRequestDelete({ env, params }) {
  if (!env.BUCKET && !env.BLOBS) return jsonErr('no storage configured', 501)
  const key = keyOf(params)
  if (!key) return jsonErr('key required', 400)
  if (env.BUCKET) await env.BUCKET.delete(key)
  else await env.BLOBS.delete(`file:${key}`)
  return new Response(JSON.stringify({ deleted: true }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function keyOf(params) {
  const parts = params.key
  let key = Array.isArray(parts) ? parts.join('/') : String(parts || '')
  try { key = decodeURIComponent(key) } catch { /* 保持原样 */ }
  if (!key || key.includes('..')) return null
  return key
}

function guessType(key) {
  const ext = key.split('.').pop().toLowerCase()
  const map = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain; charset=utf-8', json: 'application/json' }
  return map[ext] || 'application/octet-stream'
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
