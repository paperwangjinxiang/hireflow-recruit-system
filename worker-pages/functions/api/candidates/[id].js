/**
 * Pages Function: /api/candidates/:id 的 GET / PUT / DELETE
 *   GET    返回完整记录（含加密 doc）
 *   PUT    body {doc, index:{...}} 更新 doc + 索引列（updated_at 服务端刷新，created_at 保留）
 *   DELETE 删除记录及 FTS 索引
 */
import { CORS, requireAuth } from '../_auth.js'
const MAX_BODY = 512 * 1024
const INDEX_COLS = ['name', 'cert_level', 'cert_subject', 'school', 'grad_year', 'stage', 'owner', 'status', 'tags', 'search_text']

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet({ request, env, params }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  if (params.id === 'bulk') return jsonErr('not found', 404)
  const row = await env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(params.id).first()
  if (row === null) return jsonErr('candidate not found', 404)
  return new Response(JSON.stringify(row), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export async function onRequestPut({ request, env, params }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  if (params.id === 'bulk') return jsonErr('reserved id', 400)
  const body = await request.text()
  if (body.length > MAX_BODY) return jsonErr('payload too large', 413)
  let data
  try { data = JSON.parse(body) } catch { return jsonErr('invalid json', 400) }
  if (typeof data.doc !== 'string' || !data.doc) return jsonErr('doc required', 400)
  const existing = await env.DB.prepare('SELECT id FROM candidates WHERE id = ?').bind(params.id).first()
  if (existing === null) return jsonErr('candidate not found', 404)
  const idx = (data.index && typeof data.index === 'object') ? data.index : {}
  const now = Date.now()
  const stmts = [
    env.DB.prepare(
      `UPDATE candidates SET doc = ?, name = ?, cert_level = ?, cert_subject = ?, school = ?,
       grad_year = ?, stage = ?, owner = ?, status = ?, tags = ?, search_text = ?, updated_at = ?
       WHERE id = ?`
    ).bind(data.doc, ...INDEX_COLS.map((c) => normalize(c, idx[c])), now, params.id),
    env.DB.prepare('DELETE FROM candidates_fts WHERE id = ?').bind(params.id),
    env.DB.prepare('INSERT INTO candidates_fts (id, search_text) VALUES (?, ?)')
      .bind(params.id, typeof idx.search_text === 'string' ? idx.search_text : ''),
  ]
  await env.DB.batch(stmts)
  return new Response(JSON.stringify({ id: params.id, ok: true }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export async function onRequestDelete({ request, env, params }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  if (params.id === 'bulk') return jsonErr('not found', 404)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM candidates WHERE id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM candidates_fts WHERE id = ?').bind(params.id),
  ])
  return new Response(JSON.stringify({ deleted: true }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function normalize(col, val) {
  if (val === undefined || val === null) return col === 'status' ? 'active' : null
  if (col === 'grad_year') { const n = parseInt(val, 10); return Number.isFinite(n) ? n : null }
  if (col === 'tags') return typeof val === 'string' ? val : JSON.stringify(val)
  return String(val)
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
