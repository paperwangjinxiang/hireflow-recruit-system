/**
 * Pages Function: /api/files/* — 附件读取/删除（catch-all 路由处理 key 中的斜杠）
 *   GET    /api/files/resumes/xxx-yyy.pdf  按存储的 Content-Type 返回（支持 PDF 预览）
 *   DELETE /api/files/resumes/xxx-yyy.pdf  删除
 * 存储驱动由 _storage.js 决定（OSS → R2 → KV）；响应头 X-HF-Store / JSON 字段 store 报告实际驱动。
 */
import { CORS, requireAuth } from '../_auth.js'
import { getStore } from '../_storage.js'

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

async function pickStore(env) {
  try {
    return { store: await getStore(env) }
  } catch (e) {
    if (e && e.isStoreError) return { err: jsonErr(e.message, e.status) }
    throw e
  }
}

export async function onRequestGet({ request, env, params }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  const { store, err } = await pickStore(env)
  if (err) return err
  if (!store) return jsonErr('no storage configured', 501)
  const key = keyOf(params)
  if (!key) return jsonErr('key required', 400)
  let got
  try {
    got = await store.get(key)
  } catch (e) {
    if (e && e.isStoreError) return jsonErr(e.message, e.status)
    throw e
  }
  if (got === null) return jsonErr('file not found', 404)
  const headers = { ...CORS }
  headers['Content-Type'] = got.mime || guessType(key)
  headers['Content-Disposition'] = `inline; filename="${encodeURIComponent(key.split('/').pop())}"`
  headers['Cache-Control'] = 'private, max-age=3600'
  headers['X-HF-Store'] = store.name
  return new Response(got.body, { status: 200, headers })
}

export async function onRequestDelete({ request, env, params }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  const { store, err } = await pickStore(env)
  if (err) return err
  if (!store) return jsonErr('no storage configured', 501)
  const key = keyOf(params)
  if (!key) return jsonErr('key required', 400)
  try {
    await store.del(key)
  } catch (e) {
    if (e && e.isStoreError) return jsonErr(e.message, e.status)
    throw e
  }
  return new Response(JSON.stringify({ deleted: true, store: store.name }), {
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
