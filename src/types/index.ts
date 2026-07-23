export type Role = 'admin' | 'hr' | 'interviewer'

export interface User {
  id: string
  name: string
  role: Role
  email: string
  color: string
}

export type Stage = 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'

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

export interface Resume {
  id: string
  name: string
  phone: string
  email: string
  position: string
  education: string
  experience: number // 工作年限
  skills: string[]
  source: string
  stage: Stage
  assigneeId: string | null
  university: string // 毕业院校
  company: string // 最近任职公司
  certificates: string[] // 证书资质
  tags: string[] // 智能标签（985/211、大厂背景、资深专家等）
  rating: number // 星级评分 0-5
  createdAt: number
  updatedAt: number
  notes: Note[]
  activities: Activity[]
}

export type InterviewResult = 'pending' | 'pass' | 'fail'

export interface Interview {
  id: string
  resumeId: string
  round: string // 一面 / 二面 / 三面 / HR面 / 终面
  time: number // 面试时间戳
  interviewerId: string
  location: string // 面试地点或会议链接
  result: InterviewResult
  feedback: string
  createdAt: number
}

export const INTERVIEW_ROUNDS = ['一面', '二面', '三面', 'HR面', '终面']

export const RESULT_LABELS: Record<InterviewResult, string> = {
  pending: '待面试',
  pass: '通过',
  fail: '未通过',
}

export const RESULT_COLORS: Record<InterviewResult, string> = {
  pending: 'bg-sky-100 text-sky-700 border-sky-200',
  pass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  fail: 'bg-rose-100 text-rose-700 border-rose-200',
}

export const STAGE_LABELS: Record<Stage, string> = {
  new: '新简历',
  screening: '筛选中',
  interview: '面试中',
  offer: 'Offer',
  hired: '已入职',
  rejected: '已淘汰',
}

export const STAGE_ORDER: Stage[] = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected']

export const STAGE_COLORS: Record<Stage, string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-200',
  screening: 'bg-amber-100 text-amber-700 border-amber-200',
  interview: 'bg-violet-100 text-violet-700 border-violet-200',
  offer: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  hired: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-100 text-rose-700 border-rose-200',
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理员',
  hr: 'HR',
  interviewer: '面试官',
}
