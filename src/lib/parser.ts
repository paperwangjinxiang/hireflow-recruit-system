/** 本地智能解析引擎：从简历纯文本中抽取结构化字段（教师招聘场景：中文简历规则 + 词典） */

import { CERTIFICATE_DICT, deriveTags } from '@/lib/tags'
import { TEACHER_SUBJECTS, type CertStage, type FullTime } from '@/types'
import { regionFromIdCard, genderFromIdCard, ageFromIdCard, isValidIdCard } from '@/lib/regions'

export interface ParsedFields {
  name: string
  phone: string
  email: string
  position: string
  education: string
  experience: number
  skills: string[]
  university: string
  company: string
  certificates: string[]
  tags: string[]
  age: number
  certStage: CertStage
  certSubject: string
  /** 仅持「中小学教师资格考试合格证明」、未见教师资格证 */
  certQualified: boolean
  gradYear: number
  hometown: string
  fullTime: FullTime
  major: string
  /** 身份证号（18 位，从正文提取；GB11643 校验失败时置空） */
  idCard: string
  /** 性别（由身份证号第 17 位推断） */
  gender: '男' | '女' | ''
  /** 各字段置信度：字段键（low 的字段会在 UI 中提示人工确认）或中文提醒文案 */
  lowConfidence: string[]
}

const POSITION_KEYWORDS = [
  '高中语文教师', '高中数学教师', '高中英语教师', '高中物理教师', '高中化学教师', '高中生物教师',
  '高中历史教师', '高中地理教师', '高中政治教师',
  '初中语文教师', '初中数学教师', '初中英语教师', '初中物理教师', '初中化学教师', '初中生物教师',
  '初中历史教师', '初中地理教师', '初中政治教师', '初中道法教师',
  '小学语文教师', '小学数学教师', '小学英语教师', '小学科学教师',
  '语文教师', '数学教师', '英语教师', '物理教师', '化学教师', '生物教师',
  '历史教师', '地理教师', '政治教师', '音乐教师', '体育教师', '美术教师',
  '信息技术教师', '科学教师', '心理健康教师', '幼儿园教师', '幼师',
  '班主任', '教研组长', '年级组长', '教务主任', '教学主管', '辅导员', '助教', '讲师',
]

const SKILL_DICT = [
  '教学设计', '课程开发', '班级管理', '班主任工作', '教研活动', '试卷命题', '学情分析',
  '分层教学', '因材施教', '家校沟通', '公开课', '说课', '试讲', '听课评课',
  '新课标', '核心素养', '多媒体教学', '智慧课堂', '翻转课堂', '项目式学习',
  '中高考备考', '竞赛辅导', '奥数辅导', '作文指导', '口语训练', '书法',
  '心理辅导', '德育工作', '少先队工作', '社团指导', '校本课程',
  'Excel', 'PPT', 'Word', '数据分析',
]

const EDU_RANK: [string, number][] = [
  ['博士后', 6], ['博士', 5], ['PhD', 5], ['MBA', 4], ['硕士', 4], ['研究生', 4],
  ['本科', 3], ['学士', 3], ['统招本科', 3], ['大专', 2], ['专科', 2], ['高中', 1], ['中专', 1], ['中师', 1],
]

const NAME_STOPWORDS = ['简历', '求职', '应聘', '个人', '电话', '手机', '邮箱', '地址', '男', '女', '岁', '学历', '经验', '本科', '硕士', '大专', '期望', '意向', '教师']

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

function extractName(ls: string[], fileName: string): { name: string; confident: boolean } {
  for (const l of ls.slice(0, 10)) {
    const m = l.match(/姓\s*名[:：\s]\s*([一-龥·]{2,5})/) ?? l.match(/Name[:：\s]\s*([A-Za-z][A-Za-z\s.]{1,30})/i)
    if (m) return { name: m[1].trim(), confident: true }
  }
  for (const l of ls.slice(0, 6)) {
    const clean = l.replace(/\s+/g, '')
    if (/^[一-龥·]{2,4}$/.test(clean) && !NAME_STOPWORDS.some((w) => clean.includes(w))) {
      return { name: clean, confident: true }
    }
  }
  const stem = fileName.replace(/\.[^.]+$/, '')
  for (const token of stem.split(/[-_—–\s]+/)) {
    if (/^[一-龥·]{2,4}$/.test(token) && !NAME_STOPWORDS.some((w) => token.includes(w))) {
      return { name: token, confident: false }
    }
  }
  return { name: '', confident: false }
}

function extractPosition(text: string): { position: string; confident: boolean } {
  const m = text.match(/(?:求职意向|意向岗位|意向职位|应聘职位|期望职位|目标职位|求职岗位|应聘岗位)[:：\s]*([^\n，,；;|]{2,20})/)
  if (m) return { position: m[1].trim(), confident: true }
  for (const kw of POSITION_KEYWORDS) {
    if (text.includes(kw)) return { position: kw, confident: false }
  }
  return { position: '', confident: false }
}

/** 学历标签出现处是否为负向语境（在读博士/博士后/博士生导师等，非本人已获学历） */
function isNegativeEducationContext(text: string, label: string, idx: number): boolean {
  if (label === '博士后') return true // 博士后是工作经历而非学历，整体排除
  const before = text.slice(Math.max(0, idx - 4), idx)
  const after = text.slice(idx + label.length, idx + label.length + 4)
  if (/在读$/.test(before) || /^在读/.test(after)) return true // 在读博士/博士在读：尚未取得
  if (label === '博士' && /^后/.test(after)) return true // 博士后：工作经历而非学历
  if (/^生?导师/.test(after)) return true // 博士生导师：身份而非本人学历
  return false
}

/** 学历标签是否存在正向（非负向语境）出现处 */
function hasEducationOccurrence(text: string, label: string): boolean {
  const lower = text.toLowerCase()
  const l = label.toLowerCase()
  let idx = -1
  while ((idx = lower.indexOf(l, idx + 1)) >= 0) {
    if (!isNegativeEducationContext(lower, l, idx)) return true
  }
  return false
}

/** 命中的最高学历原始标签（未做归一化），供全日制判定的窗口定位使用 */
function findEducationLabel(text: string): string {
  let best = ''
  let bestRank = 0
  for (const [label, rank] of EDU_RANK) {
    if (rank > bestRank && hasEducationOccurrence(text, label)) {
      best = label
      bestRank = rank
    }
  }
  return best
}

function extractEducation(text: string): string {
  const best = findEducationLabel(text)
  if (best === 'PhD') return '博士'
  if (best === '研究生' || best === 'MBA') return '硕士'
  if (best === '学士' || best === '统招本科') return '本科'
  if (best === '专科') return '大专'
  return best
}

function extractExperience(text: string): number {
  const m = text.match(/(?<!\d)(\d{1,2})\s*年(?:以上)?[一-龥A-Za-z]{0,8}?(?:经验|教龄)/) ?? text.match(/(?<!\d)(\d{1,2})\s*\+?\s*years?/i)
  if (m) return Math.min(Number(m[1]), 40)
  const years: number[] = []
  const rangeRe = /((?:19|20)\d{2})\s*[年./-]\s*\d{0,2}\s*[月]?\s*[-—–~至]\s*(?:至今|现在|now|((?:19|20)\d{2}))/gi
  let r: RegExpExecArray | null
  while ((r = rangeRe.exec(text)) !== null) years.push(Number(r[1]))
  if (years.length > 0) {
    const earliest = Math.min(...years)
    const exp = new Date().getFullYear() - earliest
    if (exp >= 0 && exp <= 40) return exp
  }
  return 0
}

function extractSkills(text: string): string[] {
  const found = new Set<string>()
  for (const skill of SKILL_DICT) {
    if (text.includes(skill)) found.add(skill)
  }
  return [...found].slice(0, 12)
}

/** 证书识别（词典扫描，按文本出现顺序去重） */
function extractCertificates(text: string): string[] {
  const found = new Set<string>()
  for (const cert of CERTIFICATE_DICT) {
    if (text.includes(cert)) {
      const normalized = cert === '英语四级' ? 'CET-4' : cert === '英语六级' ? 'CET-6' : cert
      if (found.has(normalized)) continue
      if ((cert === 'CET-4' && found.has('英语四级')) || (cert === 'CET-6' && found.has('英语六级'))) continue
      // 「普通话一级甲等」命中时不再重复加入「普通话一级」
      if (cert === '普通话一级' && found.has('普通话一级甲等')) continue
      if (cert === '普通话二级' && found.has('普通话二级甲等')) continue
      found.add(normalized)
    }
  }
  return [...found].slice(0, 8)
}

/** 毕业院校：匹配「XX大学 / XX学院」，并校验前后 20 字符存在教育语境（避免把「XX大学路」地址当院校） */
function extractUniversity(text: string): string {
  const re = /[一-龥]{2,12}(?:大学|学院)(?![一-龥]*(?:路|街|区|城))/g
  const EDU_CONTEXT = /毕业|就读|本科|硕士|博士|研究生|学历|教育|院校|专业|考入|录取/
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 20), m.index)
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 20)
    if (EDU_CONTEXT.test(before) || EDU_CONTEXT.test(after)) {
      // 剥离贪婪匹配吞入的前缀（如「本科毕业于华中师范大学」→「华中师范大学」）
      return m[0].replace(/^(?:(?:本科|硕士|博士|研究生|大专|专科)(?:学历)?)?(?:毕业于|就读于|就读|考入|录取于|录取)/, '')
    }
    // 上下文是地址/居语境（住在、地址、路）时直接排除
  }
  return ''
}

/** 最近任职单位：优先取「至今」所在段的学校/机构名 */
function extractCompany(text: string): string {
  const unitSuffix = '(?:学校|中学|小学|幼儿园|教育集团|培训机构|教育科技|有限公司|公司|集团|研究院)'
  const current = text.match(new RegExp(`至今[^\\n]{0,30}?([一-龥A-Za-z（(]{2,20}${unitSuffix})`))
  if (current) return current[1]
  const any = text.match(new RegExp(`([一-龥A-Za-z（(]{2,20}${unitSuffix})`))
  return any ? any[1] : ''
}

/** 年龄：优先「XX岁」，其次出生年份推断 */
function extractAge(text: string): number {
  const m = text.match(/年龄[:：\s]*(\d{2})\s*岁?/) ?? text.match(/(?<!\d)(\d{2})\s*岁/)
  if (m) {
    const age = Number(m[1])
    if (age >= 18 && age <= 65) return age
  }
  const birth = text.match(/(?:出生|生于)[:：\s]*((?:19|20)\d{2})\s*年/) ?? text.match(/((?:19|20)\d{2})\s*年\s*\d{0,2}\s*月?\s*(?:\d{0,2}\s*日?)?\s*出生/)
  if (birth) {
    const age = new Date().getFullYear() - Number(birth[1])
    if (age >= 18 && age <= 65) return age
  }
  return 0
}

/** 学段等级：用于多本教师资格证取最高学段（高中>初中>小学>幼儿园） */
const CERT_STAGE_RANK: Record<string, number> = { 幼儿园: 1, 小学: 2, 初中: 3, 高中: 4 }

/** 从「教师资格」±30 字符窗口识别学段与科目 */
function certFromWindow(window: string): { stage: CertStage; subject: string } {
  let subject = ''
  for (const s of TEACHER_SUBJECTS) {
    if (window.includes(s)) {
      subject = s
      break
    }
  }
  let stage: CertStage = ''
  if (/幼儿园|幼儿/.test(window)) stage = '幼儿园'
  else if (/高级中学|高中/.test(window)) stage = '高中'
  else if (/初级中学|初中/.test(window)) stage = '初中'
  else if (/小学/.test(window)) stage = '小学'
  return { stage, subject }
}

/**
 * 教师资格证学段 + 科目（多证取最高学段）+ 合格证明识别。
 * extraCerts：主证之外检测到的其他证书描述，由调用方转成人工确认提醒。
 */
function extractTeacherCert(text: string): {
  certStage: CertStage
  certSubject: string
  certQualified: boolean
  extraCerts: string[]
} {
  const certs: { stage: CertStage; subject: string }[] = []
  let idx = -1
  // 收集所有「教师资格」出现处（窗口取 [-14, +12]，避免相邻两证的窗口互相吞入对方学段/科目）
  while ((idx = text.indexOf('教师资格', idx + 1)) >= 0) {
    // 「中小学教师资格考试合格证明」是合格证明而非证书，跳过（单独判定）
    if (text.slice(idx + 4, idx + 6) === '考试') continue
    const window = text.slice(Math.max(0, idx - 14), idx + 12)
    const { stage, subject } = certFromWindow(window)
    if (stage || subject) {
      // 同一窗口内相邻出现处去重（同一证被多次扫描）
      if (!certs.some((c) => c.stage === stage && c.subject === subject)) certs.push({ stage, subject })
    }
  }
  // 全文兜底：「高级中学语文教师资格」类写法
  if (certs.length === 0) {
    const m = text.match(/(幼儿园|小学|初级|高级)?(中学)?([一-龥]{1,4})?教师资格/)
    if (m && m[0] && text.slice((m.index ?? 0) + m[0].indexOf('教师资格') + 4).slice(0, 2) !== '考试') {
      let stage: CertStage = ''
      const lv = m[1] ?? ''
      if (lv === '幼儿园') stage = '幼儿园'
      else if (lv === '小学') stage = '小学'
      else if (lv === '初级') stage = '初中'
      else if (lv === '高级') stage = '高中'
      const subject = m[3] && TEACHER_SUBJECTS.includes(m[3]) ? m[3] : ''
      if (stage || subject) certs.push({ stage, subject })
    }
  }

  // 主证取最高学段；同学段多证取第一个有科目的
  const sorted = [...certs].sort((a, b) => (CERT_STAGE_RANK[b.stage] ?? 0) - (CERT_STAGE_RANK[a.stage] ?? 0))
  const main = sorted[0] ?? { stage: '' as CertStage, subject: '' }
  const extraCerts = sorted
    .slice(1)
    .map((c) => `${c.stage}${c.subject}`)
    .filter(Boolean)

  // 合格证明：只持有「（中小学）教师资格考试合格证明」而未见教师资格证
  const hasQualifiedProof = /教师资格考试合格证明|中小学教师资格考试合格证明/.test(text)
  const certQualified = hasQualifiedProof && !main.stage
  return { certStage: main.stage, certSubject: main.subject, certQualified, extraCerts }
}

/** 毕业年份：「XXXX年毕业」或教育经历时间段的最晚结束年 */
function extractGradYear(text: string): number {
  const m = text.match(/((?:19|20)\d{2})\s*年\s*(?:\d{1,2}\s*月?\s*)?毕业/) ?? text.match(/毕业\s*(?:时间|年份)?[:：\s]*((?:19|20)\d{2})/)
  if (m) return Number(m[1])
  // 教育时间段 2016.09-2020.06 XX大学 → 取结束年
  const ranges = [...text.matchAll(/((?:19|20)\d{2})\s*[年./-]\s*\d{0,2}\s*[月]?\s*[-—–~至]\s*((?:19|20)\d{2})/g)]
  const eduYears: number[] = []
  for (const r of ranges) {
    const tail = text.slice(r.index ?? 0, (r.index ?? 0) + 60)
    if (/大学|学院|本科|硕士|博士|专业/.test(tail)) eduYears.push(Number(r[2]))
  }
  if (eduYears.length > 0) return Math.max(...eduYears)
  return 0
}

/** 籍贯 */
function extractHometown(text: string): string {
  const m = text.match(/籍贯[:：\s]*([一-龥]{2,10})/) ?? text.match(/(?:户籍|户口)(?:所在地)?[:：\s]*([一-龥]{2,10})/)
  return m ? m[1].trim() : ''
}

/** 身份证号：18 位（末位可为 X），前后不与其他数字相连；GB11643 校验失败时弃用并标记 */
function extractIdCard(text: string): { idCard: string; invalid: boolean } {
  const m = text.match(/(?<!\d)\d{17}[\dXx](?!\d)/)
  if (!m) return { idCard: '', invalid: false }
  if (isValidIdCard(m[0])) return { idCard: m[0].toUpperCase(), invalid: false }
  // 校验码不通过：可能是 OCR 识别错一位，弃用以免性别/年龄/户籍连带全错
  return { idCard: '', invalid: true }
}

/** 是否全日制：只在最高学历所在行窗口判定，避免「非全日制大专 + 全日制硕士」误判 */
function extractFullTime(text: string): FullTime {
  const eduLabel = findEducationLabel(text)
  let scope = text
  if (eduLabel) {
    const scoped = text
      .split(/\r?\n/)
      .filter((l) => l.toLowerCase().includes(eduLabel.toLowerCase()))
      .join('\n')
    // 最高学历标签能找到所在行时，只在那些行内判定；找不到则退回全文（旧行为）
    if (scoped) scope = scoped
  }
  if (/非全日制|在职(?:读研|研究生|硕士)/.test(scope)) return '非全日制'
  if (/全日制/.test(scope)) return '全日制'
  return '未知'
}

/** 专业 */
function extractMajor(text: string): string {
  const m =
    text.match(/专业[:：\s]*([一-龥（）()A-Za-z]{2,16})/) ??
    text.match(/(?:大学|学院)\s*[，,。\s]*([一-龥（）()]{2,16})专业/) ??
    text.match(/([一-龥（）()]{2,16})专业(?:\s*[，,。|]|$|\s*本科|\s*硕士)/m)
  if (!m) return ''
  const major = m[1].replace(/[，,。；;]$/, '').trim()
  // 排除明显误判
  if (/^(所学|本科|硕士|大学|毕业)$/.test(major)) return ''
  return major
}

/** 规范化文本：消除 OCR 输出中中文字符之间的多余空格/制表符，避免切断「姓名：张三」「籍贯：湖北黄冈」等模式 */
function normalizeText(text: string): string {
  return text
    .replace(/([一-龥（）《》·])[ \t]+(?=[一-龥（）《》·])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
}

/** 解析简历文本，返回结构化字段与低置信度字段列表 */
export function parseResumeText(rawText: string, fileName: string): ParsedFields {
  const text = normalizeText(rawText)
  const ls = lines(text)
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? ''
  const phone = text.match(/(?<!\d)1[3-9]\d{9}(?!\d)/)?.[0] ?? ''
  const { name, confident: nameOk } = extractName(ls, fileName)
  const { position, confident: posOk } = extractPosition(text)
  const education = extractEducation(text)
  const experience = extractExperience(text)
  const skills = extractSkills(text)
  const university = extractUniversity(text)
  const company = extractCompany(text)
  const certificates = extractCertificates(text)
  const { idCard, invalid: idCardInvalid } = extractIdCard(text)
  const age = extractAge(text) || ageFromIdCard(idCard)
  const { certStage, certSubject, certQualified, extraCerts } = extractTeacherCert(text)
  const gradYear = extractGradYear(text)
  // 籍贯：正文未提到时，用身份证地址码反查户籍地
  const hometown = extractHometown(text) || regionFromIdCard(idCard)?.label || ''
  const fullTime = extractFullTime(text)
  const major = extractMajor(text)
  const tags = deriveTags({
    education: education || '未知',
    experience,
    certificates,
    university,
    company,
    major,
    certStage,
    skills,
    rawText: text,
  })

  const lowConfidence: string[] = []
  if (!name || !nameOk) lowConfidence.push('name')
  if (!position || !posOk) lowConfidence.push('position')
  if (!phone) lowConfidence.push('phone')
  if (!email) lowConfidence.push('email')
  if (!education) lowConfidence.push('education')
  if (!certStage && !certQualified) lowConfidence.push('certStage')
  // 中文提醒类：身份证校验失败 / 多教师资格证 / 仅持合格证明
  if (idCardInvalid) lowConfidence.push('身份证号校验失败（疑似识别错误），已弃用该号码，请人工核对')
  extraCerts.forEach((c, i) => lowConfidence.push(`检测到第 ${i + 2} 个教师资格证：${c}，请人工确认`))
  if (certQualified) lowConfidence.push('持中小学教师资格考试合格证明，未见教师资格证')

  return {
    name, phone, email,
    position: position || '未指定',
    education: education || '未知',
    experience,
    skills,
    university,
    company,
    certificates,
    tags,
    age,
    certStage,
    certSubject,
    certQualified,
    gradYear,
    hometown,
    fullTime,
    major,
    idCard,
    gender: genderFromIdCard(idCard),
    lowConfidence,
  }
}
