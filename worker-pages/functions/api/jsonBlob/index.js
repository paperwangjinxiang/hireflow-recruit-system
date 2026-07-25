/**
 * Pages Function: POST /api/jsonBlob 创建 blob（JSONBlob 兼容）
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}
const MAX_BODY = 512 * 1024

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost({ request, env }) {
  const body = await request.text()
  if (body.length > MAX_BODY) {
    return jsonErr('payload too large', 413)
  }
  try { JSON.parse(body) } catch { return jsonErr('invalid json', 400) }
  const id = crypto.randomUUID()
  await env.BLOBS.put(id, body)
  return new Response(body, {
    status: 201,
    headers: { ...CORS, 'Content-Type': 'application/json', 'X-jsonblob-id': id, 'Location': `/api/jsonBlob/${id}` },
  })
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
