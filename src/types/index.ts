export type Role = 'admin' | 'hr' | 'interviewer'

export type UserStatus = 'active' | 'pending' | 'disabled'

export interface User {
  id: string
  name: string
  role: Role
  email: string
  color: string
  /** 登录账号（唯一） */
  phone: string
  /** 密码凭据：新格式为 `pbkdf2:<iterations>:<saltHex>:<hashHex>`；旧格式为单轮 SHA-256 hex（登录成功后会自动升级） */
  passwordHash: string
  /** 每用户随机盐（hex；新格式下与 passwordHash 信封中的盐一致，冗余保留用于兼容） */
  salt: string
  status: UserStatus
  /** 为 true 时登录后强制修改密码（种子用户/获批新用户/被重置密码的用户） */
  mustChangePassword?: boolean
  createdAt: number
}

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: '正常',
  pending: '待审批',
  disabled: '已禁用',
}

/** 新用户头像颜色调色板 */
export const USER_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']

/** 教师招聘流程：导入 → 筛选 → 岗位匹配(锁定) → 面试 → 录用 → 入职；终态：面试不通过 / 离职 / 黑名单 */
export type Stage =
  | 'imported'
  | 'screening'
  | 'matched'
  | 'interview'
  | 'offered'
  | 'rejected'
  | 'onboarded'
  | 'offboarded'
  | 'blacklisted'

/** 主漏斗阶段（用于漏斗图，终态单独统计） */
export const FUNNEL_STAGES: Stage[] = ['imported', 'screening', 'matched', 'interview', 'offered', 'onboarded']

/** 终态阶段（已入职/离职/黑名单/面试不通过均不再计入「进行中」，与 reminders.ts 口径一致） */
export const TERMINAL_STAGES: Stage[] = ['rejected', 'onboarded', 'offboarded', 'blacklisted']

export interface Note {
  id: string
  authorId: string
  content: string
  createdAt: number
}

export interface Activity {
  id: string
  actorId: string
  action: string
  createdAt: number
}

export type CertStage = '幼儿园' | '小学' | '初中' | '高中' | ''
export type FullTime = '全日制' | '非全日制' | '未知'

export interface Resume {
  id: string
  name: string
  phone: string
  email: string
  position: string // 应聘岗位（如 高中语文教师）
  education: string
  experience: number // 工作年限
  skills: string[]
  source: string
  stage: Stage
  assigneeId: string | null
  university: string // 毕业院校
  company: string // 最近任职单位
  certificates: string[] // 证书资质
  tags: string[] // 智能标签
  rating: number // 星级评分 0-5
  // ---- 教师招聘专属字段 ----
  age: number // 年龄，0 = 未知
  certStage: CertStage // 教师资格证学段
  certSubject: string // 教师资格证科目（语文/数学/英语…）
  certQualified: boolean // 持有教师资格考试合格证明（未取得证书），即「持合格证明」标注
  certNote: string // 合格证明备注（如「2024 高中语文合格证明，证书待发」），配合 certQualified 使用
  gradYear: number // 毕业年份，0 = 未知
  hometown: string // 籍贯
  fullTime: FullTime // 是否全日制
  major: string // 专业
  idCard: string // 身份证号（导入/解析时提取）
  rawText: string // 简历解析出的全文（截断到 20000 字符）
  // ---- 岗位锁定 ----
  jobId: string | null // 锁定的职位
  lockedBy: string | null // 锁定人
  lockedAt: number | null // 锁定时间
  createdAt: number
  updatedAt: number
  notes: Note[]
  activities: Activity[]
}

export type SchoolLevel = '高中' | '初中' | '小学'

/** 招聘职位（学校岗位发布） */
export interface Job {
  id: string
  region: string // 片区
  school: string // 学校名字
  level: SchoolLevel // 学段
  subject: string // 学科
  dormitory: boolean // 是否有宿舍
  headcount: number // 需求人数
  status: 'open' | 'closed'
  note: string
  createdAt: number
}

export type InterviewResult = 'pending' | 'pass' | 'fail' | 'declined'

export interface Interview {
  id: string
  resumeId: string
  round: string // 试讲 / 一面 / 二面 / 校长面 / 终面
  time: number // 面试时间戳
  interviewerId: string
  location: string // 面试地点或会议链接
  result: InterviewResult
  feedback: string
  createdAt: number
}

export const INTERVIEW_ROUNDS = ['试讲', '一面', '二面', '校长面', '终面']

export const RESULT_LABELS: Record<InterviewResult, string> = {
  pending: '待面试',
  pass: '通过',
  fail: '未通过',
  declined: '候选人拒绝',
}

export const RESULT_COLORS: Record<InterviewResult, string> = {
  pending: 'bg-sky-100 text-sky-700 border-sky-200',
  pass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  fail: 'bg-rose-100 text-rose-700 border-rose-200',
  declined: 'bg-slate-100 text-slate-600 border-slate-200',
}

export const STAGE_LABELS: Record<Stage, string> = {
  imported: '简历导入',
  screening: '简历筛选',
  matched: '岗位匹配',
  interview: '面试',
  offered: '录用',
  rejected: '面试不通过',
  onboarded: '已入职',
  offboarded: '已离职',
  blacklisted: '黑名单',
}

export const STAGE_ORDER: Stage[] = [
  'imported', 'screening', 'matched', 'interview', 'offered', 'rejected', 'onboarded', 'offboarded', 'blacklisted',
]

export const STAGE_COLORS: Record<Stage, string> = {
  imported: 'bg-blue-100 text-blue-700 border-blue-200',
  screening: 'bg-amber-100 text-amber-700 border-amber-200',
  matched: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  interview: 'bg-violet-100 text-violet-700 border-violet-200',
  offered: 'bg-teal-100 text-teal-700 border-teal-200',
  rejected: 'bg-rose-100 text-rose-700 border-rose-200',
  onboarded: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  offboarded: 'bg-slate-100 text-slate-600 border-slate-200',
  blacklisted: 'bg-slate-800 text-slate-100 border-slate-700',
}

/** 老版本阶段 → 新阶段 迁移映射 */
export const LEGACY_STAGE_MAP: Record<string, Stage> = {
  new: 'imported',
  screening: 'screening',
  interview: 'interview',
  offer: 'offered',
  hired: 'onboarded',
  rejected: 'rejected',
}

export const SCHOOL_LEVELS: SchoolLevel[] = ['高中', '初中', '小学']

export const CERT_STAGES: Exclude<CertStage, ''>[] = ['幼儿园', '小学', '初中', '高中']

export const TEACHER_SUBJECTS = [
  '语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治',
  '音乐', '体育', '美术', '信息技术', '科学', '心理健康',
]

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理员',
  hr: 'HR',
  interviewer: '面试官',
}
