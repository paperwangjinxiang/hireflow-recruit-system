/**
 * Pages Function: POST /api/candidates/bulk — 批量 upsert（迁移/批量导入用）
 * body {items:[{id, doc, index:{...}}, ...]}，单批上限 100 条，D1 batch 原子提交
 * 返回 {upserted:n}
 * 路由说明：Pages 静态路由优先于动态路由，本文件优先于 [id].js 匹配 /api/candidates/bulk
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}
const MAX_BODY = 8 * 1024 * 1024
const MAX_ITEMS = 100
const INDEX_COLS = ['name', 'cert_level', 'cert_subject', 'school', 'grad_year', 'stage', 'owner', 'status', 'tags', 'search_text']

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost({ request, env }) {
  const body = await request.text()
  if (body.length > MAX_BODY) return jsonErr('payload too large', 413)
  let data
  try { data = JSON.parse(body) } catch { return jsonErr('invalid json', 400) }
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return jsonErr('items required', 400)
  if (data.items.length > MAX_ITEMS) return jsonErr(`too many items (max ${MAX_ITEMS})`, 400)

  const now = Date.now()
  const stmts = []
  for (const item of data.items) {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.doc !== 'string' || !item.doc) {
      return jsonErr('each item requires id and doc', 400)
    }
    const idx = (item.index && typeof item.index === 'object') ? item.index : {}
    const cols = INDEX_COLS.map((c) => normalize(c, idx[c]))
    // 迁移场景允许通过 index.created_at / index.updated_at 保留原始时间戳（毫秒）
    const createdAt = validTs(idx.created_at) || now
    const updatedAt = validTs(idx.updated_at) || now
    stmts.push(env.DB.prepare(
      `INSERT INTO candidates (id, doc, name, cert_level, cert_subject, school, grad_year, stage, owner, status, tags, search_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         doc = excluded.doc, name = excluded.name, cert_level = excluded.cert_level,
         cert_subject = excluded.cert_subject, school = excluded.school, grad_year = excluded.grad_year,
         stage = excluded.stage, owner = excluded.owner, status = excluded.status,
         tags = excluded.tags, search_text = excluded.search_text, updated_at = excluded.updated_at`
    ).bind(item.id, item.doc, ...cols, createdAt, updatedAt))
    stmts.push(env.DB.prepare('DELETE FROM candidates_fts WHERE id = ?').bind(item.id))
    stmts.push(env.DB.prepare('INSERT INTO candidates_fts (id, search_text) VALUES (?, ?)')
      .bind(item.id, typeof idx.search_text === 'string' ? idx.search_text : ''))
  }
  await env.DB.batch(stmts)
  return new Response(JSON.stringify({ upserted: data.items.length }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function validTs(v) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
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
