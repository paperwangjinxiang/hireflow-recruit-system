import type { Interview, Resume, Stage } from '@/types'
import { interviewStatusOf } from '@/lib/interview-utils'

/** 智能提醒引擎：扫描简历库与面试数据，产出可行动的提醒项 */

export type ReminderLevel = 'urgent' | 'warn' | 'info'

export interface Reminder {
  id: string
  level: ReminderLevel
  icon: 'interview' | 'stale' | 'unassigned' | 'duplicate' | 'feedback' | 'lock'
  title: string
  detail: string
  /** 点击后跳转到简历库并自动套用的筛选 */
  filter?: { stage?: Stage; assignee?: 'unassigned' | 'me' }
}

const DAY = 24 * 60 * 60 * 1000

/** 处于终态（不再活跃跟进）的阶段 */
const TERMINAL: Stage[] = ['rejected', 'onboarded', 'offboarded', 'blacklisted']

export function computeReminders(resumes: Resume[], interviews: Interview[]): Reminder[] {
  const now = Date.now()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const reminders: Reminder[] = []

  // 1. 今日面试
  const todayInterviews = interviews.filter((iv) => interviewStatusOf(iv) === 'pending' && iv.time >= todayStart.getTime() && iv.time < todayStart.getTime() + DAY)
  if (todayInterviews.length > 0) {
    const names = todayInterviews
      .slice(0, 3)
      .map((iv) => `${new Date(iv.time).getHours()}:00 ${iv.candidateName ?? resumes.find((r) => r.id === iv.resumeId)?.name ?? ''}`)
      .join('、')
    reminders.push({
      id: 'today-interview',
      level: 'urgent',
      icon: 'interview',
      title: `今天有 ${todayInterviews.length} 场面试`,
      detail: names + (todayInterviews.length > 3 ? ` 等 ${todayInterviews.length} 场` : ''),
      filter: { stage: 'interview' },
    })
  }

  // 1.5 面试前 2 小时提醒（面试官与 HR 需提前准备）
  const soonInterviews = interviews.filter((iv) => interviewStatusOf(iv) === 'pending' && iv.time > now && iv.time <= now + 2 * 60 * 60 * 1000)
  if (soonInterviews.length > 0) {
    const detail = soonInterviews
      .slice(0, 3)
      .map((iv) => {
        const t = new Date(iv.time)
        const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
        const name = iv.candidateName ?? resumes.find((r) => r.id === iv.resumeId)?.name ?? '候选人'
        return `${hhmm} ${name}（${iv.round}）`
      })
      .join('、')
    reminders.push({
      id: 'soon-interview',
      level: 'urgent',
      icon: 'interview',
      title: `${soonInterviews.length} 场面试将在 2 小时内开始`,
      detail: detail + (soonInterviews.length > 3 ? ` 等 ${soonInterviews.length} 场` : '') + '，请相关面试官与 HR 提前准备',
      filter: { stage: 'interview' },
    })
  }

  // 2. 面试已过期待反馈（超 12 小时仍待面试且无任何评价）
  const overdueFeedback = interviews.filter(
    (iv) => interviewStatusOf(iv) === 'pending' && iv.time < now - 12 * 60 * 60 * 1000 && !(iv.evaluations && iv.evaluations.length > 0),
  )
  if (overdueFeedback.length > 0) {
    reminders.push({
      id: 'overdue-feedback',
      level: 'warn',
      icon: 'feedback',
      title: `${overdueFeedback.length} 场面试已过期待反馈`,
      detail: '及时记录面试结果，避免候选人等待过久',
      filter: { stage: 'interview' },
    })
  }

  // 2.5 面试结束超 24 小时未填写结构化评价：点名提醒相关面试官
  const noEval = interviews.filter(
    (iv) => interviewStatusOf(iv) === 'pending' && iv.time < now - 24 * 60 * 60 * 1000 && !(iv.evaluations && iv.evaluations.length > 0),
  )
  if (noEval.length > 0) {
    reminders.push({
      id: 'evaluation-overdue',
      level: 'warn',
      icon: 'feedback',
      title: `${noEval.length} 场面试结束超 24 小时未填写评价`,
      detail: '请相关面试官尽快在「面试管理」中补填结构化评价',
      filter: { stage: 'interview' },
    })
  }

  // 3. 新导入简历滞留（超过 2 天未筛选）
  const staleNew = resumes.filter((r) => r.stage === 'imported' && now - r.updatedAt > 2 * DAY)
  if (staleNew.length > 0) {
    reminders.push({
      id: 'stale-new',
      level: 'warn',
      icon: 'stale',
      title: `${staleNew.length} 份新导入简历超过 2 天未筛选`,
      detail: `最早一份已滞留 ${Math.floor((now - Math.min(...staleNew.map((r) => r.updatedAt))) / DAY)} 天`,
      filter: { stage: 'imported' },
    })
  }

  // 4. 岗位锁定超 3 天未安排面试
  const staleLocked = resumes.filter((r) => r.stage === 'matched' && r.lockedAt && now - r.lockedAt > 3 * DAY)
  if (staleLocked.length > 0) {
    reminders.push({
      id: 'stale-locked',
      level: 'warn',
      icon: 'lock',
      title: `${staleLocked.length} 份简历锁定超 3 天未安排面试`,
      detail: '长时间占用岗位锁定会影响其他同事匹配，请尽快安排面试或释放',
      filter: { stage: 'matched' },
    })
  }

  // 5. 流程滞留（筛选/面试超过 5 天）
  const staleFlow = resumes.filter((r) => (r.stage === 'screening' || r.stage === 'interview') && now - r.updatedAt > 5 * DAY)
  if (staleFlow.length > 0) {
    const byStage = (s: Stage) => staleFlow.filter((r) => r.stage === s).length
    reminders.push({
      id: 'stale-flow',
      level: 'warn',
      icon: 'stale',
      title: `${staleFlow.length} 份简历流程滞留超 5 天`,
      detail: `筛选中 ${byStage('screening')} 份 · 面试中 ${byStage('interview')} 份`,
      filter: { stage: 'screening' },
    })
  }

  // 5.1 筛选滞留：screening 超 3 天未推进（提醒 HR 尽快出筛选结论；镜像字段足够，无需拉 doc）
  const staleScreening = resumes.filter((r) => r.stage === 'screening' && now - r.updatedAt > 3 * DAY)
  if (staleScreening.length > 0) {
    reminders.push({
      id: 'stale-screening',
      level: 'warn',
      icon: 'stale',
      title: `${staleScreening.length} 份简历筛选中超 3 天未推进`,
      detail: `最早一份已滞留 ${Math.floor((now - Math.min(...staleScreening.map((r) => r.updatedAt))) / DAY)} 天，请 HR 尽快给出筛选结论`,
      filter: { stage: 'screening' },
    })
  }

  // 5.2 锁定滞留：matched 超 5 天未安排面试（提醒对应负责人；镜像无 lockedAt 时用 updatedAt 兜底）
  const staleMatched = resumes.filter((r) => r.stage === 'matched' && now - (r.lockedAt ?? r.updatedAt) > 5 * DAY)
  if (staleMatched.length > 0) {
    const ownerCount = new Set(staleMatched.map((r) => r.lockedBy).filter(Boolean)).size
    reminders.push({
      id: 'stale-matched',
      level: 'warn',
      icon: 'lock',
      title: `${staleMatched.length} 份锁定简历超 5 天未安排面试`,
      detail: `涉及 ${ownerCount} 位负责人，请尽快安排面试或释放锁定`,
      filter: { stage: 'matched' },
    })
  }

  // 5.3 录用滞留：offered 超 7 天未入职（提醒跟进入职手续）
  const staleOffered = resumes.filter((r) => r.stage === 'offered' && now - r.updatedAt > 7 * DAY)
  if (staleOffered.length > 0) {
    reminders.push({
      id: 'stale-offered',
      level: 'warn',
      icon: 'stale',
      title: `${staleOffered.length} 份录用简历超 7 天未入职`,
      detail: '请跟进候选人入职手续，避免录用流失',
      filter: { stage: 'offered' },
    })
  }

  // 6. 未分配简历
  const unassigned = resumes.filter((r) => !r.assigneeId && !TERMINAL.includes(r.stage))
  if (unassigned.length > 0) {
    reminders.push({
      id: 'unassigned',
      level: 'info',
      icon: 'unassigned',
      title: `${unassigned.length} 份简历未分配负责人`,
      detail: '分配后跟进更及时',
      filter: { assignee: 'unassigned' },
    })
  }

  // 7. 疑似重复简历（同手机号或同邮箱）
  const seen = new Map<string, number>()
  resumes.forEach((r) => {
    const key = r.phone || r.email
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1)
  })
  const dupGroups = [...seen.values()].filter((c) => c > 1).length
  if (dupGroups > 0) {
    reminders.push({
      id: 'duplicate',
      level: 'info',
      icon: 'duplicate',
      title: `发现 ${dupGroups} 组疑似重复简历`,
      detail: '相同手机号或邮箱出现多次，建议合并清理',
    })
  }

  // 按级别排序：urgent > warn > info
  const order: Record<ReminderLevel, number> = { urgent: 0, warn: 1, info: 2 }
  return reminders.sort((a, b) => order[a.level] - order[b.level])
}

export const LEVEL_STYLES: Record<ReminderLevel, { dot: string; text: string }> = {
  urgent: { dot: 'bg-rose-500', text: 'text-rose-700' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-700' },
  info: { dot: 'bg-sky-500', text: 'text-sky-700' },
}
