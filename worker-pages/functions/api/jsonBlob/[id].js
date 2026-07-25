/**
 * Pages Function: /api/jsonBlob/:id 的 GET / PUT / DELETE（JSONBlob 兼容）
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

export async function onRequestGet({ env, params }) {
  const value = await env.BLOBS.get(params.id)
  if (value === null) return jsonErr('blob not found', 404)
  return new Response(value, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

export async function onRequestPut({ request, env, params }) {
  const body = await request.text()
  if (body.length > MAX_BODY) return jsonErr('payload too large', 413)
  try { JSON.parse(body) } catch { return jsonErr('invalid json', 400) }
  await env.BLOBS.put(params.id, body)
  return new Response(body, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

export async function onRequestDelete({ env, params }) {
  await env.BLOBS.delete(params.id)
  return new Response(JSON.stringify({ deleted: true }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
