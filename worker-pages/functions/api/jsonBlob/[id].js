/**
 * Pages Function: /api/jsonBlob/:id 的 GET / PUT / DELETE（JSONBlob 兼容）
 * 存储后端：D1（SQLite），表 blobs(id TEXT PRIMARY KEY, content TEXT, updated_at INTEGER)
 * 响应格式与原 KV 版完全一致。
 */
import { CORS, requireAuth } from '../_auth.js'
const MAX_BODY = 512 * 1024

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet({ request, env, params }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  const row = await env.DB.prepare('SELECT content FROM blobs WHERE id = ?')
    .bind(params.id)
    .first()
  if (row === null) return jsonErr('blob not found', 404)
  return new Response(row.content, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

export async function onRequestPut({ request, env, params }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  const body = await request.text()
  if (body.length > MAX_BODY) return jsonErr('payload too large', 413)
  try { JSON.parse(body) } catch { return jsonErr('invalid json', 400) }
  await env.DB.prepare(
    'INSERT INTO blobs (id, content, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
  )
    .bind(params.id, body, Date.now())
    .run()
  return new Response(body, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

export async function onRequestDelete({ request, env, params }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  await env.DB.prepare('DELETE FROM blobs WHERE id = ?').bind(params.id).run()
  return new Response(JSON.stringify({ deleted: true }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
