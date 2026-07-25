import { z } from 'zod'
import type { SharedState } from '@/lib/sync'

/**
 * 远端数据 zod 校验：对云端拉取的 payload 做结构校验，防止畸形数据砖化本地库。
 * 原则：只校验关键字段的类型与必填性（防畸形），不校验业务取值（防误杀历史数据），
 * 非关键字段一律 passthrough 放行。
 */

const userSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  role: z.enum(['admin', 'hr', 'interviewer']),
  phone: z.string(),
  email: z.string(),
  color: z.string(),
  passwordHash: z.string(),
  salt: z.string(),
  status: z.enum(['active', 'pending', 'disabled']),
  mustChangePassword: z.boolean().optional(),
  createdAt: z.number(),
})

const noteSchema = z.looseObject({
  id: z.string(),
  authorId: z.string(),
  content: z.string(),
  createdAt: z.number(),
})

const activitySchema = z.looseObject({
  id: z.string(),
  actorId: z.string(),
  action: z.string(),
  createdAt: z.number(),
})

const resumeSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  // 以下字段自首个版本即存在，保持必填；更晚新增的字段宽松放行（applyRemote 后经 normalizeResume 补默认值）
  position: z.string(),
  education: z.string(),
  experience: z.number(),
  skills: z.array(z.string()),
  source: z.string(),
  // 阶段不枚举具体值：历史/未来版本可能出现新阶段，宽松放行避免砖化
  stage: z.string(),
  assigneeId: z.string().nullable().optional(),
  certificates: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  rating: z.number().optional(),
  notes: z.array(noteSchema),
  activities: z.array(activitySchema),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const jobSchema = z.looseObject({
  id: z.string(),
  region: z.string(),
  school: z.string(),
  level: z.string(),
  subject: z.string(),
  dormitory: z.boolean(),
  headcount: z.number(),
  status: z.enum(['open', 'closed']),
  note: z.string(),
  createdAt: z.number(),
})

const interviewSchema = z.looseObject({
  id: z.string(),
  resumeId: z.string(),
  round: z.string(),
  time: z.number(),
  interviewerId: z.string(),
  location: z.string(),
  result: z.enum(['pending', 'pass', 'fail', 'declined']),
  feedback: z.string(),
  createdAt: z.number(),
})

const sharedStateSchema = z.looseObject({
  users: z.array(userSchema),
  resumes: z.array(resumeSchema),
  interviews: z.array(interviewSchema),
  // 历史云端数据可能没有 jobs 数组（applyRemote 会兜底为 []）
  jobs: z.array(jobSchema).optional(),
})

export type ValidateResult = { ok: true; state: SharedState } | { ok: false; issues: string[] }

/** 校验远端 state 结构；失败时返回前几条问题描述（绝不抛异常） */
export function validateSharedState(data: unknown): ValidateResult {
  const result = sharedStateSchema.safeParse(data)
  if (result.success) return { ok: true, state: result.data as unknown as SharedState }
  const issues = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(根)'}: ${i.message}`)
  return { ok: false, issues }
}
