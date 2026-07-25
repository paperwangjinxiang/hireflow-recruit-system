import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { Activity, Interview, InterviewEvaluation, Job, Resume, Role, Stage, StageTransition, User, UserStatus } from '@/types'
import { STAGE_LABELS, STAGE_ORDER, RESULT_LABELS, CONCLUSION_LABELS } from '@/types'
import { interviewTypeOf } from '@/lib/interview-utils'
import { SEED_USERS, seedResumes, seedInterviews, seedJobs } from '@/lib/seed'
import { normalizeResume, normalizeUser } from '@/lib/tags'
import { checkCertFit } from '@/lib/match'
import { validateSharedState } from '@/lib/remote-schema'
import {
  getClientId, getSyncUrl, pullRemote, pushRemote, setSyncPassphrase, setSyncUrl, type SharedState,
} from '@/lib/sync'
import {
  list as candidatesList,
  get as candidatesGet,
  upsert as candidatesUpsert,
  bulkUpsert as candidatesBulkUpsert,
  remove as candidatesRemove,
  healthCheck as candidatesHealthCheck,
  onCandidatesDegraded,
  partialResumeFromIndex,
  type CandidateListParams,
  type CandidateListResult,
} from '@/lib/candidates'

interface State {
  users: User[]
  resumes: Resume[]
  interviews: Interview[]
  jobs: Job[]
  currentUserId: string
  /** 在线投递私钥（PKCS8 Base64）：存主库并随主库 AES 加密同步；管理员配置，绝不明文回显 */
  applyPrivateKey?: string
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
  | { type: 'updateInterview'; id: string; patch: Partial<Pick<Interview, 'result' | 'feedback' | 'time' | 'location' | 'status' | 'note' | 'type' | 'interviewerIds' | 'jobId'>>; actorId: string }
  | { type: 'submitEvaluation'; id: string; evaluation: Omit<InterviewEvaluation, 'submittedAt'>; actorId: string }
  | { type: 'deleteInterview'; id: string }
  | { type: 'addJob'; job: Omit<Job, 'id' | 'createdAt'>; actorId: string }
  | { type: 'updateJob'; id: string; patch: Partial<Pick<Job, 'region' | 'school' | 'level' | 'subject' | 'dormitory' | 'headcount' | 'status' | 'note'>>; actorId: string }
  | { type: 'deleteJob'; id: string }
  | { type: 'matchJob'; resumeId: string; jobId: string; actorId: string; /** 确认弹窗中显式「仍然锁定」（绕过学段 block 兜底校验，活动记录留痕） */ force?: boolean }
  | { type: 'updateResumeFields'; id: string; fields: Partial<Resume>; actorId: string }
  | { type: 'releaseResumes'; ids: string[]; reason: string; toStage: Stage; actorId: string }
  | { type: 'applyRemote'; users: User[]; resumes: Resume[]; interviews: Interview[]; jobs?: Job[]; applyPrivateKey?: string }
  | { type: 'setApplyPrivateKey'; privateKey: string }
  | { type: 'setRating'; id: string; rating: number }
  | { type: 'resetData' }
  /** 候选人分表：水合远端数据合并进本地（replace=true 时整体替换，用于 API 模式首轮水合） */
  | { type: 'hydrateResumes'; resumes: Resume[]; replace?: boolean }
  /** 候选人分表：本地乐观 upsert（API 写入由 store 的脏数据冲刷负责） */
  | { type: 'upsertResumeLocal'; resume: Resume }

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error'

export type ImportableResume = Omit<
  Resume,
  'id' | 'createdAt' | 'updatedAt' | 'notes' | 'activities' | 'university' | 'company' | 'certificates' | 'tags' | 'rating'
  | 'age' | 'certStage' | 'certSubject' | 'certQualified' | 'certNote' | 'gradYear' | 'hometown' | 'fullTime' | 'major' | 'jobId' | 'lockedBy' | 'lockedAt'
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
  certNote?: string
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

/** 追加阶段轨迹（与当前最后一条同阶段则跳过；招聘分析的转化率/停留时长口径来源） */
function appendStageHistory(r: Resume, stage: Stage, at: number): StageTransition[] {
  const hist = r.stageHistory ?? []
  if (hist.length > 0 && hist[hist.length - 1].stage === stage) return hist
  return [...hist, { stage, at }]
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
          certNote: '',
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
          stageHistory: [{ stage: fields.stage ?? 'imported', at: now }],
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
            stageHistory: appendStageHistory(r, action.stage, now),
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
      const cancelled = action.patch.status === 'cancelled' && target.status !== 'cancelled'
      return {
        ...state,
        interviews: state.interviews.map((iv) => (iv.id === action.id ? updated : iv)),
        resumes: resultChanged
          ? state.resumes.map((r) => {
              if (r.id !== target.resumeId) return r
              const acts = [...r.activities, activity(action.actorId, `${target.round}结果：${RESULT_LABELS[updated.result]}`)]
              // 通过 → 录用；未通过 → 面试不通过并释放锁定；候选人拒绝 → 回到筛选池并释放锁定
              if (updated.result === 'pass') {
                return { ...r, stage: 'offered' as Stage, updatedAt: now, activities: [...acts, activity(action.actorId, '面试通过，进入录用')], stageHistory: appendStageHistory(r, 'offered', now) }
              }
              if (updated.result === 'fail') {
                return {
                  ...r,
                  stage: 'rejected' as Stage,
                  jobId: null, lockedBy: null, lockedAt: null,
                  updatedAt: now,
                  activities: [...acts, activity(action.actorId, '面试未通过，简历已释放回总库')],
                  stageHistory: appendStageHistory(r, 'rejected', now),
                }
              }
              if (updated.result === 'declined') {
                return {
                  ...r,
                  stage: 'screening' as Stage,
                  jobId: null, lockedBy: null, lockedAt: null,
                  updatedAt: now,
                  activities: [...acts, activity(action.actorId, '候选人拒绝面试，释放简历回筛选池')],
                  stageHistory: appendStageHistory(r, 'screening', now),
                }
              }
              return { ...r, updatedAt: now, activities: acts }
            })
          : cancelled
            ? state.resumes.map((r) =>
                r.id === target.resumeId
                  ? { ...r, updatedAt: now, activities: [...r.activities, activity(action.actorId, `取消了${target.round}（${new Date(target.time).toLocaleString('zh-CN')}）`)] }
                  : r,
              )
            : state.resumes,
      }
    }
    case 'submitEvaluation': {
      const target = state.interviews.find((iv) => iv.id === action.id)
      if (!target) return state
      // 同一面试官重复提交时覆盖其旧评价；新面试官则追加
      const evaluation: InterviewEvaluation = { ...action.evaluation, submittedAt: now }
      const others = (target.evaluations ?? []).filter((ev) => ev.interviewerId !== evaluation.interviewerId)
      const evaluations = [...others, evaluation]
      const updated: Interview = { ...target, evaluations, status: 'completed' }
      const avg = evaluations.reduce((s, ev) => {
        const vals = Object.values(ev.scores)
        return s + (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0)
      }, 0) / evaluations.length
      const typeLabel = interviewTypeOf(target)
      return {
        ...state,
        interviews: state.interviews.map((iv) => (iv.id === action.id ? updated : iv)),
        resumes: state.resumes.map((r) =>
          r.id === target.resumeId
            ? {
                ...r,
                updatedAt: now,
                activities: [
                  ...r.activities,
                  activity(
                    action.actorId,
                    `面试完成：${typeLabel} 平均${avg.toFixed(1)}分 结论：${CONCLUSION_LABELS[evaluation.conclusion]}（${evaluations.length} 位面试官已评价）`,
                  ),
                ],
              }
            : r,
        ),
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
                      stageHistory: appendStageHistory(r, 'screening', now),
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
      // 兜底校验②：学段硬性不符（如小学教师资格证锁高中岗位）默认拒绝，
      // 与详情页共用的 checkCertFit 判定保持一致；
      // 唯一例外：调用方在确认弹窗中显式选择「仍然锁定」并完成二次确认（force=true，活动记录留痕）
      const force = !!action.force
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
                  activity(action.actorId, `${forced ? '（强制锁定）' : ''}匹配并锁定到「${jobLabel(job)}」`),
                ],
                stageHistory: appendStageHistory(r, 'matched', now),
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
                stageHistory: appendStageHistory(r, action.toStage, now),
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
    case 'hydrateResumes': {
      // 候选人分表：远端水合。replace=true 整体替换（API 模式首轮索引行水合）；
      // 否则按 id 合并（已存在的整条替换，新 id 追加），不触碰未涉及的本地记录
      if (action.replace) return { ...state, resumes: action.resumes }
      const incoming = new Map(action.resumes.map((r) => [r.id, r]))
      const merged = state.resumes.map((r) => incoming.get(r.id) ?? r)
      const existing = new Set(state.resumes.map((r) => r.id))
      const appended = action.resumes.filter((r) => !existing.has(r.id))
      return { ...state, resumes: [...merged, ...appended] }
    }
    case 'upsertResumeLocal': {
      const exists = state.resumes.some((r) => r.id === action.resume.id)
      return {
        ...state,
        resumes: exists
          ? state.resumes.map((r) => (r.id === action.resume.id ? action.resume : r))
          : [action.resume, ...state.resumes],
      }
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
        applyPrivateKey: action.applyPrivateKey,
        currentUserId,
      }
    }
    case 'setApplyPrivateKey': {
      return { ...state, applyPrivateKey: action.privateKey }
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
  // ---- 候选人分表 API（resumes 不再走整库信封） ----
  /** 候选人存储模式：unknown=检测中；api=候选人分表 API；legacy=旧信封兼容模式（API 不可用时自动降级） */
  candidatesMode: 'unknown' | 'api' | 'legacy'
  /** 服务端分页查询候选人索引行（legacy 模式为本地过滤同构返回） */
  candidatesQuery: (params: CandidateListParams) => Promise<CandidateListResult>
  /** 按需加载完整候选人（拉 doc 解密，api 模式水合进本地缓存） */
  candidateDetail: (id: string) => Promise<Resume>
  /** 各阶段候选人计数（看板列头；api 模式逐阶段 size=1 查 total，15 秒缓存） */
  stageCounts: () => Promise<Record<Stage, number>>
  /** 写入单条候选人（本地乐观更新 + API upsert；legacy 模式只写本地走信封） */
  updateCandidate: (resume: Resume) => Promise<void>
  /** 删除候选人（本地 + API 逐条删除） */
  deleteCandidates: (ids: string[]) => Promise<void>
  /** 重新拉取候选人索引行镜像（仪表盘/进展页统计的数据来源） */
  refreshCandidatesMirror: () => Promise<void>
  /** 候选人总数（api 模式）与镜像是否被截断（总数 >5000 时镜像仅前 5000 条索引行） */
  candidatesTotal: number | null
  candidatesMirrorCapped: boolean
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
      // applyRemote 是远端应用；hydrate/upsertLocal 是候选人分表的水合/缓存写入，
      // 均不产生「待推送信封」的脏标记（api 模式简历已不走信封，legacy 模式不使用这两个 action）
      if (action.type !== 'applyRemote' && action.type !== 'hydrateResumes' && action.type !== 'upsertResumeLocal') {
        dirtyRef.current = true
        persistSyncMarks(true)
      }
      baseDispatch(action)
    },
    [],
  )

  // ---- 候选人分表 API：模式检测 / 索引行镜像 / 变更回写 ----
  const [candidatesMode, setCandidatesModeState] = useState<'unknown' | 'api' | 'legacy'>('unknown')
  // 模式的 ref 镜像：异步回调（doPush/pullAndApply 等）需要同步读取当前模式
  const candidatesModeRef = useRef<'unknown' | 'api' | 'legacy'>('unknown')
  const setCandidatesMode = (m: 'unknown' | 'api' | 'legacy') => {
    candidatesModeRef.current = m
    setCandidatesModeState(m)
  }
  const [candidatesTotal, setCandidatesTotal] = useState<number | null>(null)
  const [candidatesMirrorCapped, setCandidatesMirrorCapped] = useState(false)
  /** 完整候选人内存缓存（candidateDetail 按需加载 + 回写后更新） */
  const detailCacheRef = useRef(new Map<string, Resume>())
  /** id → 已确认写入 API 的 updatedAt（防止水合数据被回写覆盖） */
  const flushedRef = useRef(new Map<string, number>())
  /** 索引行「部分记录」id 集合：这些对象缺 doc 字段，绝不可回写 API */
  const partialIdsRef = useRef(new Set<string>())
  /** 首轮索引行镜像是否已就绪（就绪前不回写，避免把本地旧缓存当新数据推上去） */
  const mirrorReadyRef = useRef(false)
  /** 阶段计数短缓存（看板列头，避免每次渲染发 9 个请求） */
  const stageCountsCacheRef = useRef<{ at: number; counts: Record<Stage, number> } | null>(null)
  /** 正在回写中的 id（防止并发重复 upsert） */
  const flushInflightRef = useRef(new Set<string>())
  /** 索引行镜像上限：超过则截断并在仪表盘提示（防 5 万条全量进内存） */
  const MIRROR_CAP = 5000

  // doPush 冲突分支需要回调 pullAndApply（两者互相依赖，用 ref 打破循环）
  // 返回值表示是否成功拉取并应用（force=true 时跳过 dirty 竞态防护，供冲突分支使用）
  const pullAndApplyRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false)

  const doPush = useMemo(
    () => async () => {
      if (pushingRef.current) return
      pushingRef.current = true
      setSyncStatus('syncing')
      const { users, resumes, interviews, jobs, applyPrivateKey } = stateRef.current
      // api 模式：候选人走分表 API，信封只同步 users/jobs/interviews/设置等小数据
      const shared: SharedState = {
        users,
        resumes: candidatesModeRef.current === 'api' ? [] : resumes,
        interviews,
        jobs,
        applyPrivateKey,
      }
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
          // api 模式：信封中的 resumes 不再权威（候选人走分表 API），保留本地候选人缓存不被信封覆盖
          baseDispatch({
            type: 'applyRemote',
            ...validation.state,
            resumes: candidatesModeRef.current === 'api' ? stateRef.current.resumes : validation.state.resumes,
          })
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
      // api 模式：简历不写入本机 localStorage 缓存（数据量大且以候选人 API 为准），避免配额溢出
      const resumesToPersist = candidatesModeRef.current === 'api' ? [] : sanitizeResumesForPersist(state.resumes)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, resumes: resumesToPersist }))
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

  // ---- 候选人分表：索引行镜像水合（仪表盘/进展页统计的数据来源） ----
  const hydrateMirror = useMemo(
    () => async (): Promise<void> => {
      const rows: Resume[] = []
      let page = 1
      let total = 0
      for (;;) {
        const res = await candidatesList({ page, size: 200, sort: 'updated_at_desc' })
        total = res.total
        rows.push(...res.items.map(partialResumeFromIndex))
        if (rows.length >= total || rows.length >= MIRROR_CAP || res.items.length === 0) break
        page++
      }
      // 已水合的完整记录（含 doc 字段）不被索引行覆盖；索引行之外的本回话完整记录保留
      const fullById = new Map(
        stateRef.current.resumes.filter((r) => !partialIdsRef.current.has(r.id)).map((r) => [r.id, r]),
      )
      const indexIds = new Set(rows.map((r) => r.id))
      const merged = rows.map((r) => fullById.get(r.id) ?? r)
      const extras = [...fullById.values()].filter((r) => !indexIds.has(r.id))
      // 重建「部分记录」集合与回写基线：索引行标记为部分记录且已与服务端一致
      partialIdsRef.current = new Set(rows.filter((r) => !fullById.has(r.id)).map((r) => r.id))
      for (const r of rows) {
        if (!fullById.has(r.id)) flushedRef.current.set(r.id, r.updatedAt)
      }
      baseDispatch({ type: 'hydrateResumes', resumes: [...merged, ...extras], replace: true })
      mirrorReadyRef.current = true
      setCandidatesTotal(total)
      setCandidatesMirrorCapped(total > MIRROR_CAP)
    },
    [MIRROR_CAP],
  )

  // 启动时检测候选人 API 可用性：可用 → api 模式并拉索引行镜像；不可用 → 信封兼容模式
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = await candidatesHealthCheck()
      if (cancelled) return
      if (ok) {
        setCandidatesMode('api')
        try {
          await hydrateMirror()
        } catch (e) {
          console.warn('候选人索引镜像拉取失败：', e)
        }
      } else {
        setCandidatesMode('legacy')
      }
    })()
    // 连续失败 / 列表 404 → 降级信封兼容模式（candidates.ts 内触发）
    onCandidatesDegraded(() => {
      setCandidatesMode('legacy')
      mirrorReadyRef.current = false
      toast.warning('新存储不可用，已切换到兼容模式')
    })
    return () => {
      cancelled = true
    }
  }, [hydrateMirror])

  // api 模式下每 5 分钟刷新一次索引行镜像（页面隐藏时暂停）
  useEffect(() => {
    if (candidatesMode !== 'api') return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void hydrateMirror().catch(() => {})
    }, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [candidatesMode, hydrateMirror])

  // api 模式：本地完整记录的变更（编辑/备注/阶段流转/导入等）批量回写候选人分表（50 条/批，800ms 合并）
  // flushTick：一批冲刷完成后 +1 触发复检——冲刷进行中产生的新变更（如导入后附件回写，
  // 因 flushInflight 跳过）否则会滞留在本地，直到下一次无关状态变更才被回写
  const [flushTick, setFlushTick] = useState(0)
  useEffect(() => {
    if (candidatesMode !== 'api' || !mirrorReadyRef.current) return
    const changed = state.resumes.filter(
      (r) =>
        !partialIdsRef.current.has(r.id) &&
        !flushInflightRef.current.has(r.id) &&
        (flushedRef.current.get(r.id) ?? -1) < r.updatedAt,
    )
    if (changed.length === 0) return
    const t = setTimeout(() => {
      changed.forEach((r) => flushInflightRef.current.add(r.id))
      void (async () => {
        try {
          await candidatesBulkUpsert(changed, 50)
          for (const r of changed) {
            flushedRef.current.set(r.id, r.updatedAt)
            detailCacheRef.current.set(r.id, r)
          }
          stageCountsCacheRef.current = null
        } catch (e) {
          console.error('候选人回写失败：', e)
          toast.error(e instanceof Error ? e.message : '候选人保存失败，将自动重试')
        } finally {
          changed.forEach((r) => flushInflightRef.current.delete(r.id))
          // 冲刷期间被跳过的新变更触发下一轮检查（幂等：无新变更时 changed 为空直接返回）
          setFlushTick((t) => t + 1)
        }
      })()
    }, 800)
    return () => clearTimeout(t)
  }, [state.resumes, candidatesMode, flushTick])

  // ---- 候选人分表：对外 API ----

  /** 本地（legacy 模式）过滤出与 API 同构的分页结果 */
  const localQuery = useMemo(
    () =>
      (params: CandidateListParams): CandidateListResult => {
        const kw = (params.q ?? '').trim().toLowerCase()
        const filtered = stateRef.current.resumes.filter((r) => {
          if (params.stage && r.stage !== params.stage) return false
          if (params.owner === 'none' && r.lockedBy) return false
          if (params.owner && params.owner !== 'none' && r.lockedBy !== params.owner) return false
          if (params.certSubject && r.certSubject !== params.certSubject) return false
          if (params.certLevel && r.certStage !== params.certLevel) return false
          if (kw && ![r.name, r.university, r.major, ...r.skills, ...r.tags].join(' ').toLowerCase().includes(kw)) return false
          return true
        })
        filtered.sort((a, b) =>
          params.sort === 'updated_at_asc'
            ? a.updatedAt - b.updatedAt
            : params.sort === 'name'
              ? a.name.localeCompare(b.name, 'zh')
              : b.updatedAt - a.updatedAt,
        )
        const size = Math.min(200, Math.max(1, params.size ?? 50))
        const page = Math.max(1, params.page ?? 1)
        return {
          total: filtered.length,
          page,
          size,
          items: filtered.slice((page - 1) * size, page * size).map((r) => ({
            id: r.id,
            name: r.name,
            certLevel: r.certStage || null,
            certSubject: r.certSubject || null,
            school: r.university || null,
            gradYear: r.gradYear > 0 ? r.gradYear : null,
            stage: r.stage,
            owner: r.lockedBy,
            status: 'active',
            tags: r.tags,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
        }
      },
    [],
  )

  const candidatesQuery = useMemo(
    () => async (params: CandidateListParams): Promise<CandidateListResult> => {
      if (candidatesModeRef.current === 'api') return candidatesList(params)
      return localQuery(params)
    },
    [localQuery],
  )

  const candidateDetail = useMemo(
    () => async (id: string): Promise<Resume> => {
      if (candidatesModeRef.current !== 'api') {
        const local = stateRef.current.resumes.find((r) => r.id === id)
        if (!local) throw new Error('简历不存在或已被删除')
        return local
      }
      const cached = detailCacheRef.current.get(id)
      if (cached) return cached
      // 本地已是完整记录（非索引行部分记录）时直接复用
      const local = stateRef.current.resumes.find((r) => r.id === id)
      if (local && !partialIdsRef.current.has(id)) {
        detailCacheRef.current.set(id, local)
        return local
      }
      const full = await candidatesGet(id)
      detailCacheRef.current.set(id, full)
      partialIdsRef.current.delete(id)
      flushedRef.current.set(id, full.updatedAt)
      baseDispatch({ type: 'upsertResumeLocal', resume: full })
      return full
    },
    [],
  )

  const stageCounts = useMemo(
    () => async (): Promise<Record<Stage, number>> => {
      const cached = stageCountsCacheRef.current
      if (cached && Date.now() - cached.at < 15_000) return cached.counts
      let counts: Record<Stage, number>
      if (candidatesModeRef.current === 'api') {
        const entries = await Promise.all(
          STAGE_ORDER.map(async (s) => [s, (await candidatesList({ stage: s, size: 1 })).total] as const),
        )
        counts = Object.fromEntries(entries) as Record<Stage, number>
      } else {
        counts = Object.fromEntries(
          STAGE_ORDER.map((s) => [s, stateRef.current.resumes.filter((r) => r.stage === s).length]),
        ) as Record<Stage, number>
      }
      stageCountsCacheRef.current = { at: Date.now(), counts }
      return counts
    },
    [],
  )

  const updateCandidate = useMemo(
    () => async (resume: Resume): Promise<void> => {
      if (candidatesModeRef.current !== 'api') {
        // legacy：写本地并标记信封待推送
        dirtyRef.current = true
        persistSyncMarks(true)
        baseDispatch({ type: 'upsertResumeLocal', resume })
        return
      }
      await candidatesUpsert(resume)
      partialIdsRef.current.delete(resume.id)
      flushedRef.current.set(resume.id, resume.updatedAt)
      detailCacheRef.current.set(resume.id, resume)
      stageCountsCacheRef.current = null
      baseDispatch({ type: 'upsertResumeLocal', resume })
    },
    [],
  )

  const deleteCandidates = useMemo(
    () => async (ids: string[]): Promise<void> => {
      dispatch({ type: 'deleteResumes', ids })
      if (candidatesModeRef.current !== 'api') return
      let failed = 0
      for (const id of ids) {
        detailCacheRef.current.delete(id)
        partialIdsRef.current.delete(id)
        flushedRef.current.delete(id)
        try {
          await candidatesRemove(id)
        } catch {
          failed++
        }
      }
      stageCountsCacheRef.current = null
      if (failed > 0) toast.error(`${failed} 份简历云端删除失败，请稍后重试`)
    },
    [dispatch],
  )

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
      candidatesMode,
      candidatesQuery,
      candidateDetail,
      stageCounts,
      updateCandidate,
      deleteCandidates,
      refreshCandidatesMirror: hydrateMirror,
      candidatesTotal,
      candidatesMirrorCapped,
    }
  }, [
    state, dispatch, syncStatus, lastSyncAt, syncLocked, syncNow, submitSyncPassphrase, forcePush, syncUrl, setCustomSyncUrl,
    candidatesMode, candidatesQuery, candidateDetail, stageCounts, updateCandidate, deleteCandidates, hydrateMirror,
    candidatesTotal, candidatesMirrorCapped,
  ])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
