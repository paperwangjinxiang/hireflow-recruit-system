import type { Resume } from '@/types'
import { LEGACY_STAGE_MAP, type FullTime, type Stage } from '@/types'

/** 证书词典：扫描简历文本自动识别 */
export const CERTIFICATE_DICT = [
  '教师资格证', '普通话一级甲等', '普通话一级', '普通话二级甲等', '普通话二级',
  'CET-4', 'CET-6', '英语四级', '英语六级', '专四', '专八', '雅思', '托福',
  '计算机二级', '计算机三级', '心理健康教育', '心理咨询师', '特级教师资格',
]

/** 985/211 院校关键词（子串匹配） */
const TOP_UNIVERSITIES = [
  '清华', '北京大学', '复旦', '上海交通', '浙江大学', '中国科学技术', '南京大学', '武汉大学',
  '华中科技', '西安交通', '哈尔滨工业', '中山大学', '同济大学', '北京航空', '北京理工',
  '人民大学', '南开大学', '天津大学', '厦门大学', '山东大学', '吉林大学', '四川大学',
  '重庆大学', '湖南大学', '中南大学', '东北大学', '兰州大学', '中国农业', '北京师范',
  '华东师范', '国防科技', '东南大学', '西北工业', '大连理工', '华南理工', '电子科技',
  '北京邮电', '西安电子', '西南交通', '北京交通', '河海大学', '中国矿业', '中国石油',
  '中国地质', '中央财经', '上海财经', '对外经贸', '中国政法', '北京外国语', '上海外国语',
  '华中师范', '南京师范', '陕西师范', '西南大学', '东北师范', '华南师范', '湖南师范',
]

const ENGLISH_CERTS = ['CET-4', 'CET-6', '英语四级', '英语六级', '专四', '专八', '雅思', '托福']

export interface TagInput {
  education: string
  experience: number
  certificates: string[]
  university: string
  company: string
  major?: string
  certStage?: string
  skills?: string[]
  rawText?: string
}

/** 基于解析结果生成智能标签 */
export function deriveTags(input: TagInput): string[] {
  const tags: string[] = []

  // 证书标签（最多取 3 个展示）
  tags.push(...input.certificates.slice(0, 3))

  // 教师资格证
  if (input.certStage) tags.push(`${input.certStage}教资`)

  // 院校层级
  if (TOP_UNIVERSITIES.some((u) => input.university.includes(u))) tags.push('985/211')

  // 师范背景
  if (input.university.includes('师范') || (input.major ?? '').includes('师范') || (input.major ?? '').includes('教育')) {
    tags.push('师范背景')
  }

  // 班主任经验
  if ((input.skills ?? []).includes('班主任工作') || (input.rawText ?? '').includes('班主任')) tags.push('班主任经验')

  // 英语能力
  if (input.certificates.some((c) => ENGLISH_CERTS.includes(c))) tags.push('英语能力')

  // 学历
  if (input.education === '博士') tags.push('博士')
  else if (input.education === '硕士') tags.push('硕士学历')

  // 经验档位
  if (input.experience >= 10) tags.push('资深教师')
  else if (input.experience >= 5) tags.push('经验丰富')
  else if (input.experience <= 1) tags.push('应届/初级')

  return [...new Set(tags)]
}

function normalizeStage(stage: string): Stage {
  if (stage in LEGACY_STAGE_MAP) return LEGACY_STAGE_MAP[stage]
  const valid: Stage[] = ['imported', 'screening', 'matched', 'interview', 'offered', 'rejected', 'onboarded', 'offboarded', 'blacklisted']
  return valid.includes(stage as Stage) ? (stage as Stage) : 'imported'
}

/** 规范化简历数据：为旧版本数据补齐新增字段、迁移旧阶段并派生标签 */
export function normalizeResume(r: Resume): Resume {
  const university = r.university ?? ''
  const company = r.company ?? ''
  const certificates = r.certificates ?? []
  const certStage = r.certStage ?? ''
  const major = r.major ?? ''
  const tags = r.tags?.length
    ? r.tags
    : deriveTags({ education: r.education, experience: r.experience, certificates, university, company, major, certStage, skills: r.skills })
  return {
    ...r,
    university,
    company,
    certificates,
    tags,
    rating: r.rating ?? 0,
    age: r.age ?? 0,
    certStage,
    certSubject: r.certSubject ?? '',
    gradYear: r.gradYear ?? 0,
    hometown: r.hometown ?? '',
    fullTime: (r.fullTime ?? '未知') as FullTime,
    major,
    jobId: r.jobId ?? null,
    lockedBy: r.lockedBy ?? null,
    lockedAt: r.lockedAt ?? null,
    notes: r.notes ?? [],
    activities: r.activities ?? [],
    stage: normalizeStage(r.stage as string),
  }
}

export const TAG_COLORS: Record<string, string> = {
  '985/211': 'bg-violet-100 text-violet-700 border-violet-200',
  '师范背景': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  '班主任经验': 'bg-cyan-100 text-cyan-700 border-cyan-200',
  '英语能力': 'bg-sky-100 text-sky-700 border-sky-200',
  '资深教师': 'bg-amber-100 text-amber-700 border-amber-200',
  '经验丰富': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  '应届/初级': 'bg-lime-100 text-lime-700 border-lime-200',
  '博士': 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  '硕士学历': 'bg-indigo-100 text-indigo-700 border-indigo-200',
}

export function tagColor(tag: string): string {
  if (TAG_COLORS[tag]) return TAG_COLORS[tag]
  if (tag.endsWith('教资')) return 'bg-teal-100 text-teal-700 border-teal-200'
  return 'bg-slate-100 text-slate-600 border-slate-200'
}
