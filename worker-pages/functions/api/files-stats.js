/**
 * Pages Function: GET /api/files-stats — 附件存储统计（用于对账，系统里有孤儿密文待清理）
 * 需鉴权（X-HF-Token）。
 * → { store: "oss"|"r2"|"kv", count, totalBytes, byMonth?, note? }
 *   - oss：ListObjectsV2 全量分页累计，返回 count/totalBytes/byMonth（按 LastModified 的 YYYY-MM 聚合）
 *   - r2 ：BUCKET.list() 分页累计，同上
 *   - kv ：Pages 函数内无账号凭证，无法走 CF REST API 列举 KV 键 → count/totalBytes 为 null，
 *          对账请用 网站开发/migrate_files_to_oss.py（--list-only）或其它带 CF token 的脚本
 */
import { CORS, requireAuth } from './_auth.js'
import { getStore } from './_storage.js'

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet({ request, env }) {
  const unauth = await requireAuth(request, env)
  if (unauth) return unauth
  let store
  try {
    store = await getStore(env)
  } catch (e) {
    if (e && e.isStoreError) return jsonErr(e.message, e.status)
    throw e
  }
  if (!store) return jsonErr('no storage configured', 501)
  if (typeof store.stats === 'function') {
    let s
    try {
      s = await store.stats()
    } catch (e) {
      if (e && e.isStoreError) return jsonErr(e.message, e.status)
      throw e
    }
    return new Response(JSON.stringify({ store: store.name, ...s }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({
    store: store.name,
    count: null,
    totalBytes: null,
    note: 'kv 模式下 Pages 函数内无法列举 KV 键（需 CF REST API + 账号 token）；'
        + '请用 网站开发/migrate_files_to_oss.py --list-only 做附件对账',
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
