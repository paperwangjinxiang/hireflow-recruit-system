import type {
  EvaluationConclusion,
  Interview,
  InterviewEvaluation,
  InterviewStatus,
  InterviewType,
} from '@/types'

/**
 * 面试管理工具函数：兼容旧数据（缺 type/status/interviewerIds/evaluations 字段）的推导逻辑集中在这里。
 */

/** 试讲类评价维度 */
export const DEMO_DIMENSIONS = ['教学设计', '课堂表现与表达', '学科专业素养', '教态仪表', '应变能力']
/** 非试讲类评价维度 */
export const GENERAL_DIMENSIONS = ['专业匹配度', '沟通表达', '求职动机', '稳定性', '综合印象']

export function dimensionsOf(type: InterviewType): string[] {
  return type === '试讲' ? DEMO_DIMENSIONS : GENERAL_DIMENSIONS
}

/** 面试类型（旧数据无 type 字段时按 round 推导：试讲→试讲，其余→结构化面试） */
export function interviewTypeOf(iv: Interview): InterviewType {
  if (iv.type) return iv.type
  return iv.round === '试讲' ? '试讲' : '结构化面试'
}

/** 进行状态（旧数据无 status 字段时按 result 推导） */
export function interviewStatusOf(iv: Interview): InterviewStatus {
  if (iv.status) return iv.status
  return iv.result === 'pending' ? 'pending' : 'completed'
}

/** 全部面试官 id（旧数据回退为单个 interviewerId） */
export function interviewerIdsOf(iv: Interview): string[] {
  return iv.interviewerIds && iv.interviewerIds.length > 0 ? iv.interviewerIds : [iv.interviewerId]
}

/** 单条评价的等权平均分（保留 1 位小数展示用原始值） */
export function evalAvg(ev: InterviewEvaluation): number {
  const vals = Object.values(ev.scores)
  if (vals.length === 0) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** 一场面试多面试官评价的总平均分；无评价返回 null */
export function interviewAvgScore(iv: Interview): number | null {
  if (!iv.evaluations || iv.evaluations.length === 0) return null
  return iv.evaluations.reduce((s, e) => s + evalAvg(e), 0) / iv.evaluations.length
}

/** 一场面试的结论（取最新提交的一条评价结论）；无评价返回 null */
export function interviewConclusion(iv: Interview): EvaluationConclusion | null {
  if (!iv.evaluations || iv.evaluations.length === 0) return null
  const latest = [...iv.evaluations].sort((a, b) => b.submittedAt - a.submittedAt)[0]
  return latest.conclusion
}

const HOUR = 60 * 60 * 1000

/**
 * 时间冲突检测：同一面试官在目标时间 ±1 小时内已有其他未取消面试。
 * 返回冲突的面试列表（仅提示，不强制阻断）。
 */
export function findConflicts(
  interviews: Interview[],
  time: number,
  interviewerIds: string[],
  excludeId?: string,
): Interview[] {
  if (!time || interviewerIds.length === 0) return []
  return interviews.filter(
    (iv) =>
      iv.id !== excludeId &&
      interviewStatusOf(iv) === 'pending' &&
      Math.abs(iv.time - time) < HOUR &&
      interviewerIdsOf(iv).some((id) => interviewerIds.includes(id)),
  )
}

/** 一场面试是否与任意其他面试存在时间冲突（用于卡片警告标识） */
export function hasConflict(iv: Interview, all: Interview[]): boolean {
  if (interviewStatusOf(iv) !== 'pending') return false
  return findConflicts(all, iv.time, interviewerIdsOf(iv), iv.id).length > 0
}
