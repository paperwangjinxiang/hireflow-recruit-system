import type { Interview, Job, Resume, User } from '@/types'

/**
 * 云端数据同步：默认使用免注册的公共 JSON 存储（JSONBlob），
 * 全团队共享同一份简历库。支持在设置中替换为自定义端点
 * （任何支持 GET / PUT JSON 的存储均可）。
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

/** 团队共享数据库（部署时预创建，所有访问者共用） */
export const DEFAULT_SYNC_URL = 'https://jsonblob.com/api/jsonBlob/019f8c84-bf00-75f4-8101-ee3ded50fd4c'

const SYNC_URL_KEY = 'hireflow-sync-url'
const CLIENT_ID_KEY = 'hireflow-client-id'

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

/** 拉取云端数据；网络失败返回 undefined，成功返回 payload（可能为空库） */
export async function pullRemote(): Promise<RemotePayload | undefined> {
  try {
    const resp = await fetch(getSyncUrl(), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!resp.ok) return undefined
    const data = await resp.json()
    if (typeof data?.updatedAt !== 'number') return { version: 1, updatedAt: 0, origin: '', state: null }
    return data as RemotePayload
  } catch {
    return undefined
  }
}

/** 推送本地数据到云端；成功返回 updatedAt，失败返回 null */
export async function pushRemote(state: SharedState, origin: string): Promise<number | null> {
  const payload: RemotePayload = { version: 1, updatedAt: Date.now(), origin, state }
  try {
    const resp = await fetch(getSyncUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    return resp.ok ? payload.updatedAt : null
  } catch {
    return null
  }
}
