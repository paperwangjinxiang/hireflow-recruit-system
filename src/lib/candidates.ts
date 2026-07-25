import type { Resume, Stage } from '@/types'
import { normalizeResume } from '@/lib/tags'
import { encryptJsonEnvelope, decryptJsonEnvelope, getSyncPassphrase, type SyncEnvelope } from '@/lib/sync'

/**
 * 候选人分表 API 数据层（GET/POST/PUT/DELETE /api/candidates）。
 *
 * - 列表接口只返回索引列（不含 doc），供表格/看板分页查询；
 * - 单条接口返回完整记录，doc 为 envelope v2 密文（与整库信封同一套
 *   PBKDF2('hireflow-sync-envelope-v2', 100000) → AES-GCM 方案），
 *   用本机团队同步口令解密；
 * - 写入时前端加密 doc 并同步组装明文索引列（name/cert_level/.../search_text）。
 *
 * 连续失败降级：任一请求失败计数 +1（成功清零），达到阈值或列表接口 404
 * 时触发 onDegraded 回调，由 store 切换到旧信封兼容模式。
 */

const API_BASE = 'https://hireflow-store-api.pages.dev/api/candidates'
const REQUEST_TIMEOUT_MS = 30_000
/** 连续失败达到该次数即判定新存储不可用（降级到信封兼容模式） */
const DEGRADED_THRESHOLD = 3
/** bulkUpsert 单批上限（服务端硬限制 100） */
const BULK_BATCH_SIZE = 100

// ---- 类型 ----

/** 列表查询参数（与后端 /api/candidates 对齐） */
export interface CandidateListParams {
  page?: number
  size?: number // ≤200
  stage?: Stage
  /** 'none' 表示总库（未锁定）；否则为锁定人 userId；缺省不筛选 */
  owner?: string
  status?: string // 默认 active
  certSubject?: string
  certLevel?: string
  q?: string
  sort?: 'updated_at_desc' | 'updated_at_asc' | 'name'
}

/** 索引行（camelCase 化；tags 已解析为数组） */
export interface CandidateIndexRow {
  id: string
  name: string
  certLevel: string | null
  certSubject: string | null
  school: string | null
  gradYear: number | null
  stage: Stage
  owner: string | null
  status: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface CandidateListResult {
  total: number
  page: number
  size: number
  items: CandidateIndexRow[]
}

/** 服务端原始索引行（snake_case，tags 为 JSON 字符串） */
interface RawIndexRow {
  id: string
  name: string | null
  cert_level: string | null
  cert_subject: string | null
  school: string | null
  grad_year: number | null
  stage: string | null
  owner: string | null
  status: string | null
  tags: string | null
  created_at: number | null
  updated_at: number | null
}

// ---- 降级（连续失败 → 信封兼容模式） ----

let consecutiveFailures = 0
let degraded = false
let degradeCallback: (() => void) | null = null

/** 注册降级回调（store 启动时调用一次） */
export function onCandidatesDegraded(cb: () => void): void {
  degradeCallback = cb
}

/** 是否已判定新存储不可用 */
export function isCandidatesDegraded(): boolean {
  return degraded
}

function recordSuccess(): void {
  consecutiveFailures = 0
}

function recordFailure(immediate = false): void {
  consecutiveFailures = immediate ? DEGRADED_THRESHOLD : consecutiveFailures + 1
  if (!degraded && consecutiveFailures >= DEGRADED_THRESHOLD) {
    degraded = true
    degradeCallback?.()
  }
}

/** 测试钩子/手动重置（切换回新存储时使用） */
export function resetCandidatesDegraded(): void {
  degraded = false
  consecutiveFailures = 0
}

// ---- 底层请求 ----

async function request(path: string, init: RequestInit, actionLabel: string): Promise<Response> {
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    recordFailure()
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(`${actionLabel}超时（30 秒），请检查网络后重试`)
    }
    throw new Error(`${actionLabel}失败：网络连接异常，请稍后重试`)
  }
  if (!resp.ok) {
    // 列表路由不存在（旧后端未升级）→ 立即降级
    recordFailure(resp.status === 404 && init.method === undefined)
    let serverMsg = ''
    try {
      const data = (await resp.json()) as { error?: string }
      if (typeof data?.error === 'string') serverMsg = data.error
    } catch {
      // 忽略非 JSON 错误体
    }
    if (resp.status === 404) throw new Error(`${actionLabel}失败：记录不存在或接口未上线（404）`)
    throw new Error(`${actionLabel}失败：服务器返回 ${resp.status}${serverMsg ? `（${serverMsg}）` : ''}`)
  }
  recordSuccess()
  return resp
}

// ---- doc 加解密（envelope v2，与整库信封同方案） ----

/** 加密候选人对象为 doc 密文字符串；未设置团队同步口令时抛错 */
export async function encryptDoc(candidate: Resume): Promise<string> {
  const passphrase = getSyncPassphrase()
  if (!passphrase) {
    throw new Error('未设置团队同步口令，无法加密候选人数据（请先在同步设置中输入口令）')
  }
  const envelope = await encryptJsonEnvelope(candidate, passphrase)
  if (!envelope) throw new Error('候选人数据加密失败')
  return JSON.stringify(envelope)
}

/** 解密 doc 密文为完整候选人对象；口令缺失/不匹配或数据损坏时抛中文错误 */
export async function decryptDoc(cipher: string): Promise<Resume> {
  const passphrase = getSyncPassphrase()
  if (!passphrase) {
    throw new Error('未设置团队同步口令，无法查看候选人详情（请先在同步设置中输入口令）')
  }
  let envelope: SyncEnvelope
  try {
    envelope = JSON.parse(cipher) as SyncEnvelope
  } catch {
    throw new Error('候选人数据格式异常（doc 不是合法密文）')
  }
  const plain = await decryptJsonEnvelope(envelope, passphrase)
  if (plain === null || typeof plain !== 'object') {
    throw new Error('候选人数据解密失败：口令不匹配或数据已损坏')
  }
  return normalizeResume(plain as Resume)
}

// ---- 索引列组装 ----

/** 候选人对象 → 服务端索引列（upsert 时随 doc 一起提交） */
function buildIndex(r: Resume): Record<string, unknown> {
  return {
    name: r.name,
    cert_level: r.certStage || null,
    cert_subject: r.certSubject || null,
    school: r.university || null,
    grad_year: r.gradYear > 0 ? r.gradYear : null,
    stage: r.stage,
    owner: r.lockedBy || null,
    status: 'active',
    tags: r.tags,
    // 搜索文本：姓名 + 学校 + 专业 + 技能 + 标签拼接（FTS5 整词 + LIKE 子串双通道）
    search_text: [r.name, r.university, r.major, ...r.skills, ...r.tags].filter(Boolean).join(' '),
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }
}

function toIndexRow(raw: RawIndexRow): CandidateIndexRow {
  let tags: string[] = []
  if (typeof raw.tags === 'string' && raw.tags) {
    try {
      const parsed: unknown = JSON.parse(raw.tags)
      if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
    } catch {
      // 非法 tags JSON 按空数组处理
    }
  }
  return {
    id: raw.id,
    name: raw.name ?? '',
    certLevel: raw.cert_level ?? null,
    certSubject: raw.cert_subject ?? null,
    school: raw.school ?? null,
    gradYear: typeof raw.grad_year === 'number' ? raw.grad_year : null,
    stage: (raw.stage ?? 'imported') as Stage,
    owner: raw.owner ?? null,
    status: raw.status ?? 'active',
    tags,
    createdAt: raw.created_at ?? 0,
    updatedAt: raw.updated_at ?? 0,
  }
}

/** 索引行 → 供看板卡片等场景使用的「部分字段」候选人（doc 字段为默认值，展示前应按需 get 完整数据） */
export function partialResumeFromIndex(row: CandidateIndexRow): Resume {
  const now = Date.now()
  return normalizeResume({
    id: row.id,
    name: row.name,
    phone: '',
    email: '',
    position: '',
    education: '',
    experience: 0,
    skills: [],
    source: '',
    stage: row.stage,
    assigneeId: null,
    university: row.school ?? '',
    company: '',
    certificates: [],
    tags: row.tags,
    rating: 0,
    age: 0,
    certStage: (row.certLevel ?? '') as Resume['certStage'],
    certSubject: row.certSubject ?? '',
    certQualified: false,
    certNote: '',
    gradYear: row.gradYear ?? 0,
    hometown: '',
    fullTime: '未知',
    major: '',
    idCard: '',
    rawText: '',
    jobId: null,
    lockedBy: row.owner,
    lockedAt: null,
    createdAt: row.createdAt || now,
    updatedAt: row.updatedAt || now,
    notes: [],
    activities: [],
  })
}

// ---- 公开 API ----

/** 分页查询候选人索引行（不含 doc） */
export async function list(params: CandidateListParams = {}): Promise<CandidateListResult> {
  const sp = new URLSearchParams()
  sp.set('page', String(Math.max(1, params.page ?? 1)))
  sp.set('size', String(Math.min(200, Math.max(1, params.size ?? 50))))
  if (params.stage) sp.set('stage', params.stage)
  if (params.owner) sp.set('owner', params.owner)
  if (params.status) sp.set('status', params.status)
  if (params.certSubject) sp.set('cert_subject', params.certSubject)
  if (params.certLevel) sp.set('cert_level', params.certLevel)
  if (params.q) sp.set('q', params.q)
  if (params.sort) sp.set('sort', params.sort)
  const resp = await request(`?${sp.toString()}`, {}, '加载候选人列表')
  const data = (await resp.json()) as { total?: number; page?: number; size?: number; items?: RawIndexRow[] }
  return {
    total: data.total ?? 0,
    page: data.page ?? 1,
    size: data.size ?? 50,
    items: (data.items ?? []).map(toIndexRow),
  }
}

/** 拉取单条完整记录并解密 doc，返回完整候选人对象 */
export async function get(id: string): Promise<Resume> {
  const resp = await request(`/${encodeURIComponent(id)}`, {}, '加载候选人详情')
  const data = (await resp.json()) as { doc?: string }
  if (typeof data.doc !== 'string' || !data.doc) {
    throw new Error('候选人详情加载失败：响应缺少 doc 字段')
  }
  return decryptDoc(data.doc)
}

/** 写入单条候选人（加密 doc + 组装索引列）；已存在走 PUT，不存在自动 POST 创建 */
export async function upsert(candidate: Resume): Promise<void> {
  const doc = await encryptDoc(candidate)
  const body = JSON.stringify({ id: candidate.id, doc, index: buildIndex(candidate) })
  const headers = { 'Content-Type': 'application/json' }
  try {
    await request(`/${encodeURIComponent(candidate.id)}`, { method: 'PUT', headers, body }, '保存候选人')
  } catch (e) {
    // 记录不存在 → 创建
    if (e instanceof Error && e.message.includes('404')) {
      await request('', { method: 'POST', headers, body }, '创建候选人')
      return
    }
    throw e
  }
}

/** 批量 upsert：自动按 100 条/批切分（服务端上限），返回成功写入条数 */
export async function bulkUpsert(candidates: Resume[], batchSize = BULK_BATCH_SIZE): Promise<number> {
  const size = Math.min(BULK_BATCH_SIZE, Math.max(1, batchSize))
  let written = 0
  for (let i = 0; i < candidates.length; i += size) {
    const batch = candidates.slice(i, i + size)
    const items = await Promise.all(
      batch.map(async (c) => ({ id: c.id, doc: await encryptDoc(c), index: buildIndex(c) })),
    )
    await request('/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }, `批量保存候选人（第 ${Math.floor(i / size) + 1} 批）`)
    written += batch.length
  }
  return written
}

/** 删除候选人（服务端硬删除，同时清理 FTS 索引） */
export async function remove(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' }, '删除候选人')
}

/** 健康检查：列表接口可达即视为新存储可用 */
export async function healthCheck(): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}?page=1&size=1`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    return resp.ok
  } catch {
    return false
  }
}
