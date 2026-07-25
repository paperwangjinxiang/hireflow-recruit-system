/**
 * Pages Function: POST /api/inbox/consume — HR 入库后删除已处理投递
 * body: {ids:[行id,...]} → DELETE 这些行 → 200 {deleted:n}
 */
import { CORS, requireAuth } from '../_auth.js'
const MAX_IDS = 500

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost({ request, env }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  let data
  try { data = await request.json() } catch { return jsonErr('invalid json', 400) }
  const ids = Array.isArray(data?.ids)
    ? data.ids.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_IDS)
    : []
  if (ids.length === 0) return jsonErr('ids required', 400)
  const placeholders = ids.map(() => '?').join(',')
  const result = await env.DB.prepare(`DELETE FROM inbox WHERE id IN (${placeholders})`)
    .bind(...ids)
    .run()
  return new Response(JSON.stringify({ deleted: result.meta.changes ?? 0 }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
