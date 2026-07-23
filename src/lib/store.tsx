import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { Activity, Interview, Job, Resume, Stage, User } from '@/types'
import { STAGE_LABELS, RESULT_LABELS } from '@/types'
import { SEED_USERS, seedResumes, seedInterviews, seedJobs } from '@/lib/seed'
import { normalizeResume } from '@/lib/tags'
import { getClientId, getSyncUrl, pullRemote, pushRemote, setSyncUrl, type SharedState } from '@/lib/sync'

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
  | { type: 'addUser'; user: Omit<User, 'id'> }
  | { type: 'switchUser'; userId: string }
  | { type: 'addInterview'; interview: Omit<Interview, 'id' | 'createdAt'>; actorId: string }
  | { type: 'updateInterview'; id: string; patch: Partial<Pick<Interview, 'result' | 'feedback' | 'time' | 'location'>>; actorId: string }
  | { type: 'deleteInterview'; id: string }
  | { type: 'addJob'; job: Omit<Job, 'id' | 'createdAt'>; actorId: string }
  | { type: 'updateJob'; id: string; patch: Partial<Pick<Job, 'region' | 'school' | 'level' | 'subject' | 'dormitory' | 'headcount' | 'status' | 'note'>>; actorId: string }
  | { type: 'deleteJob'; id: string }
  | { type: 'matchJob'; resumeId: string; jobId: string; actorId: string }
  | { type: 'releaseResumes'; ids: string[]; reason: string; toStage: Stage; actorId: string }
  | { type: 'applyRemote'; users: User[]; resumes: Resume[]; interviews: Interview[]; jobs?: Job[] }
  | { type: 'setRating'; id: string; rating: number }
  | { type: 'resetData' }

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error'

export type ImportableResume = Omit<
  Resume,
  'id' | 'createdAt' | 'updatedAt' | 'notes' | 'activities' | 'university' | 'company' | 'certificates' | 'tags' | 'rating'
  | 'age' | 'certStage' | 'certSubject' | 'gradYear' | 'hometown' | 'fullTime' | 'major' | 'jobId' | 'lockedBy' | 'lockedAt'
> & {
  /** 导入时附带的初始备注（如 AI 解析的原文摘要） */
  initialNote?: string
  university?: string
  company?: string
  certificates?: string[]
  tags?: string[]
  age?: number
  certStage?: Resume['certStage']
  certSubject?: string
  gradYear?: number
  hometown?: string
  fullTime?: Resume['fullTime']
  major?: string
}

const STORAGE_KEY = 'hireflow-state-v2'

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
          gradYear: 0,
          hometown: '',
          fullTime: '未知',
          major: '',
          jobId: null,
          lockedBy: null,
          lockedAt: null,
          ...fields,
          id: uid('r'),
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
        resumes: state.resumes.map((r) =>
          idSet.has(r.id)
            ? {
                ...r,
                stage: action.stage,
                // 进入终态（淘汰/黑名单/离职）时自动释放锁定
                ...(action.stage === 'rejected' || action.stage === 'blacklisted' || action.stage === 'offboarded'
                  ? { jobId: null, lockedBy: null, lockedAt: null }
                  : {}),
                updatedAt: now,
                activities: [...r.activities, activity(action.actorId, `阶段变更为「${STAGE_LABELS[action.stage]}」`)],
              }
            : r,
        ),
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
                  activities: [...acts, activity(action.actorId, '面试未通过，释放岗位锁定')],
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
                activities: [...r.activities, activity(action.actorId, `匹配并锁定到「${jobLabel(job)}」`)],
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
    case 'addUser': {
      return { ...state, users: [...state.users, { ...action.user, id: uid('u') }] }
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
        users: action.users,
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
  syncNow: () => Promise<void>
  syncUrl: string
  setCustomSyncUrl: (url: string) => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(reducer, undefined, init)

  // ---- 云端同步 ----
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [syncUrl, setSyncUrlState] = useState(getSyncUrl)
  const clientIdRef = useRef(getClientId())
  const dirtyRef = useRef(false)
  const lastRemoteRef = useRef(0)
  const pushingRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  const dispatch = useMemo<React.Dispatch<Action>>(
    () => (action) => {
      if (action.type !== 'applyRemote') dirtyRef.current = true
      baseDispatch(action)
    },
    [],
  )

  const doPush = useMemo(
    () => async () => {
      if (pushingRef.current) return
      pushingRef.current = true
      setSyncStatus('syncing')
      const { users, resumes, interviews, jobs } = stateRef.current
      const shared: SharedState = { users, resumes, interviews, jobs }
      const updatedAt = await pushRemote(shared, clientIdRef.current)
      pushingRef.current = false
      if (updatedAt !== null) {
        lastRemoteRef.current = updatedAt
        dirtyRef.current = false
        setSyncStatus('ok')
        setLastSyncAt(Date.now())
      } else {
        setSyncStatus('error')
      }
    },
    [],
  )

  const doPull = useMemo(
    () => async () => {
      const payload = await pullRemote()
      if (payload === undefined) {
        setSyncStatus('error')
        return
      }
      if (payload.state === null) {
        // 云端是空库：把本地数据推上去
        dirtyRef.current = true
        await doPush()
        return
      }
      if (payload.updatedAt > lastRemoteRef.current) {
        lastRemoteRef.current = payload.updatedAt
        if (payload.origin !== clientIdRef.current && payload.state) {
          dirtyRef.current = false // 应用云端数据，避免回推造成回环
          baseDispatch({ type: 'applyRemote', ...payload.state })
        }
        setLastSyncAt(Date.now())
      }
      setSyncStatus((s) => (s === 'syncing' ? s : 'ok'))
    },
    [doPush],
  )

  // 本地变更后 1 秒防抖推送
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    if (!dirtyRef.current) return
    const t = setTimeout(() => {
      if (dirtyRef.current) doPush()
    }, 1000)
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
    () => async () => {
      if (dirtyRef.current) await doPush()
      await doPull()
    },
    [doPush, doPull],
  )

  const setCustomSyncUrl = useMemo(
    () => (url: string) => {
      setSyncUrl(url)
      setSyncUrlState(getSyncUrl())
      lastRemoteRef.current = 0
      doPull()
    },
    [doPull],
  )

  const value = useMemo<StoreValue>(() => {
    const currentUser = state.users.find((u) => u.id === state.currentUserId) ?? state.users[0]
    return { ...state, currentUser, dispatch, syncStatus, lastSyncAt, syncNow, syncUrl, setCustomSyncUrl }
  }, [state, dispatch, syncStatus, lastSyncAt, syncNow, syncUrl, setCustomSyncUrl])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
