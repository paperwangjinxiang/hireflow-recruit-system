import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { Activity, Interview, Job, Resume, Role, Stage, User, UserStatus } from '@/types'
import { STAGE_LABELS, RESULT_LABELS } from '@/types'
import { SEED_USERS, seedResumes, seedInterviews, seedJobs } from '@/lib/seed'
import { normalizeResume, normalizeUser } from '@/lib/tags'
import { checkCertFit } from '@/lib/match'
import { validateSharedState } from '@/lib/remote-schema'
import {
  getClientId, getSyncUrl, pullRemote, pushRemote, setSyncPassphrase, setSyncUrl, type SharedState,
} from '@/lib/sync'

interface State {
  users: User[]
  resumes: Resume[]
  interviews: Interview[]
  jobs: Job[]
  currentUserId: string
}

type Action =
  | { type: 'importResumes'; resumes: ImportableResume[]; actorId: string }
  | { type: 'updateStage'; ids: string[]; stage: Stage; actorId: string }
  | { type: 'assign'; ids: string[]; assigneeId: string | null; actorId: string }
  | { type: 'addNote'; resumeId: string; authorId: string; content: string }
  | { type: 'deleteResumes'; ids: string[] }
  | { type: 'register'; user: Omit<User, 'id' | 'createdAt'> }
  | { type: 'approveUser'; userId: string; role?: Role }
  | { type: 'rejectUser'; userId: string }
  | { type: 'setUserStatus'; userId: string; status: UserStatus }
  | { type: 'resetPassword'; userId: string; passwordHash: string; salt: string }
  | { type: 'changePassword'; userId: string; passwordHash: string; salt: string }
  | { type: 'upgradeCredential'; userId: string; passwordHash: string; salt: string }
  | { type: 'setUserRole'; userId: string; role: Role }
  | { type: 'switchUser'; userId: string }
  | { type: 'addInterview'; interview: Omit<Interview, 'id' | 'createdAt'>; actorId: string }
  | { type: 'updateInterview'; id: string; patch: Partial<Pick<Interview, 'result' | 'feedback' | 'time' | 'location'>>; actorId: string }
  | { type: 'deleteInterview'; id: string }
  | { type: 'addJob'; job: Omit<Job, 'id' | 'createdAt'>; actorId: string }
  | { type: 'updateJob'; id: string; patch: Partial<Pick<Job, 'region' | 'school' | 'level' | 'subject' | 'dormitory' | 'headcount' | 'status' | 'note'>>; actorId: string }
  | { type: 'deleteJob'; id: string }
  | { type: 'matchJob'; resumeId: string; jobId: string; actorId: string; /** 管理员在确认弹窗中显式强制锁定（绕过学段 block 兜底校验） */ force?: boolean }
  | { type: 'updateResumeFields'; id: string; fields: Partial<Resume>; actorId: string }
  | { type: 'releaseResumes'; ids: string[]; reason: string; toStage: Stage; actorId: string }
  | { type: 'applyRemote'; users: User[]; resumes: Resume[]; interviews: Interview[]; jobs?: Job[] }
  | { type: 'setRating'; id: string; rating: number }
  | { type: 'resetData' }

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error'

export type ImportableResume = Omit<
  Resume,
  'id' | 'createdAt' | 'updatedAt' | 'notes' | 'activities' | 'university' | 'company' | 'certificates' | 'tags' | 'rating'
  | 'age' | 'certStage' | 'certSubject' | 'certQualified' | 'gradYear' | 'hometown' | 'fullTime' | 'major' | 'jobId' | 'lockedBy' | 'lockedAt'
  | 'idCard' | 'rawText'
> & {
  /** 可选预生成 ID（导入方需要提前知道简历 ID 时使用，如关联本机原件存储） */
  id?: string
  /** 导入时附带的初始备注（如 AI 解析的原文摘要） */
  initialNote?: string
  university?: string
  company?: string
  certificates?: string[]
  tags?: string[]
  age?: number
  certStage?: Resume['certStage']
  certSubject?: string
  certQualified?: boolean
  gradYear?: number
  hometown?: string
  fullTime?: Resume['fullTime']
  major?: string
  idCard?: string
  rawText?: string
}

const STORAGE_KEY = 'hireflow-state-v2'
/** 同步游标持久化：防止刷新后未推送的本地修改被云端旧数据覆盖 */
const DIRTY_KEY = 'hireflow-sync-dirty'
const REMOTE_TS_KEY = 'hireflow-sync-remote-ts'
/** 简历字符串字段入库长度上限（防御：图片 dataURL 等超长内容不写入 localStorage，避免配额溢出） */
const MAX_RESUME_FIELD_LEN = 50000
/** localStorage 配额溢出告警只提示一次，避免刷屏 */
let quotaToastShown = false

/** 判断是否为 localStorage 配额溢出异常（跨浏览器：QuotaExceededError / 历史 code 22 / Firefox NS_ERROR 变种） */
function isQuotaExceeded(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014)
  )
}

/** 持久化前防御：任何简历字符串字段超过上限时截断（图片 base64 等不应入库的内容一并兜底） */
function sanitizeResumesForPersist(resumes: Resume[]): Resume[] {
  return resumes.map((r) => {
    let changed = false
    const out = { ...r } as Record<string, unknown>
    for (const [key, value] of Object.entries(out)) {
      if (typeof value === 'string' && value.length > MAX_RESUME_FIELD_LEN) {
        out[key] = value.slice(0, MAX_RESUME_FIELD_LEN)
        changed = true
      }
    }
    return changed ? (out as unknown as Resume) : r
  })
}

/** 按手机号/邮箱过滤与库中已有简历重复的导入项（同时去除导入批次内部重复） */
export function filterDuplicateResumes<T extends { phone?: string; email?: string }>(
  items: T[],
  existing: Resume[],
): { unique: T[]; skipped: number } {
  const keys = new Set(existing.map((r) => r.phone || r.email).filter(Boolean))
  const seen = new Set<string>()
  const unique: T[] = []
  let skipped = 0
  for (const it of items) {
    const key = (it.phone || it.email || '').trim()
    if (key && (keys.has(key) || seen.has(key))) {
      skipped++
      continue
    }
    if (key) seen.add(key)
    unique.push(it)
  }
  return { unique, skipped }
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function activity(actorId: string, action: string): Activity {
  return { id: uid('a'), actorId, action, createdAt: Date.now() }
}

function jobLabel(job: Job | undefined): string {
  return job ? `${job.school}·${job.level}${job.subject}` : '未知岗位'
}

function seedState(currentUserId: string): State {
  const resumes = seedResumes()
  return { users: SEED_USERS, resumes, interviews: seedInterviews(resumes), jobs: seedJobs(), currentUserId }
}

function init(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as State
      if (parsed.users?.length && parsed.resumes && parsed.currentUserId) {
        // 旧版本数据缺少 interviews / jobs / 新增字段时自动补齐
        return {
          ...parsed,
          interviews: parsed.interviews ?? [],
          jobs: parsed.jobs ?? [],
          users: parsed.users.map(normalizeUser),
          resumes: parsed.resumes.map(normalizeResume),
        }
      }
    }
  } catch {
    // fall through to seed
  }
  return seedState('u-admin')
}

function reducer(state: State, action: Action): State {
  const now = Date.now()
  switch (action.type) {
    case 'importResumes': {
      const created: Resume[] = action.resumes.map((r) => {
        const { initialNote, ...fields } = r
        return normalizeResume({
          university: '',
          company: '',
          certificates: [],
          tags: [],
          rating: 0,
          age: 0,
          certStage: '',
          certSubject: '',
          certQualified: false,
          gradYear: 0,
          hometown: '',
          fullTime: '未知',
          major: '',
          idCard: '',
          rawText: '',
          jobId: null,
          lockedBy: null,
          lockedAt: null,
          ...fields,
          id: fields.id ?? uid('r'),
          createdAt: now,
          updatedAt: now,
          notes: initialNote
            ? [{ id: uid('n'), authorId: action.actorId, content: initialNote, createdAt: now }]
            : [],
          activities: [activity(action.actorId, '批量导入简历')],
        })
      })
      return { ...state, resumes: [...created, ...state.resumes] }
    }
    case 'updateStage': {
      const idSet = new Set(action.ids)
      return {
        ...state,
        resumes: state.resumes.map((r) => {
          if (!idSet.has(r.id)) return r
          // 进入终态（淘汰/黑名单/离职）时自动释放锁定
          const release = action.stage === 'rejected' || action.stage === 'blacklisted' || action.stage === 'offboarded'
          const acts = [...r.activities, activity(action.actorId, `阶段变更为「${STAGE_LABELS[action.stage]}」`)]
          if (release && r.jobId) {
            acts.push(
              activity(
                action.actorId,
                action.stage === 'rejected' ? '面试未通过，简历已释放回总库' : '释放岗位锁定，简历已释放回总库',
              ),
            )
          }
          return {
            ...r,
            stage: action.stage,
            ...(release ? { jobId: null, lockedBy: null, lockedAt: null } : {}),
            updatedAt: now,
            activities: acts,
          }
        }),
      }
    }
    case 'assign': {
      const idSet = new Set(action.ids)
      const target = state.users.find((u) => u.id === action.assigneeId)
      const label = target ? `分配给 ${target.name}` : '取消分配'
      return {
        ...state,
        resumes: state.resumes.map((r) =>
          idSet.has(r.id)
            ? { ...r, assigneeId: action.assigneeId, updatedAt: now, activities: [...r.activities, activity(action.actorId, label)] }
            : r,
        ),
      }
    }
    case 'addNote': {
      return {
        ...state,
        resumes: state.resumes.map((r) =>
          r.id === action.resumeId
            ? {
                ...r,
                updatedAt: now,
                notes: [...r.notes, { id: uid('n'), authorId: action.authorId, content: action.content, createdAt: now }],
                activities: [...r.activities, activity(action.authorId, '添加了备注')],
              }
            : r,
        ),
      }
    }
    case 'deleteResumes': {
      const idSet = new Set(action.ids)
      return {
        ...state,
        resumes: state.resumes.filter((r) => !idSet.has(r.id)),
        interviews: state.interviews.filter((iv) => !idSet.has(iv.resumeId)),
      }
    }
    case 'addInterview': {
      const interview: Interview = { ...action.interview, id: uid('iv'), createdAt: now }
      return {
        ...state,
        interviews: [...state.interviews, interview],
        resumes: state.resumes.map((r) =>
          r.id === interview.resumeId
            ? { ...r, updatedAt: now, activities: [...r.activities, activity(action.actorId, `安排了${interview.round}（${new Date(interview.time).toLocaleString('zh-CN')}）`)] }
            : r,
        ),
      }
    }
    case 'updateInterview': {
      const target = state.interviews.find((iv) => iv.id === action.id)
      if (!target) return state
      const updated = { ...target, ...action.patch }
      const resultChanged = action.patch.result && action.patch.result !== target.result
      return {
        ...state,
        interviews: state.interviews.map((iv) => (iv.id === action.id ? updated : iv)),
        resumes: resultChanged
          ? state.resumes.map((r) => {
              if (r.id !== target.resumeId) return r
              const acts = [...r.activities, activity(action.actorId, `${target.round}结果：${RESULT_LABELS[updated.result]}`)]
              // 通过 → 录用；未通过 → 面试不通过并释放锁定；候选人拒绝 → 回到筛选池并释放锁定
              if (updated.result === 'pass') {
                return { ...r, stage: 'offered' as Stage, updatedAt: now, activities: [...acts, activity(action.actorId, '面试通过，进入录用')] }
              }
              if (updated.result === 'fail') {
                return {
                  ...r,
                  stage: 'rejected' as Stage,
                  jobId: null, lockedBy: null, lockedAt: null,
                  updatedAt: now,
                  activities: [...acts, activity(action.actorId, '面试未通过，简历已释放回总库')],
                }
              }
              if (updated.result === 'declined') {
                return {
                  ...r,
                  stage: 'screening' as Stage,
                  jobId: null, lockedBy: null, lockedAt: null,
                  updatedAt: now,
                  activities: [...acts, activity(action.actorId, '候选人拒绝面试，释放简历回筛选池')],
                }
              }
              return { ...r, updatedAt: now, activities: acts }
            })
          : state.resumes,
      }
    }
    case 'deleteInterview': {
      return { ...state, interviews: state.interviews.filter((iv) => iv.id !== action.id) }
    }
    case 'addJob': {
      const job: Job = { ...action.job, id: uid('j'), createdAt: now }
      return { ...state, jobs: [job, ...state.jobs] }
    }
    case 'updateJob': {
      return {
        ...state,
        jobs: state.jobs.map((j) => (j.id === action.id ? { ...j, ...action.patch } : j)),
        // 职位关闭时释放所有锁定在该职位上的简历
        ...(action.patch.status === 'closed'
          ? {
              resumes: state.resumes.map((r) =>
                r.jobId === action.id && (r.stage === 'matched' || r.stage === 'screening')
                  ? {
                      ...r,
                      jobId: null, lockedBy: null, lockedAt: null,
                      stage: 'screening' as Stage,
                      updatedAt: now,
                      activities: [...r.activities, activity(action.actorId, '职位已关闭，释放简历回筛选池')],
                    }
                  : r,
              ),
            }
          : {}),
      }
    }
    case 'deleteJob': {
      return {
        ...state,
        jobs: state.jobs.filter((j) => j.id !== action.id),
        resumes: state.resumes.map((r) => (r.jobId === action.id ? { ...r, jobId: null, lockedBy: null, lockedAt: null } : r)),
      }
    }
    case 'matchJob': {
      const job = state.jobs.find((j) => j.id === action.jobId)
      if (!job || job.status !== 'open') return state
      const target = state.resumes.find((r) => r.id === action.resumeId)
      if (!target) return state
      // 兜底校验①：简历已被其他职位锁定时拒绝（同一职位重复锁定幂等放行）
      if (target.jobId && target.jobId !== action.jobId) return state
      // 兜底校验②：学段硬性不符（如小学教师资格证锁高中岗位）一律拒绝，
      // 与详情页共用的 checkCertFit 判定保持一致；
      // 唯一例外：管理员在确认弹窗中显式选择「强制锁定」（force=true，活动记录留痕）。
      // force 仅对管理员生效：非管理员调用方携带 force=true 时忽略，按普通锁定走校验
      const isAdmin = state.users.find((u) => u.id === action.actorId)?.role === 'admin'
      const force = !!action.force && isAdmin
      if (checkCertFit(target, job).level === 'block' && !force) return state
      const forced = force && checkCertFit(target, job).level === 'block'
      return {
        ...state,
        resumes: state.resumes.map((r) =>
          r.id === action.resumeId
            ? {
                ...r,
                stage: 'matched' as Stage,
                jobId: action.jobId,
                lockedBy: action.actorId,
                lockedAt: now,
                updatedAt: now,
                activities: [
                  ...r.activities,
                  activity(action.actorId, `${forced ? '（管理员强制）' : ''}匹配并锁定到「${jobLabel(job)}」`),
                ],
              }
            : r,
        ),
      }
    }
    case 'updateResumeFields': {
      return {
        ...state,
        resumes: state.resumes.map((r) =>
          r.id === action.id
            ? {
                ...r,
                ...action.fields,
                // 保护不可手动覆盖的字段
                id: r.id,
                createdAt: r.createdAt,
                notes: r.notes,
                activities: [...r.activities, activity(action.actorId, '手动更新了资料')],
                updatedAt: now,
              }
            : r,
        ),
      }
    }
    case 'releaseResumes': {
      const idSet = new Set(action.ids)
      return {
        ...state,
        resumes: state.resumes.map((r) =>
          idSet.has(r.id)
            ? {
                ...r,
                stage: action.toStage,
                jobId: null,
                lockedBy: null,
                lockedAt: null,
                updatedAt: now,
                activities: [...r.activities, activity(action.actorId, `释放简历（${action.reason}），回到「${STAGE_LABELS[action.toStage]}」`)],
              }
            : r,
        ),
      }
    }
    case 'register': {
      const user: User = { ...action.user, id: uid('u'), createdAt: now }
      return { ...state, users: [...state.users, user] }
    }
    case 'approveUser': {
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.userId && u.status === 'pending'
            ? // 获批的新用户首次登录强制修改密码
              { ...u, status: 'active' as UserStatus, mustChangePassword: true, ...(action.role ? { role: action.role } : {}) }
            : u,
        ),
      }
    }
    case 'rejectUser': {
      // 拒绝 = 删除待审批账号
      return { ...state, users: state.users.filter((u) => !(u.id === action.userId && u.status === 'pending')) }
    }
    case 'setUserStatus': {
      return {
        ...state,
        users: state.users.map((u) => (u.id === action.userId ? { ...u, status: action.status } : u)),
      }
    }
    case 'resetPassword': {
      // 管理员重置密码后，该用户下次登录强制修改密码
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.userId ? { ...u, passwordHash: action.passwordHash, salt: action.salt, mustChangePassword: true } : u,
        ),
      }
    }
    case 'changePassword': {
      // 用户主动改密（含强制改密页）成功后解除强制改密标记
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.userId ? { ...u, passwordHash: action.passwordHash, salt: action.salt, mustChangePassword: false } : u,
        ),
      }
    }
    case 'upgradeCredential': {
      // 旧格式凭据登录成功后的静默 PBKDF2 升级：仅更新凭据，不触碰 mustChangePassword
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.userId ? { ...u, passwordHash: action.passwordHash, salt: action.salt } : u,
        ),
      }
    }
    case 'setUserRole': {
      return {
        ...state,
        users: state.users.map((u) => (u.id === action.userId ? { ...u, role: action.role } : u)),
      }
    }
    case 'switchUser': {
      return { ...state, currentUserId: action.userId }
    }
    case 'resetData': {
      return seedState(state.currentUserId)
    }
    case 'applyRemote': {
      const currentUserId = action.users.some((u) => u.id === state.currentUserId)
        ? state.currentUserId
        : (action.users[0]?.id ?? state.currentUserId)
      return {
        ...state,
        users: action.users.map(normalizeUser),
        resumes: action.resumes.map(normalizeResume),
        interviews: action.interviews,
        jobs: action.jobs ?? [],
        currentUserId,
      }
    }
    case 'setRating': {
      return {
        ...state,
        resumes: state.resumes.map((r) => (r.id === action.id ? { ...r, rating: action.rating, updatedAt: now } : r)),
      }
    }
    default:
      return state
  }
}

interface StoreValue extends State {
  currentUser: User
  dispatch: React.Dispatch<Action>
  syncStatus: SyncStatus
  lastSyncAt: number | null
  /** 云端数据已加密但本机无口令或口令不匹配（需要输入团队同步口令） */
  syncLocked: boolean
  /** 手动触发一次同步，返回本次是否成功 */
  syncNow: () => Promise<boolean>
  /** 保存团队同步口令并重试拉取（口令错误会重新进入 syncLocked） */
  submitSyncPassphrase: (passphrase: string) => Promise<void>
  /** 强制把本地数据重新加密推送一次（设置/更换同步口令后调用） */
  forcePush: () => Promise<void>
  syncUrl: string
  setCustomSyncUrl: (url: string) => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(reducer, undefined, init)

  // ---- 云端同步 ----
  const [syncStatus, setSyncStatusState] = useState<SyncStatus>('idle')
  // 同步状态的 ref 镜像：syncNow 需要同步读取本次操作结果（state 更新是异步的）
  const syncStatusRef = useRef<SyncStatus>('idle')
  const setSyncStatus = useMemo(
    () => (s: SyncStatus | ((prev: SyncStatus) => SyncStatus)) => {
      setSyncStatusState((prev) => {
        const next = typeof s === 'function' ? s(prev) : s
        syncStatusRef.current = next
        return next
      })
    },
    [],
  )
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [syncLocked, setSyncLocked] = useState(false)
  // syncLocked 的 ref 镜像：syncNow 需要同步读取锁定状态（state 更新是异步的），避免误报「同步完成」
  const syncLockedRef = useRef(false)
  const [syncUrl, setSyncUrlState] = useState(getSyncUrl)
  const clientIdRef = useRef(getClientId())
  // 恢复上次的同步游标：本地若有未推送的修改，刷新后先推送而不是被云端覆盖
  const dirtyRef = useRef(typeof localStorage !== 'undefined' && localStorage.getItem(DIRTY_KEY) === '1')
  const lastRemoteRef = useRef(typeof localStorage !== 'undefined' ? Number(localStorage.getItem(REMOTE_TS_KEY) ?? 0) : 0)
  const pushingRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  const persistSyncMarks = (dirty: boolean, remoteTs?: number) => {
    try {
      localStorage.setItem(DIRTY_KEY, dirty ? '1' : '0')
      if (remoteTs !== undefined) localStorage.setItem(REMOTE_TS_KEY, String(remoteTs))
    } catch {
      // 存储不可用时仅内存内跟踪
    }
  }

  const dispatch = useMemo<React.Dispatch<Action>>(
    () => (action) => {
      if (action.type !== 'applyRemote') {
        dirtyRef.current = true
        persistSyncMarks(true)
      }
      baseDispatch(action)
    },
    [],
  )

  // doPush 冲突分支需要回调 pullAndApply（两者互相依赖，用 ref 打破循环）
  // 返回值表示是否成功拉取并应用（force=true 时跳过 dirty 竞态防护，供冲突分支使用）
  const pullAndApplyRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false)

  const doPush = useMemo(
    () => async () => {
      if (pushingRef.current) return
      pushingRef.current = true
      setSyncStatus('syncing')
      const { users, resumes, interviews, jobs } = stateRef.current
      const shared: SharedState = { users, resumes, interviews, jobs }
      const result = await pushRemote(shared, clientIdRef.current, lastRemoteRef.current)
      pushingRef.current = false
      if (result.status === 'pushed') {
        lastRemoteRef.current = result.updatedAt
        dirtyRef.current = false
        persistSyncMarks(false, result.updatedAt)
        setSyncStatus('ok')
        setLastSyncAt(Date.now())
      } else if (result.status === 'conflict') {
        // 远端有其他人更新的数据：放弃本次推送（整库覆盖会丢对方数据），
        // 拉取远端最新；本端基于旧版本的未推送修改随之失效（last-write-wins 的既定取舍）。
        // 注意：dirty 标记由 pullAndApply 在成功应用远端数据后自行清除；
        // 若拉取失败则保持 dirty=true，本地未推送修改下轮仍会尝试推送，避免被远端覆盖丢失
        toast.warning('检测到云端有更新的数据，已为你拉取最新版本')
        await pullAndApplyRef.current(true)
      } else {
        setSyncStatus('error')
      }
    },
    [setSyncStatus],
  )

  const pullAndApply = useMemo(
    () => async (force = false): Promise<boolean> => {
      const result = await pullRemote()
      if (result.status === 'error') {
        setSyncStatus('error')
        return false
      }
      if (result.status === 'locked') {
        // 云端数据已加密，但本机未设置口令或口令不匹配：不应用数据，等待用户在 UI 输入口令。
        // 锁定是独立状态（syncLocked），不要把 syncStatus 置为 'ok'——
        // 否则 syncNow 会误判成功并弹出「同步完成」
        syncLockedRef.current = true
        setSyncLocked(true)
        setSyncStatus((s) => (s === 'syncing' ? 'idle' : s))
        return false
      }
      const { payload } = result
      if (payload.state === null) {
        // 云端是空库：把本地数据推上去
        dirtyRef.current = true
        persistSyncMarks(true)
        await doPush()
        return true
      }
      if (payload.updatedAt > lastRemoteRef.current) {
        if (payload.origin !== clientIdRef.current && payload.state) {
          // 竞态防护：拉取窗口内产生的本地修改不得被整库覆盖，改走推送分支
          // （doPush 冲突分支以 force=true 调用时跳过此防护，直接应用远端）
          if (dirtyRef.current && !force) {
            await doPush()
            return true
          }
          // zod 结构校验：畸形数据拒绝应用、保留本地数据，绝不写入 localStorage（防砖化）
          const validation = validateSharedState(payload.state)
          if (!validation.ok) {
            console.error('远端数据校验失败，已拒绝应用：', validation.issues)
            toast.error('云端数据格式异常，已保护本地数据不被覆盖')
            setSyncStatus('error')
            return false
          }
          lastRemoteRef.current = payload.updatedAt
          dirtyRef.current = false // 应用云端数据，避免回推造成回环
          persistSyncMarks(false, payload.updatedAt)
          syncLockedRef.current = false
          setSyncLocked(false)
          baseDispatch({ type: 'applyRemote', ...validation.state })
        } else {
          lastRemoteRef.current = payload.updatedAt
          persistSyncMarks(false, payload.updatedAt)
        }
        setLastSyncAt(Date.now())
      }
      setSyncStatus((s) => (s === 'syncing' ? s : 'ok'))
      return true
    },
    [doPush, setSyncStatus],
  )
  // 通过 effect 同步 ref，避免渲染期写 ref（react-hooks 规则）
  useEffect(() => {
    pullAndApplyRef.current = pullAndApply
  }, [pullAndApply])

  const doPull = useMemo(
    () => async () => {
      // 本地有未推送的修改时先推送，避免被云端旧数据覆盖
      if (dirtyRef.current) {
        await doPush()
        return
      }
      await pullAndApply()
    },
    [doPush, pullAndApply],
  )

  // 本地变更后 5 秒防抖推送（放宽防抖窗口，降低对公共存储端的请求放大）
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, resumes: sanitizeResumesForPersist(state.resumes) }))
    } catch (e) {
      // 存储配额满：告警一次（不刷屏），不阻断使用（云端同步仍可进行）
      if (isQuotaExceeded(e) && !quotaToastShown) {
        quotaToastShown = true
        toast.error('本地存储空间不足，部分数据可能无法保存到本机缓存（云端同步不受影响）')
      }
    }
    if (!dirtyRef.current) return
    const t = setTimeout(() => {
      if (dirtyRef.current) doPush()
    }, 5000)
    return () => clearTimeout(t)
  }, [state, doPush])

  // 启动时拉取一次，之后每 30 秒轮询云端（页面隐藏时暂停，回到前台立即拉取，避免触发存储端限流）
  useEffect(() => {
    doPull()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') doPull()
    }, 30000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') doPull()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [doPull])

  const syncNow = useMemo(
    () => async (): Promise<boolean> => {
      if (dirtyRef.current) await doPush()
      await doPull()
      // 云端被口令锁定时不算同步成功，避免 UI 误弹「同步完成」
      if (syncLockedRef.current) return false
      return syncStatusRef.current === 'ok'
    },
    [doPush, doPull],
  )

  const submitSyncPassphrase = useMemo(
    () => async (passphrase: string): Promise<void> => {
      // 口令仅存本机（绝不上云），保存后立即重试拉取；口令错误会重新进入 syncLocked
      setSyncPassphrase(passphrase)
      syncLockedRef.current = false
      setSyncLocked(false)
      await pullAndApply()
    },
    [pullAndApply],
  )

  const forcePush = useMemo(
    () => async (): Promise<void> => {
      dirtyRef.current = true
      persistSyncMarks(true)
      await doPush()
    },
    [doPush],
  )

  const setCustomSyncUrl = useMemo(
    () => (url: string) => {
      setSyncUrl(url)
      setSyncUrlState(getSyncUrl())
      lastRemoteRef.current = 0
      // 同步清除持久化的远端时间戳，否则刷新后 init 会读回旧值
      persistSyncMarks(dirtyRef.current, 0)
      doPull()
    },
    [doPull],
  )

  const value = useMemo<StoreValue>(() => {
    const currentUser = state.users.find((u) => u.id === state.currentUserId) ?? state.users[0]
    return {
      ...state,
      currentUser,
      dispatch,
      syncStatus,
      lastSyncAt,
      syncLocked,
      syncNow,
      submitSyncPassphrase,
      forcePush,
      syncUrl,
      setCustomSyncUrl,
    }
  }, [state, dispatch, syncStatus, lastSyncAt, syncLocked, syncNow, submitSyncPassphrase, forcePush, syncUrl, setCustomSyncUrl])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
