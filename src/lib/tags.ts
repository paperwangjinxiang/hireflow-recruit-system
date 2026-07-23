import type { Resume } from '@/types'

/** 证书词典：扫描简历文本自动识别 */
export const CERTIFICATE_DICT = [
  'CET-4', 'CET-6', '英语四级', '英语六级', '专四', '专八', '雅思', '托福', 'GRE',
  'PMP', 'ACP', 'PRINCE2', 'CPA', 'ACCA', 'CFA', 'FRM', '中级会计', '初级会计',
  '软考高级', '软考中级', '信息系统项目管理师', '系统集成项目管理工程师', '系统架构设计师',
  '教师资格证', '法律职业资格', '一级建造师', '二级建造师', '造价工程师', '监理工程师',
  'HCIA', 'HCIP', 'HCIE', 'CCNA', 'CCNP', 'AWS认证', '阿里云认证', '腾讯云认证',
  '普通话一级', '普通话二级', '计算机二级', '计算机三级', '计算机四级',
  'NPDP', '心理咨询师', '人力资源管理师', '驾驶证',
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
]

/** 大厂关键词（子串匹配） */
const BIG_TECH = [
  '阿里巴巴', '腾讯', '字节跳动', '百度', '美团', '华为', '京东', '网易', '小米',
  '滴滴', '快手', '拼多多', '蚂蚁集团', '微软', '谷歌', '亚马逊', '苹果', 'IBM',
  '英特尔', '英伟达', '特斯拉', '蔚来', '小鹏', '理想汽车', '比亚迪', '宁德时代',
  '顺丰', '携程', '爱奇艺', '哔哩哔哩', '小红书', '得物', 'OPPO', 'vivo', '大疆',
]

const ENGLISH_CERTS = ['CET-4', 'CET-6', '英语四级', '英语六级', '专四', '专八', '雅思', '托福', 'GRE']

export interface TagInput {
  education: string
  experience: number
  certificates: string[]
  university: string
  company: string
  rawText?: string
}

/** 基于解析结果生成智能标签 */
export function deriveTags(input: TagInput): string[] {
  const tags: string[] = []

  // 证书标签（最多取 4 个展示）
  tags.push(...input.certificates.slice(0, 4))

  // 院校层级
  if (TOP_UNIVERSITIES.some((u) => input.university.includes(u))) tags.push('985/211')

  // 大厂背景
  if (BIG_TECH.some((c) => input.company.includes(c) || (input.rawText ?? '').includes(c))) tags.push('大厂背景')

  // 英语能力
  if (input.certificates.some((c) => ENGLISH_CERTS.includes(c))) tags.push('英语能力')

  // 学历
  if (input.education === '博士') tags.push('博士')
  else if (input.education === '硕士') tags.push('硕士学历')

  // 经验档位
  if (input.experience >= 10) tags.push('资深专家')
  else if (input.experience >= 5) tags.push('经验丰富')
  else if (input.experience <= 1) tags.push('应届/初级')

  return [...new Set(tags)]
}

/** 规范化简历数据：为旧版本数据补齐新增字段并派生标签 */
export function normalizeResume(r: Resume): Resume {
  const university = r.university ?? ''
  const company = r.company ?? ''
  const certificates = r.certificates ?? []
  const tags = r.tags?.length
    ? r.tags
    : deriveTags({ education: r.education, experience: r.experience, certificates, university, company })
  return { ...r, university, company, certificates, tags, rating: r.rating ?? 0 }
}

export const TAG_COLORS: Record<string, string> = {
  '985/211': 'bg-violet-100 text-violet-700 border-violet-200',
  '大厂背景': 'bg-blue-100 text-blue-700 border-blue-200',
  '英语能力': 'bg-cyan-100 text-cyan-700 border-cyan-200',
  '资深专家': 'bg-amber-100 text-amber-700 border-amber-200',
  '经验丰富': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  '应届/初级': 'bg-lime-100 text-lime-700 border-lime-200',
  '博士': 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  '硕士学历': 'bg-indigo-100 text-indigo-700 border-indigo-200',
}

export function tagColor(tag: string): string {
  return TAG_COLORS[tag] ?? 'bg-slate-100 text-slate-600 border-slate-200'
}
