/** 多维度综合评估引擎：面向教师招聘场景的透明规则打分（0-100），输出维度明细与风险提示 */

import type { Job, Resume } from '@/types'
import { computeMatchScore } from '@/lib/match'

export interface EvalDimension {
  key: string
  label: string
  score: number // 0-100
  weight: number // 权重（合计 100）
  reason: string
}

export interface EvalAlert {
  level: 'danger' | 'warning' | 'info'
  text: string
}

export interface Evaluation {
  overall: number // 0-100
  grade: 'A' | 'B' | 'C' | 'D'
  dimensions: EvalDimension[]
  alerts: EvalAlert[]
  matchScore?: number
  matchReasons?: string[]
}

const LEVEL_RANK: Record<string, number> = { 幼儿园: 1, 小学: 2, 初中: 3, 高中: 4 }

/** 学科 → 对口专业关键词（专业命中任一即视为对口） */
const SUBJECT_MAJORS: Record<string, string[]> = {
  语文: ['汉语言', '中文', '语文教育', '汉语国际教育', '中国语言文学', '对外汉语'],
  数学: ['数学', '应用数学', '数理', '统计学'],
  英语: ['英语', '商务英语', '翻译'],
  物理: ['物理', '应用物理'],
  化学: ['化学', '应用化学', '材料化学'],
  生物: ['生物', '生命科学'],
  历史: ['历史', '文博'],
  地理: ['地理', '地球科学'],
  政治: ['思想政治', '政治', '马克思主义', '哲学'],
  音乐: ['音乐', '声乐', '器乐'],
  体育: ['体育', '运动训练'],
  美术: ['美术', '绘画', '艺术设计', '视觉传达'],
  信息技术: ['计算机', '软件', '信息技术', '教育技术', '电子信息'],
  科学: ['科学教育', '物理', '化学', '生物'],
  心理健康: ['心理学', '心理健康', '应用心理'],
}

/** 师范类院校关键词 */
const NORMAL_UNIVERSITIES = [
  '北京师范大学', '华东师范大学', '华中师范大学', '华南师范大学', '东北师范大学', '陕西师范大学',
  '南京师范大学', '湖南师范大学', '首都师范大学', '福建师范大学', '山东师范大学', '安徽师范大学',
  '河南师范大学', '江西师范大学', '天津师范大学', '河北师范大学', '浙江师范大学', '四川师范大学',
  '重庆师范大学', '广西师范大学', '云南师范大学', '贵州师范大学', '辽宁师范大学', '吉林师范大学',
  '哈尔滨师范大学', '江苏师范大学', '广东技术师范大学', '岭南师范学院', '韩山师范学院',
]

const TOP_UNI_KEYWORDS = ['北京师范', '华东师范', '华中师范', '清华', '北京大学', '复旦', '中山大学', '华南理工', '暨南大学', '浙江大学', '南京大学', '武汉大学']

/** 目标学科：优先岗位学科，其次教资科目 */
function targetSubject(resume: Resume, job?: Job | null): string {
  return job?.subject || resume.certSubject || ''
}

// ---------- 各维度评分 ----------

function evalEducation(resume: Resume): EvalDimension {
  const base: Record<string, number> = { 博士: 100, 硕士: 85, 本科: 70, 大专: 40, 高中: 20 }
  let score = base[resume.education] ?? 15
  let reason = `${resume.education === '未知' ? '学历未知' : resume.education}`
  if (resume.fullTime === '非全日制') {
    score = Math.max(10, Math.round(score * 0.75))
    reason += '（非全日制降档）'
  } else if (resume.fullTime === '全日制') {
    reason += '（全日制）'
  }
  return { key: 'education', label: '学历层次', score, weight: 20, reason }
}

function evalCert(resume: Resume, job?: Job | null): EvalDimension {
  if (!resume.certStage) {
    if (resume.certQualified) {
      return { key: 'cert', label: '教师资格证', score: 80, weight: 20, reason: '持教师资格考试合格证明（按有证 80% 计），入职前需完成认定' }
    }
    return { key: 'cert', label: '教师资格证', score: 0, weight: 20, reason: '未取得教师资格证' }
  }
  const label = `${resume.certStage}${resume.certSubject ? resume.certSubject : ''}教师资格证`
  if (!job) {
    return { key: 'cert', label: '教师资格证', score: 100, weight: 20, reason: label }
  }
  const certRank = LEVEL_RANK[resume.certStage] ?? 0
  const jobRank = LEVEL_RANK[job.level] ?? 0
  if (certRank === jobRank) {
    return { key: 'cert', label: '教师资格证', score: 100, weight: 20, reason: `${label}，与岗位学段一致` }
  }
  if (certRank > jobRank) {
    return { key: 'cert', label: '教师资格证', score: 85, weight: 20, reason: `${label}，可覆盖${job.level}岗位` }
  }
  return { key: 'cert', label: '教师资格证', score: 25, weight: 20, reason: `${label}，学段低于${job.level}岗位要求` }
}

function evalMajor(resume: Resume, job?: Job | null): EvalDimension {
  const subject = targetSubject(resume, job)
  const major = resume.major
  if (!major) {
    return { key: 'major', label: '专业对口', score: 30, weight: 15, reason: '专业信息缺失' }
  }
  if (!subject) {
    return { key: 'major', label: '专业对口', score: 60, weight: 15, reason: `专业：${major}（无目标学科可比对）` }
  }
  const keywords = SUBJECT_MAJORS[subject] ?? [subject]
  if (keywords.some((k) => major.includes(k))) {
    return { key: 'major', label: '专业对口', score: 100, weight: 15, reason: `${major} 与${subject}学科对口` }
  }
  if (/师范|教育/.test(major)) {
    return { key: 'major', label: '专业对口', score: 65, weight: 15, reason: `${major} 为教育类专业，与${subject}学科部分相关` }
  }
  return { key: 'major', label: '专业对口', score: 30, weight: 15, reason: `${major} 与${subject}学科相关性较低` }
}

function evalExperience(resume: Resume): EvalDimension {
  const y = resume.experience
  let score: number
  if (y >= 10) score = 100
  else if (y >= 5) score = 85
  else if (y >= 2) score = 70
  else if (y >= 1) score = 55
  else score = 35
  return { key: 'experience', label: '教学经验', score, weight: 15, reason: y > 0 ? `${y} 年教学经验` : '应届/无教学经验' }
}

function evalUniversity(resume: Resume): EvalDimension {
  const u = resume.university
  if (!u) return { key: 'university', label: '院校背景', score: 30, weight: 10, reason: '院校信息缺失' }
  if (NORMAL_UNIVERSITIES.some((n) => u.includes(n))) {
    return { key: 'university', label: '院校背景', score: 100, weight: 10, reason: `${u}（师范类院校）` }
  }
  if (u.includes('师范') || u.includes('教育学院')) {
    return { key: 'university', label: '院校背景', score: 90, weight: 10, reason: `${u}（师范类院校）` }
  }
  if (TOP_UNI_KEYWORDS.some((n) => u.includes(n))) {
    return { key: 'university', label: '院校背景', score: 85, weight: 10, reason: `${u}（重点高校）` }
  }
  return { key: 'university', label: '院校背景', score: 60, weight: 10, reason: u }
}

function evalCerts(resume: Resume): EvalDimension {
  const pts: string[] = []
  let score = 0
  const certs = resume.certificates
  if (certs.some((c) => c.includes('普通话一级'))) { score += 40; pts.push('普通话一级') }
  else if (certs.some((c) => c.includes('普通话二级甲等'))) { score += 30; pts.push('普通话二甲') }
  else if (certs.some((c) => c.includes('普通话'))) { score += 20; pts.push('普通话') }
  if (certs.some((c) => /CET-6|英语六级|专八/.test(c))) { score += 25; pts.push('英语六级及以上') }
  else if (certs.some((c) => /CET-4|英语四级|专四|雅思|托福/.test(c))) { score += 15; pts.push('英语等级证书') }
  if (certs.some((c) => c.includes('计算机'))) { score += 15; pts.push('计算机等级') }
  if (certs.some((c) => /心理健康|心理咨询/.test(c))) { score += 15; pts.push('心理健康类证书') }
  if (resume.skills.length >= 5) { score += 5 }
  score = Math.min(score, 100)
  return {
    key: 'certs', label: '证书与技能', score, weight: 10,
    reason: pts.length > 0 ? pts.join('、') : '暂无加分证书',
  }
}

function evalAge(resume: Resume): EvalDimension {
  const age = resume.age
  if (age <= 0) return { key: 'age', label: '年龄适配', score: 60, weight: 5, reason: '年龄未知' }
  let score: number
  if (age >= 22 && age <= 40) score = 100
  else if (age < 22) score = 80
  else if (age <= 45) score = 70
  else score = Math.max(20, 70 - (age - 45) * 10)
  return { key: 'age', label: '年龄适配', score, weight: 5, reason: `${age} 岁` }
}

// ---------- 风险提示 ----------

function buildAlerts(resume: Resume, job?: Job | null): EvalAlert[] {
  const alerts: EvalAlert[] = []
  if (resume.fullTime === '非全日制') {
    alerts.push({ level: 'warning', text: '非全日制学历，部分公办学校编制岗位可能受限' })
  }
  if (!resume.certStage) {
    if (resume.certQualified) {
      alerts.push({ level: 'info', text: '持有教师资格考试合格证明，入职前需完成教师资格认定' })
    } else {
      alerts.push({ level: 'danger', text: '未取得教师资格证，无法办理正式教师岗位入职' })
    }
  }
  if (job && resume.certStage) {
    const certRank = LEVEL_RANK[resume.certStage] ?? 0
    const jobRank = LEVEL_RANK[job.level] ?? 0
    if (certRank > 0 && certRank < jobRank) {
      alerts.push({ level: 'danger', text: `教师资格证学段（${resume.certStage}）低于岗位学段（${job.level}），不符合任职要求` })
    }
  }
  const thisYear = new Date().getFullYear()
  if (resume.experience === 0 && resume.gradYear >= thisYear - 1 && resume.gradYear > 0) {
    alerts.push({ level: 'info', text: `应届毕业生（${resume.gradYear} 年毕业），教学实操经验有待考察` })
  }
  if (resume.age > 45) {
    alerts.push({ level: 'warning', text: `${resume.age} 岁，超出多数教师招聘岗位的年龄上限（45 岁）` })
  }
  if (!resume.rawText && resume.source !== 'WPS收集表') {
    alerts.push({ level: 'info', text: '未解析到简历原文，评估仅基于结构化字段' })
  }
  return alerts
}

// ---------- 岗位匹配 ----------

function buildMatch(resume: Resume, job: Job): { score: number; reasons: string[] } {
  const base = computeMatchScore(resume, job)
  let score = base.score
  const reasons = [...base.reasons]
  // 片区意向：智能标签/备注含岗位片区名
  if (job.region && resume.tags.some((t) => t.includes(job.region))) {
    score = Math.min(score + 5, 100)
    reasons.push(`意向片区一致（${job.region}）+5`)
  }
  // 宿舍需求：岗位提供宿舍且候选人原文/标签提到住宿需求
  if (job.dormitory && (resume.rawText.includes('宿舍') || resume.tags.some((t) => t.includes('住宿') || t.includes('宿舍')))) {
    reasons.push('岗位提供宿舍，符合候选人住宿需求')
  }
  return { score, reasons }
}

/** 生成简历综合评估；传入 job 时附带岗位匹配度 */
export function evaluateResume(resume: Resume, job?: Job | null): Evaluation {
  const dimensions = [
    evalEducation(resume),
    evalCert(resume, job),
    evalMajor(resume, job),
    evalExperience(resume),
    evalUniversity(resume),
    evalCerts(resume),
    evalAge(resume),
  ]
  const overall = Math.round(dimensions.reduce((sum, d) => sum + (d.score * d.weight) / 100, 0))
  const grade: Evaluation['grade'] = overall >= 85 ? 'A' : overall >= 70 ? 'B' : overall >= 55 ? 'C' : 'D'
  const alerts = buildAlerts(resume, job)
  const evaluation: Evaluation = { overall, grade, dimensions, alerts }
  if (job) {
    const m = buildMatch(resume, job)
    evaluation.matchScore = m.score
    evaluation.matchReasons = m.reasons
  }
  return evaluation
}

export const GRADE_COLORS: Record<Evaluation['grade'], string> = {
  A: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  B: 'bg-sky-100 text-sky-700 border-sky-200',
  C: 'bg-amber-100 text-amber-700 border-amber-200',
  D: 'bg-rose-100 text-rose-700 border-rose-200',
}

export const GRADE_LABELS: Record<Evaluation['grade'], string> = {
  A: '优秀',
  B: '良好',
  C: '一般',
  D: '偏弱',
}
