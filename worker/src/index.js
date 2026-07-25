/**
 * HireFlow 存储层 Worker：JSONBlob API 兼容的 KV 存储
 *
 * 路由（与 jsonblob.com 子集一一对应，前端零改造切换）：
 *   POST   /api/jsonBlob        创建 blob，201 + X-jsonblob-id 头
 *   GET    /api/jsonBlob/:id    读取 blob，不存在返回 404
 *   PUT    /api/jsonBlob/:id    覆盖更新 blob（不存在则创建，兼容 PUT 复用推送）
 *   DELETE /api/jsonBlob/:id    删除 blob
 *
 * 安全模型与 JSONBlob 一致：id 为不可猜测 UUID（128bit），
 * 主库数据本身已用团队口令 AES-GCM 加密，投递箱内容已用 RSA 公钥加密，
 * 存储层即使被读到也只有密文。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}

/** 单 blob 上限 512KB（当前主库压缩后约 60-80KB，余量充足） */
const MAX_BODY = 512 * 1024

function jsonResponse(bodyText, status, extraHeaders = {}) {
  return new Response(bodyText, {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url = new URL(request.url)
    const match = url.pathname.match(/^\/api\/jsonBlob(?:\/([0-9a-zA-Z-]+))?\/?$/)
    if (!match) {
      return jsonResponse(JSON.stringify({ error: 'not found' }), 404)
    }
    const id = match[1]

    // 创建 blob
    if (request.method === 'POST' && !id) {
      const body = await request.text()
      if (body.length > MAX_BODY) return jsonResponse(JSON.stringify({ error: 'payload too large' }), 413)
      try { JSON.parse(body) } catch { return jsonResponse(JSON.stringify({ error: 'invalid json' }), 400) }
      const newId = crypto.randomUUID()
      await env.BLOBS.put(newId, body)
      return jsonResponse(body, 201, {
        'X-jsonblob-id': newId,
        'Location': `/api/jsonBlob/${newId}`,
      })
    }

    if (!id) return jsonResponse(JSON.stringify({ error: 'blob id required' }), 400)

    // 读取 blob
    if (request.method === 'GET') {
      const value = await env.BLOBS.get(id)
      if (value === null) return jsonResponse(JSON.stringify({ error: 'blob not found' }), 404)
      return jsonResponse(value, 200)
    }

    // 覆盖更新（不存在则创建：与 JSONBlob 行为一致，支撑 PUT 复用优化）
    if (request.method === 'PUT') {
      const body = await request.text()
      if (body.length > MAX_BODY) return jsonResponse(JSON.stringify({ error: 'payload too large' }), 413)
      try { JSON.parse(body) } catch { return jsonResponse(JSON.stringify({ error: 'invalid json' }), 400) }
      await env.BLOBS.put(id, body)
      return jsonResponse(body, 200)
    }

    // 删除
    if (request.method === 'DELETE') {
      await env.BLOBS.delete(id)
      return jsonResponse(JSON.stringify({ deleted: true }), 200)
    }

    return jsonResponse(JSON.stringify({ error: 'method not allowed' }), 405)
  },
}
