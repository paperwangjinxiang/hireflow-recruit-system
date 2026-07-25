/**
 * Pages Function: POST /api/files — 简历附件上传（R2，零知识：内容是客户端加密后的密文字节）
 * body JSON {name, mime, data_b64}（base64 编码文件内容，解码后上限 4MB）
 * 生成 key resumes/{uuid}-{安全文件名}，PUT 进 R2 绑定 BUCKET → 201 {key, ok:true}
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}
const MAX_BODY = 8 * 1024 * 1024      // JSON 信封（base64 约膨胀 4/3）
const MAX_FILE = 4 * 1024 * 1024      // 解码后文件内容上限

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost({ request, env }) {
  if (!env.BUCKET) return jsonErr('r2 not configured', 501)
  const body = await request.text()
  if (body.length > MAX_BODY) return jsonErr('payload too large', 413)
  let data
  try { data = JSON.parse(body) } catch { return jsonErr('invalid json', 400) }
  if (!data || typeof data.data_b64 !== 'string' || !data.data_b64) return jsonErr('data_b64 required', 400)
  const name = typeof data.name === 'string' && data.name ? data.name : 'file'
  const mime = typeof data.mime === 'string' && data.mime ? data.mime : 'application/octet-stream'

  let bytes
  try { bytes = b64ToBytes(data.data_b64) } catch { return jsonErr('invalid base64', 400) }
  if (bytes.length > MAX_FILE) return jsonErr('file too large (max 4MB)', 413)

  const key = `resumes/${crypto.randomUUID()}-${safeName(name)}`
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } })
  return new Response(JSON.stringify({ key, ok: true }), {
    status: 201, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function safeName(name) {
  // 保留中英文、数字、点、横线、下划线；其余替换为 -，避免路径注入
  const cleaned = name.replace(/[^\w.一-鿿-]+/g, '-').replace(/^-+|-+$/g, '')
  return (cleaned || 'file').slice(0, 120)
}

function b64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
