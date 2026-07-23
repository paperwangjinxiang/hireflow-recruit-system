import type { Interview, Job, Resume, User } from '@/types'

/**
 * 云端数据同步：默认使用免注册的公共 JSON 存储（JSONBlob）。
 * JSONBlob 匿名层单个 blob 上限 10KB，因此团队共享数据
 * 先 gzip 压缩 + base64，再分片为多个 blob 存储，由 manifest blob 索引。
 * 支持在设置中替换为自定义端点（任何支持 GET / PUT JSON 的存储均可，
 * 自定义端点使用 v1 整体存储格式，不做分片）。
 */

export interface SharedState {
  users: User[]
  resumes: Resume[]
  interviews: Interview[]
  jobs: Job[]

}

export interface RemotePayload {
  version: 1
  updatedAt: number
  origin: string
  state: SharedState | null
}

interface ManifestV2 {
  version: 2
  updatedAt: number
  origin: string
  encoding: 'gzip-b64-chunks'
  parts: string[]
}

const API_BASE = 'https://jsonblob.com/api/jsonBlob'

/** 团队共享数据库 manifest（部署时预创建，所有访问者共用） */
export const DEFAULT_SYNC_URL = `${API_BASE}/019f8c84-bf00-75f4-8101-ee3ded50fd4c`

const SYNC_URL_KEY = 'hireflow-sync-url'
const CLIENT_ID_KEY = 'hireflow-client-id'
/** 单个分片的最大字符数（blob 上限 10KB，留足余量） */
const CHUNK_SIZE = 8000

export function getSyncUrl(): string {
  return localStorage.getItem(SYNC_URL_KEY) || DEFAULT_SYNC_URL
}

export function setSyncUrl(url: string) {
  if (url.trim()) localStorage.setItem(SYNC_URL_KEY, url.trim())
  else localStorage.removeItem(SYNC_URL_KEY)
}

export function isCustomSyncUrl(): boolean {
  return !!localStorage.getItem(SYNC_URL_KEY)
}

export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 带退避重试的 fetch：遇到 429 限流时按 3s / 8s / 15s 退避重试，其余错误直接放弃 */
async function fetchWithRetry(input: string, init: RequestInit, retries = 3): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(input, { ...init, signal: AbortSignal.timeout(15000) })
      if (resp.status === 429 && attempt < retries) {
        await sleep(attempt === 0 ? 3000 : attempt === 1 ? 8000 : 15000)
        continue
      }
      return resp
    } catch {
      if (attempt < retries) {
        await sleep(2000)
        continue
      }
      return null
    }
  }
  return null
}

// ---- gzip + base64 编解码（浏览器原生 CompressionStream） ----

async function compressToB64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

async function decompressFromB64(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** 是否为默认分片端点（自定义端点走 v1 整体格式） */
function isDefaultEndpoint(): boolean {
  return getSyncUrl() === DEFAULT_SYNC_URL
}

/** 创建分片 blob，返回其 id；失败返回 null */
async function createChunk(chunk: string): Promise<string | null> {
  const resp = await fetchWithRetry(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(chunk),
  })
  if (!resp || resp.status !== 201) return null
  const id = resp.headers.get('X-jsonblob-id') ?? resp.headers.get('Location')?.split('/').pop()
  return id ?? null
}

async function fetchChunk(id: string): Promise<string | null> {
  const resp = await fetchWithRetry(`${API_BASE}/${id}`, { headers: { Accept: 'application/json' }, cache: 'no-store' }, 2)
  if (!resp || !resp.ok) return null
  try {
    const data = await resp.json()
    return typeof data === 'string' ? data : null
  } catch {
    return null
  }
}

async function deleteChunk(id: string): Promise<void> {
  await fetchWithRetry(`${API_BASE}/${id}`, { method: 'DELETE' }, 0)
}

/** 拉取云端数据；网络失败返回 undefined，成功返回 payload（可能为空库） */
export async function pullRemote(): Promise<RemotePayload | undefined> {
  const resp = await fetchWithRetry(getSyncUrl(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }, 1)
  if (!resp || !resp.ok) return undefined
  let data: unknown
  try {
    data = await resp.json()
  } catch {
    return undefined
  }

  // v2 分片格式（仅默认端点）
  const manifest = data as ManifestV2
  if (manifest?.version === 2 && Array.isArray(manifest.parts)) {
    const chunks: string[] = []
    for (const id of manifest.parts) {
      const chunk = await fetchChunk(id)
      if (chunk === null) return undefined // 分片缺失视为本次拉取失败，下轮重试
      chunks.push(chunk)
    }
    try {
      const text = await decompressFromB64(chunks.join(''))
      const state = JSON.parse(text) as SharedState
      return { version: 1, updatedAt: manifest.updatedAt, origin: manifest.origin, state }
    } catch {
      return undefined
    }
  }

  // v1 整体格式（自定义端点或历史数据）
  const legacy = data as RemotePayload
  if (typeof legacy?.updatedAt !== 'number') return { version: 1, updatedAt: 0, origin: '', state: null }
  return legacy
}

/** 推送本地数据到云端；成功返回 updatedAt，失败返回 null */
export async function pushRemote(state: SharedState, origin: string): Promise<number | null> {
  const updatedAt = Date.now()

  // 自定义端点：保持 v1 整体存储
  if (!isDefaultEndpoint()) {
    const payload: RemotePayload = { version: 1, updatedAt, origin, state }
    const resp = await fetchWithRetry(getSyncUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    return resp && resp.ok ? updatedAt : null
  }

  // 默认端点：gzip + 分片
  try {
    const b64 = await compressToB64(JSON.stringify(state))
    const chunks: string[] = []
    for (let i = 0; i < b64.length; i += CHUNK_SIZE) chunks.push(b64.slice(i, i + CHUNK_SIZE))

    // 记录旧分片以便推送成功后清理
    let oldParts: string[] = []
    const prevResp = await fetchWithRetry(getSyncUrl(), { headers: { Accept: 'application/json' }, cache: 'no-store' }, 1)
    if (prevResp?.ok) {
      try {
        const prev = await prevResp.json()
        if (prev?.version === 2 && Array.isArray(prev.parts)) oldParts = prev.parts
      } catch {
        // 忽略
      }
    }

    const partIds: string[] = []
    for (const chunk of chunks) {
      const id = await createChunk(chunk)
      if (!id) return null // 已创建的分片留作垃圾，下轮覆盖后清理
      partIds.push(id)
    }

    const manifest: ManifestV2 = { version: 2, updatedAt, origin, encoding: 'gzip-b64-chunks', parts: partIds }
    const resp = await fetchWithRetry(getSyncUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(manifest),
    })
    if (!resp || !resp.ok) return null

    // 清理旧分片（尽力而为，不影响主流程）
    for (const id of oldParts) deleteChunk(id)
    return updatedAt
  } catch {
    return null
  }
}
