import type { Job, Resume } from '@/types'

/** 人岗匹配评分：基于教师招聘场景的透明规则打分（0-100），并给出得分理由 */

export interface MatchResult {
  score: number // 0-100
  reasons: string[] // 得分理由，用于悬停/展开解释
}

/** 学段层级：高学段教师资格证可向下覆盖低学段教学 */
export const LEVEL_RANK: Record<string, number> = { 幼儿园: 1, 小学: 2, 初中: 3, 高中: 4 }

/** 教资硬约束检查：证书学段等级 >= 岗位学段等级才合格（高学段证可教低学段） */
export interface CertFitResult {
  level: 'ok' | 'warn' | 'block'
  messages: string[]
}

export function checkCertFit(resume: Resume, job: Job): CertFitResult {
  const certRank = LEVEL_RANK[resume.certStage] ?? 0
  const jobRank = LEVEL_RANK[job.level] ?? 0
  if (!resume.certStage) {
    if (resume.certQualified) {
      return { level: 'warn', messages: ['仅有教师资格考试合格证明，入职前需完成认定'] }
    }
    return { level: 'warn', messages: ['暂无教师资格证信息，请确认是否持有证书或合格证明'] }
  }
  if (certRank < jobRank) {
    return { level: 'block', messages: [`${resume.certStage}教师资格证不满足${job.level}学段要求`] }
  }
  const messages: string[] = []
  if (resume.certSubject && job.subject && resume.certSubject !== job.subject) {
    messages.push(`教资科目（${resume.certSubject}）与岗位学科（${job.subject}）不一致`)
  }
  return messages.length > 0 ? { level: 'warn', messages } : { level: 'ok', messages: [] }
}

export function computeMatchScore(resume: Resume, job: Job): MatchResult {
  let score = 0
  const reasons: string[] = []

  // 1. 学段匹配（40 分）：同学段满分；高学段证教低学段 28 分；无证 0 分
  //    仅有合格证明（未取得证书）时按有证的 80% 计分
  const certRank = LEVEL_RANK[resume.certStage] ?? 0
  const jobRank = LEVEL_RANK[job.level] ?? 0
  if (certRank > 0 && certRank === jobRank) {
    score += 40
    reasons.push(`${job.level}教资同学段 +40`)
  } else if (certRank > jobRank && jobRank > 0) {
    score += 28
    reasons.push(`${resume.certStage}教资可覆盖${job.level} +28`)
  } else if (certRank > 0) {
    reasons.push(`教资学段（${resume.certStage}）低于岗位学段 +0`)
  } else if (resume.certQualified) {
    score += 32
    reasons.push('仅持教师资格考试合格证明（按有证 80% 计）+32')
  } else {
    reasons.push('无教师资格证 +0')
  }

  // 2. 学科匹配（30 分）：岗位学科与教资科目一致
  if (resume.certSubject && resume.certSubject === job.subject) {
    score += 30
    reasons.push(`学科一致（${job.subject}）+30`)
  } else if (resume.certSubject) {
    reasons.push(`教资科目（${resume.certSubject}）与岗位学科（${job.subject}）不同 +0`)
  }

  // 3. 教学经验（15 分）
  if (resume.experience >= 5) {
    score += 15
    reasons.push(`${resume.experience} 年经验 +15`)
  } else if (resume.experience >= 2) {
    score += 10
    reasons.push(`${resume.experience} 年经验 +10`)
  } else if (resume.experience >= 1) {
    score += 5
    reasons.push(`${resume.experience} 年经验 +5`)
  } else {
    score += 2
    reasons.push('应届/无经验 +2')
  }

  // 4. 学历（10 分）
  if (resume.education === '博士' || resume.education === '硕士') {
    score += 10
    reasons.push(`${resume.education}学历 +10`)
  } else if (resume.education === '本科') {
    score += 7
    reasons.push('本科学历 +7')
  } else if (resume.education === '大专') {
    score += 3
    reasons.push('大专学历 +3')
  }

  // 5. 加分项（最多 5 分）：师范背景 / 985/211 / 班主任经验 / 全日制
  let bonus = 0
  if (resume.tags.includes('师范背景')) bonus += 2
  if (resume.tags.includes('985/211')) bonus += 2
  if (resume.tags.includes('班主任经验')) bonus += 2
  if (resume.fullTime === '全日制') bonus += 1
  bonus = Math.min(bonus, 5)
  if (bonus > 0) {
    score += bonus
    reasons.push(`背景加分 +${bonus}`)
  }

  return { score: Math.min(score, 100), reasons }
}

export function scoreColor(score: number): string {
  if (score >= 80) return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  if (score >= 60) return 'bg-sky-100 text-sky-700 border-sky-200'
  if (score >= 40) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-slate-100 text-slate-500 border-slate-200'
}

export function scoreLabel(score: number): string {
  if (score >= 80) return '高度匹配'
  if (score >= 60) return '较为匹配'
  if (score >= 40) return '部分匹配'
  return '匹配度低'
}
