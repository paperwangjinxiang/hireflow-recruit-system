/**
 * Pages Function: /api/inbox — 在线投递箱（D1 原子 INSERT，解决并发投递丢失）
 * 表 inbox(id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT, created_at INTEGER)
 *
 *   POST /api/inbox  body 为任意 JSON → INSERT 一行 → 201 {id, ok:true}
 *   GET  /api/inbox  → 200 {items:[{id, created_at, ...payload}]}（按 id 升序，上限 500 条）
 */
import { CORS, requireAuth } from '../_auth.js'
const MAX_BODY = 512 * 1024
const MAX_ITEMS = 500

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

// POST 保持公开：公开投递页面向匿名申请人
export async function onRequestPost({ request, env }) {
  const body = await request.text()
  if (body.length > MAX_BODY) return jsonErr('payload too large', 413)
  try { JSON.parse(body) } catch { return jsonErr('invalid json', 400) }
  const result = await env.DB.prepare('INSERT INTO inbox (payload, created_at) VALUES (?, ?)')
    .bind(body, Date.now())
    .run()
  return new Response(JSON.stringify({ id: result.meta.last_row_id, ok: true }), {
    status: 201,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// GET 鉴权：仅 HR 可拉取投递
export async function onRequestGet({ request, env }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  const { results } = await env.DB.prepare(
    'SELECT id, payload, created_at FROM inbox ORDER BY id ASC LIMIT ?'
  )
    .bind(MAX_ITEMS)
    .all()
  const items = (results || []).map((row) => {
    let parsed = null
    try { parsed = JSON.parse(row.payload) } catch { /* 保留原样 */ }
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 行 id / created_at 覆盖 payload 同名字段，保证 consume 可用行 id 删除
      return { ...parsed, id: row.id, created_at: row.created_at }
    }
    return { id: row.id, created_at: row.created_at, value: parsed }
  })
  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
