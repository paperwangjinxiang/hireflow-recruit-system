import type { Interview, Resume, Stage, StageTransition } from '@/types'
import { FUNNEL_STAGES, STAGE_LABELS } from '@/types'

/**
 * 招聘分析数据引擎：
 * - deriveStageHistory：候选人阶段轨迹推导（新数据读 doc 的 stageHistory；
 *   旧数据从活动记录关键词回填，推不出的用 createdAt 当作 imported 时间）
 * - computeAnalytics：漏斗 / 阶段停留 / 专员绩效 / 渠道效果 四板块统计
 * - 结果内存缓存 5 分钟（页面切换时间范围时避免重复解密 doc）
 */

const DAY = 24 * 60 * 60 * 1000
const CACHE_TTL = 5 * 60 * 1000

// ---- 阶段轨迹推导 ----

const LABEL_TO_STAGE: Record<string, Stage> = Object.fromEntries(
  Object.entries(STAGE_LABELS).map(([k, v]) => [v, k as Stage]),
)

/** 从活动记录文案反推阶段变更（覆盖 store 各阶段变更路径的活动文案） */
function stageFromAction(action: string): Stage | null {
  const m = action.match(/阶段变更为「(.+?)」/) ?? action.match(/回到「(.+?)」/)
  if (m && LABEL_TO_STAGE[m[1]]) return LABEL_TO_STAGE[m[1]]
  if (action.includes('匹配并锁定')) return 'matched'
  if (action.includes('进入录用')) return 'offered'
  if (action.includes('面试未通过')) return 'rejected'
  if (action.includes('回筛选池')) return 'screening'
  if (action.includes('黑名单')) return 'blacklisted'
  return null
}

/**
 * 候选人阶段轨迹：优先用 doc 里的结构化 stageHistory（新数据由 store 阶段变更路径维护）；
 * 缺失时从活动记录回填推导；首尾兜底：起点为 createdAt 的 imported，终点对齐当前阶段。
 */
export function deriveStageHistory(r: Resume): StageTransition[] {
  if (r.stageHistory && r.stageHistory.length > 0) return r.stageHistory
  const events: StageTransition[] = []
  const acts = [...(r.activities ?? [])].sort((a, b) => a.createdAt - b.createdAt)
  for (const a of acts) {
    const s = stageFromAction(a.action)
    if (s && (events.length === 0 || events[events.length - 1].stage !== s)) {
      events.push({ stage: s, at: a.createdAt })
    }
  }
  // 起点兜底：导入时间
  if (events.length === 0 || events[0].stage !== 'imported') {
    events.unshift({ stage: 'imported', at: r.createdAt })
  }
  // 终点兜底：与当前阶段对齐
  const last = events[events.length - 1]
  if (last.stage !== r.stage) {
    events.push({ stage: r.stage, at: Math.max(r.updatedAt, last.at) })
  }
  return events
}

/** 主漏斗阶段序号（rejected/offboarded/blacklisted 等终态不在主漏斗内，返回 -1） */
function funnelIndex(stage: Stage): number {
  return FUNNEL_STAGES.indexOf(stage)
}

/** 候选人「到达过的最深主漏斗阶段」序号（单调口径：进入过 N+1 即视为进入过 N） */
function maxFunnelIndexReached(history: StageTransition[]): number {
  let max = -1
  for (const h of history) {
    const idx = funnelIndex(h.stage)
    if (idx > max) max = idx
  }
  return max
}

// ---- 渠道归类 ----

export type SourceChannel = 'WPS收集表' | '二维码投递' | 'Excel导入' | '手动添加' | '其他'

export const SOURCE_CHANNELS: SourceChannel[] = ['WPS收集表', '二维码投递', 'Excel导入', '手动添加', '其他']

/** 按候选人 source 标记推导渠道；空 source 用导入活动记录兜底 */
export function classifySource(r: Resume): SourceChannel {
  const s = (r.source ?? '').trim()
  if (s.includes('WPS') || s.includes('收集表')) return 'WPS收集表'
  if (s.includes('在线投递') || s.includes('二维码')) return '二维码投递'
  if (/excel|csv|批量导入/i.test(s)) return 'Excel导入'
  if (s.includes('手动')) return '手动添加'
  if (!s) {
    return (r.activities ?? []).some((a) => a.action.includes('批量导入')) ? 'Excel导入' : '手动添加'
  }
  return '其他'
}

// ---- 统计结果类型 ----

export interface FunnelStageStat {
  stage: Stage
  label: string
  /** 进入过该阶段的人数（单调口径） */
  entered: number
  /** 当前处于该阶段的人数 */
  current: number
  /** 上一级 → 本级转化率（首级为 null） */
  conversionFromPrev: number | null
}

export interface StageDwellStat {
  stage: Stage
  label: string
  /** 平均停留天数（含仍在该阶段的候选人：now - 进入时间） */
  avgDays: number
  /** 样本数 */
  samples: number
  /** 平均停留 > 7 天预警 */
  alert: boolean
}

export interface OwnerStat {
  ownerId: string
  ownerName: string
  /** 当前锁定数（matched/interview/offered 且仍持有岗位锁定） */
  locked: number
  /** 累计面试数（归属候选人的面试场次） */
  interviews: number
  /** 录用数（进入过 offered） */
  offered: number
  /** 入职数（进入过 onboarded） */
  onboarded: number
  /** 锁定 → 入职转化率 */
  conversion: number | null
  /** 平均锁定停留天数（matched 阶段停留） */
  avgMatchDwellDays: number | null
}

export interface ChannelStat {
  channel: SourceChannel
  total: number
  reachedInterview: number
  reachedOffered: number
  onboarded: number
  /** 入职转化率 = 入职数 / 总数 */
  onboardRate: number
}

export interface AnalyticsResult {
  computedAt: number
  /** 参与统计的候选人数（doc 解密成功数） */
  sampleSize: number
  funnel: FunnelStageStat[]
  dwell: StageDwellStat[]
  owners: OwnerStat[]
  channels: ChannelStat[]
}

// ---- 主计算 ----

export function computeAnalytics(
  resumes: Resume[],
  interviews: Interview[],
  userNameOf: (id: string) => string,
  now: number,
): AnalyticsResult {
  const histories = new Map<string, StageTransition[]>()
  const maxReached = new Map<string, number>()
  for (const r of resumes) {
    const h = deriveStageHistory(r)
    histories.set(r.id, h)
    maxReached.set(r.id, maxFunnelIndexReached(h))
  }

  // A. 招聘漏斗
  const funnel: FunnelStageStat[] = FUNNEL_STAGES.map((stage, idx) => {
    const entered = resumes.filter((r) => (maxReached.get(r.id) ?? -1) >= idx).length
    const current = resumes.filter((r) => r.stage === stage).length
    return { stage, label: STAGE_LABELS[stage], entered, current, conversionFromPrev: null }
  })
  for (let i = 1; i < funnel.length; i++) {
    funnel[i].conversionFromPrev = funnel[i - 1].entered > 0 ? funnel[i].entered / funnel[i - 1].entered : null
  }

  // B. 阶段停留时长（相邻轨迹时间差；当前阶段用 now - 进入时间）
  const dwellSum = new Map<Stage, { total: number; count: number }>()
  for (const r of resumes) {
    const h = histories.get(r.id)!
    for (let i = 0; i < h.length; i++) {
      const stage = h[i].stage
      if (funnelIndex(stage) < 0) continue // 只统计主漏斗阶段
      const end = i + 1 < h.length ? h[i + 1].at : now
      const days = Math.max(0, (end - h[i].at) / DAY)
      const acc = dwellSum.get(stage) ?? { total: 0, count: 0 }
      acc.total += days
      acc.count += 1
      dwellSum.set(stage, acc)
    }
  }
  const dwell: StageDwellStat[] = FUNNEL_STAGES.map((stage) => {
    const acc = dwellSum.get(stage)
    const avgDays = acc && acc.count > 0 ? acc.total / acc.count : 0
    return { stage, label: STAGE_LABELS[stage], avgDays, samples: acc?.count ?? 0, alert: avgDays > 7 }
  })

  // C. 专员绩效（owner = 锁定人 lockedBy；空 owner 总库不计入）
  const interviewCountByResume = new Map<string, number>()
  for (const iv of interviews) {
    interviewCountByResume.set(iv.resumeId, (interviewCountByResume.get(iv.resumeId) ?? 0) + 1)
  }
  const ownerAcc = new Map<string, {
    owned: number; locked: number; interviews: number; offered: number; onboarded: number
    matchDwellTotal: number; matchDwellCount: number
  }>()
  const offeredIdx = funnelIndex('offered')
  const onboardedIdx = funnelIndex('onboarded')
  const interviewIdx = funnelIndex('interview')
  for (const r of resumes) {
    if (!r.lockedBy) continue
    const acc = ownerAcc.get(r.lockedBy) ?? {
      owned: 0, locked: 0, interviews: 0, offered: 0, onboarded: 0, matchDwellTotal: 0, matchDwellCount: 0,
    }
    acc.owned += 1
    if (r.jobId && (r.stage === 'matched' || r.stage === 'interview' || r.stage === 'offered')) acc.locked += 1
    acc.interviews += interviewCountByResume.get(r.id) ?? 0
    const reached = maxReached.get(r.id) ?? -1
    if (reached >= offeredIdx) acc.offered += 1
    if (reached >= onboardedIdx) acc.onboarded += 1
    // matched 阶段停留（平均锁定停留）
    const h = histories.get(r.id)!
    for (let i = 0; i < h.length; i++) {
      if (h[i].stage !== 'matched') continue
      const end = i + 1 < h.length ? h[i + 1].at : now
      acc.matchDwellTotal += Math.max(0, (end - h[i].at) / DAY)
      acc.matchDwellCount += 1
    }
    ownerAcc.set(r.lockedBy, acc)
  }
  const owners: OwnerStat[] = [...ownerAcc.entries()]
    .map(([ownerId, acc]) => ({
      ownerId,
      ownerName: userNameOf(ownerId),
      locked: acc.locked,
      interviews: acc.interviews,
      offered: acc.offered,
      onboarded: acc.onboarded,
      conversion: acc.owned > 0 ? acc.onboarded / acc.owned : null,
      avgMatchDwellDays: acc.matchDwellCount > 0 ? acc.matchDwellTotal / acc.matchDwellCount : null,
    }))
    .sort((a, b) => b.onboarded - a.onboarded || b.offered - a.offered || b.locked - a.locked)

  // D. 渠道效果
  const channelAcc = new Map<SourceChannel, { total: number; interview: number; offered: number; onboarded: number }>()
  for (const c of SOURCE_CHANNELS) channelAcc.set(c, { total: 0, interview: 0, offered: 0, onboarded: 0 })
  for (const r of resumes) {
    const ch = classifySource(r)
    const acc = channelAcc.get(ch)!
    acc.total += 1
    const reached = maxReached.get(r.id) ?? -1
    if (reached >= interviewIdx) acc.interview += 1
    if (reached >= offeredIdx) acc.offered += 1
    if (reached >= onboardedIdx) acc.onboarded += 1
  }
  const channels: ChannelStat[] = SOURCE_CHANNELS.map((channel) => {
    const acc = channelAcc.get(channel)!
    return {
      channel,
      total: acc.total,
      reachedInterview: acc.interview,
      reachedOffered: acc.offered,
      onboarded: acc.onboarded,
      onboardRate: acc.total > 0 ? acc.onboarded / acc.total : 0,
    }
  }).filter((c) => c.total > 0)

  return { computedAt: now, sampleSize: resumes.length, funnel, dwell, owners, channels }
}

// ---- 并发与缓存工具 ----

/** 并发受限的 map（doc 解密控速，避免打爆 API / 卡死 UI） */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

interface CacheEntry {
  key: string
  at: number
  result: AnalyticsResult
}

let cacheEntry: CacheEntry | null = null

/** 读 5 分钟内存缓存；miss 或过期返回 null */
export function getCachedAnalytics(key: string): AnalyticsResult | null {
  if (cacheEntry && cacheEntry.key === key && Date.now() - cacheEntry.at < CACHE_TTL) return cacheEntry.result
  return null
}

export function setCachedAnalytics(key: string, result: AnalyticsResult): void {
  cacheEntry = { key, at: Date.now(), result }
}
