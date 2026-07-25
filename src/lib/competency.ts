/** 教师胜任力评估：六维度 0-5 打分、加权汇总为 0-100 总分，附打分理由与风险提醒行 */

import type { Job, Resume } from '@/types'
import { LEVEL_RANK } from '@/lib/match'
import { SUBJECT_MAJORS } from '@/lib/evaluate'

export interface CompetencyDimension {
  key: string
  label: string
  weight: number // 权重（合计 100）
  score: number // 0-5
  reason: string // 打分理由（含 +N 说明）
}

export interface CompetencyAlert {
  level: 'danger' | 'warning' | 'info'
  text: string
}

export interface CompetencyResult {
  total: number // 0-100 加权总分
  grade: 'A' | 'B' | 'C' | 'D'
  dimensions: CompetencyDimension[]
  alerts: CompetencyAlert[]
}

// ---------- 各维度评分（0-5） ----------

/** 学历层次（20%）：学位基础分，全日制 +1（封顶 5），非全日制降一档 */
function dimEducation(r: Resume): CompetencyDimension {
  const baseMap: Record<string, number> = { 博士: 5, 硕士: 4, 本科: 4, 大专: 2, 高中: 1 }
  const base = baseMap[r.education] ?? 0
  let score = base
  let reason = r.education === '未知' ? '学历未知 +0' : `${r.education} +${base}`
  if (r.fullTime === '全日制' && base > 0) {
    score = Math.min(5, base + 1)
    reason = `${r.education}，全日制 +${score}`
  } else if (r.fullTime === '非全日制') {
    score = Math.max(0, base - 1)
    reason = `${r.education}，非全日制降档 +${score}`
  }
  return { key: 'education', label: '学历层次', weight: 20, score, reason }
}

/** 教资匹配（25%）：锁定岗位时按学段/学科一致性评估；未锁定时持有效证书即合格 */
function dimCert(r: Resume, job?: Job | null): CompetencyDimension {
  const label = '教资匹配'
  if (!r.certStage) {
    if (r.certQualified) {
      return { key: 'cert', label, weight: 25, score: 3, reason: '持教师资格考试合格证明，证书待发 +3' }
    }
    return { key: 'cert', label, weight: 25, score: 0, reason: '未取得教师资格证 +0' }
  }
  const certName = `${r.certStage}${r.certSubject || ''}`
  if (!job) {
    return { key: 'cert', label, weight: 25, score: 4, reason: `持${certName}教师资格证 +4` }
  }
  const certRank = LEVEL_RANK[r.certStage] ?? 0
  const jobRank = LEVEL_RANK[job.level] ?? 0
  if (certRank < jobRank) {
    return { key: 'cert', label, weight: 25, score: 1, reason: `教资${r.certStage}，低于岗位学段${job.level} +1` }
  }
  const subjectHit = r.certSubject && r.certSubject === job.subject
  if (certRank === jobRank) {
    return subjectHit
      ? { key: 'cert', label, weight: 25, score: 5, reason: `教资${certName}，与岗位学科一致 +5` }
      : { key: 'cert', label, weight: 25, score: 4, reason: `学段一致，科目（${r.certSubject || '未填'}）与岗位（${job.subject}）不同 +4` }
  }
  return subjectHit
    ? { key: 'cert', label, weight: 25, score: 4, reason: `${r.certStage}教资可覆盖${job.level}岗位，学科一致 +4` }
    : { key: 'cert', label, weight: 25, score: 3, reason: `${r.certStage}教资可覆盖${job.level}岗位，科目不一致 +3` }
}

/** 教学经验（20%） */
function dimExperience(r: Resume): CompetencyDimension {
  const y = r.experience
  const score = y >= 10 ? 5 : y >= 5 ? 4 : y >= 2 ? 3 : y >= 1 ? 2 : 1
  return {
    key: 'experience', label: '教学经验', weight: 20, score,
    reason: y > 0 ? `${y} 年教学经验 +${score}` : '应届/无教学经验 +1',
  }
}

/** 专业对口（15%）：按岗位学科（其次教资科目）比对专业关键词 */
function dimMajor(r: Resume, job?: Job | null): CompetencyDimension {
  const label = '专业对口'
  const subject = job?.subject || r.certSubject || ''
  if (!r.major) {
    return { key: 'major', label, weight: 15, score: 1, reason: '专业信息缺失 +1' }
  }
  if (!subject) {
    return { key: 'major', label, weight: 15, score: 3, reason: `专业：${r.major}（无目标学科可比对）+3` }
  }
  const keywords = SUBJECT_MAJORS[subject] ?? [subject]
  if (keywords.some((k) => r.major.includes(k))) {
    return { key: 'major', label, weight: 15, score: 5, reason: `${r.major}，与${subject}学科对口 +5` }
  }
  if (/师范|教育/.test(r.major)) {
    return { key: 'major', label, weight: 15, score: 3, reason: `${r.major}，教育类专业，与${subject}部分相关 +3` }
  }
  return { key: 'major', label, weight: 15, score: 2, reason: `${r.major}，与${subject}学科相关性较低 +2` }
}

/** 稳定性/毕业年限（10%）：应届稳定性偏低，毕业 3-10 年职业沉淀期最优 */
function dimStability(r: Resume): CompetencyDimension {
  const label = '稳定性'
  if (r.gradYear <= 0) {
    return { key: 'stability', label, weight: 10, score: 3, reason: '毕业年份未知，按中性计 +3' }
  }
  const diff = new Date().getFullYear() - r.gradYear
  if (diff <= 1) {
    return { key: 'stability', label, weight: 10, score: 2, reason: `${r.gradYear} 年毕业，应届稳定性待观察 +2` }
  }
  if (diff <= 3) {
    return { key: 'stability', label, weight: 10, score: 4, reason: `${r.gradYear} 年毕业，初入职场可塑性强 +4` }
  }
  if (diff <= 10) {
    return { key: 'stability', label, weight: 10, score: 5, reason: `${r.gradYear} 年毕业，${diff} 年职业沉淀 +5` }
  }
  return { key: 'stability', label, weight: 10, score: 4, reason: `${r.gradYear} 年毕业，教龄较长需关注知识更新 +4` }
}

/** 片区匹配（10%）：锁定岗位时比对意向标签/籍贯与岗位片区；未锁定按中性计 */
function dimRegion(r: Resume, job?: Job | null): CompetencyDimension {
  const label = '片区匹配'
  if (!job) {
    return { key: 'region', label, weight: 10, score: 3, reason: '未锁定岗位，片区匹配按中性计 +3' }
  }
  if (job.region && r.tags.some((t) => t.includes(job.region))) {
    return { key: 'region', label, weight: 10, score: 5, reason: `意向片区与岗位片区一致（${job.region}）+5` }
  }
  if (job.region && r.hometown && (r.hometown.includes(job.region) || job.region.includes(r.hometown))) {
    return { key: 'region', label, weight: 10, score: 4, reason: `籍贯（${r.hometown}）属岗位片区${job.region} +4` }
  }
  return { key: 'region', label, weight: 10, score: 2, reason: `未见明确片区意向（岗位片区：${job.region}）+2` }
}

// ---------- 风险提醒 ----------

function buildAlerts(r: Resume, job?: Job | null): CompetencyAlert[] {
  const alerts: CompetencyAlert[] = []
  if (r.fullTime === '非全日制') {
    alerts.push({ level: 'warning', text: '非全日制学历，部分公办学校编制岗位可能受限' })
  }
  if (!r.certStage) {
    if (r.certQualified) {
      alerts.push({ level: 'warning', text: `仅持教师资格考试合格证明${r.certNote ? `（${r.certNote}）` : ''}，入职前需完成教师资格认定` })
    } else {
      alerts.push({ level: 'danger', text: '未取得教师资格证，无法办理正式教师岗位入职' })
    }
  }
  if (job && r.certStage) {
    const certRank = LEVEL_RANK[r.certStage] ?? 0
    const jobRank = LEVEL_RANK[job.level] ?? 0
    if (certRank > 0 && certRank < jobRank) {
      alerts.push({ level: 'danger', text: `教师资格证学段（${r.certStage}）低于锁定岗位学段（${job.level}），不符合任职要求` })
    } else if (r.certSubject && job.subject && r.certSubject !== job.subject) {
      alerts.push({ level: 'warning', text: `教资科目（${r.certSubject}）与锁定岗位学科（${job.subject}）不一致` })
    }
  }
  const thisYear = new Date().getFullYear()
  if (r.experience === 0 && r.gradYear > 0 && r.gradYear >= thisYear - 1) {
    alerts.push({ level: 'warning', text: `应届毕业（${r.gradYear} 年）且无教学经验，试讲与实操需重点考察` })
  }
  return alerts
}

/** 生成教师胜任力评估；传入锁定岗位时按岗位口径计算匹配维度 */
export function evaluateCompetency(resume: Resume, job?: Job | null): CompetencyResult {
  const dimensions = [
    dimEducation(resume),
    dimCert(resume, job),
    dimExperience(resume),
    dimMajor(resume, job),
    dimStability(resume),
    dimRegion(resume, job),
  ]
  const total = Math.round(dimensions.reduce((sum, d) => sum + (d.score * d.weight) / 5, 0))
  const grade: CompetencyResult['grade'] = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D'
  return { total, grade, dimensions, alerts: buildAlerts(resume, job) }
}
