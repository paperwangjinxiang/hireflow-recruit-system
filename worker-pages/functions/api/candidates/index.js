/**
 * Pages Function: /api/candidates — 候选人分表存储（D1）
 * 表 candidates(id TEXT PK, doc TEXT, 明文索引列..., created_at, updated_at)
 * FTS5 虚表 candidates_fts(id UNINDEXED, search_text) 同步维护
 *
 *   GET  /api/candidates  分页列表（只返回索引字段，不返回 doc）
 *     参数: page(默认1) size(默认50,最大200) stage owner(owner=none 表示总库未锁定)
 *           status(默认active) cert_subject cert_level q(搜索词) sort(updated_at_desc默认/updated_at_asc/name)
 *     返回 {total, page, size, items:[...]}
 *   POST /api/candidates  创建，body {id, doc, index:{name, cert_level, ...}} → 201 {id, ok:true}
 */
import { CORS, requireAuth } from '../_auth.js'
const MAX_BODY = 512 * 1024
const MAX_SIZE = 200

const INDEX_COLS = ['name', 'cert_level', 'cert_subject', 'school', 'grad_year', 'stage', 'owner', 'status', 'tags', 'search_text']

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet({ request, env }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  const url = new URL(request.url)
  const sp = url.searchParams
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  const size = Math.min(MAX_SIZE, Math.max(1, parseInt(sp.get('size') || '50', 10) || 50))
  const where = []
  const binds = []

  const status = sp.get('status') || 'active'
  where.push('status = ?'); binds.push(status)

  const stage = sp.get('stage')
  if (stage) { where.push('stage = ?'); binds.push(stage) }

  const owner = sp.get('owner')
  if (owner === 'none') { where.push("(owner IS NULL OR owner = '')") }
  else if (owner) { where.push('owner = ?'); binds.push(owner) }

  const certSubject = sp.get('cert_subject')
  if (certSubject) { where.push('cert_subject = ?'); binds.push(certSubject) }
  const certLevel = sp.get('cert_level')
  if (certLevel) { where.push('cert_level = ?'); binds.push(certLevel) }

  const q = (sp.get('q') || '').trim()
  if (q) {
    // FTS5 中文按整词匹配（unicode61 分词），LIKE 兜底子串匹配，两者取并集
    const ftsQuery = '"' + q.replace(/"/g, ' ') + '"'
    where.push('(id IN (SELECT id FROM candidates_fts WHERE candidates_fts MATCH ?) OR search_text LIKE ?)')
    binds.push(ftsQuery, `%${q}%`)
  }

  let orderBy = 'updated_at DESC'
  const sort = sp.get('sort')
  if (sort === 'updated_at_asc') orderBy = 'updated_at ASC'
  else if (sort === 'name') orderBy = 'name ASC'

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM candidates ${whereSql}`)
    .bind(...binds).first()
  const total = totalRow ? totalRow.n : 0

  const { results } = await env.DB.prepare(
    `SELECT id, name, cert_level, cert_subject, school, grad_year, stage, owner, status, tags, created_at, updated_at
     FROM candidates ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).bind(...binds, size, (page - 1) * size).all()

  return new Response(JSON.stringify({ total, page, size, items: results || [] }), {
    status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export async function onRequestPost({ request, env }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  const body = await request.text()
  if (body.length > MAX_BODY) return jsonErr('payload too large', 413)
  let data
  try { data = JSON.parse(body) } catch { return jsonErr('invalid json', 400) }
  if (!data || typeof data.id !== 'string' || !data.id) return jsonErr('id required', 400)
  if (data.id === 'bulk') return jsonErr('reserved id', 400)
  if (typeof data.doc !== 'string' || !data.doc) return jsonErr('doc required', 400)
  const idx = (data.index && typeof data.index === 'object') ? data.index : {}
  const now = Date.now()
  const cols = INDEX_COLS.map((c) => normalize(c, idx[c]))
  const createdAt = validTs(idx.created_at) || now
  const updatedAt = validTs(idx.updated_at) || now
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO candidates (id, doc, name, cert_level, cert_subject, school, grad_year, stage, owner, status, tags, search_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(data.id, data.doc, ...cols, createdAt, updatedAt),
    env.DB.prepare('DELETE FROM candidates_fts WHERE id = ?').bind(data.id),
    env.DB.prepare('INSERT INTO candidates_fts (id, search_text) VALUES (?, ?)')
      .bind(data.id, typeof idx.search_text === 'string' ? idx.search_text : ''),
  ])
  return new Response(JSON.stringify({ id: data.id, ok: true }), {
    status: 201, headers: { ...CORS, 'Content-Type': 'application/json' },
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
