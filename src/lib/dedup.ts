/** 简历查重：按 phone / idCard / email / 姓名+毕业年份 组合匹配（对标 Moka 自动去重） */

import type { Resume } from '@/types'

export interface DupKeyFields {
  name?: string
  phone?: string
  email?: string
  idCard?: string
  gradYear?: number
}

/**
 * 在简历库中查找与给定字段疑似重复的简历。
 * 规则：手机号（非空相等）/ 身份证（非空相等）/ 邮箱（非空相等）/ 姓名+毕业年份 组合。
 * 排除自身（excludeId）与黑名单简历。
 */
export function matchDuplicates(fields: DupKeyFields, all: Resume[], excludeId?: string): Resume[] {
  const phone = fields.phone?.trim() ?? ''
  const email = fields.email?.trim().toLowerCase() ?? ''
  const idCard = fields.idCard?.trim().toUpperCase() ?? ''
  const name = fields.name?.trim() ?? ''
  const gradYear = fields.gradYear ?? 0
  if (!phone && !email && !idCard && !(name && gradYear > 0)) return []

  return all.filter((r) => {
    if (r.id === excludeId) return false
    if (r.stage === 'blacklisted') return false
    if (phone && r.phone.trim() === phone) return true
    if (email && r.email.trim().toLowerCase() === email) return true
    if (idCard && r.idCard.trim().toUpperCase() === idCard) return true
    if (name && gradYear > 0 && r.name.trim() === name && r.gradYear === gradYear) return true
    return false
  })
}

/** 查找某份简历在库内的疑似重复项 */
export function findDuplicates(resume: Resume, all: Resume[]): Resume[] {
  return matchDuplicates(
    {
      name: resume.name,
      phone: resume.phone,
      email: resume.email,
      idCard: resume.idCard,
      gradYear: resume.gradYear,
    },
    all,
    resume.id,
  )
}
