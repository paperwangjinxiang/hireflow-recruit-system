import type { Resume, User } from '@/types'
import { STAGE_LABELS } from '@/types'

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** 把简历列表导出为 CSV 文本（含 BOM，Excel 直接打开不乱码） */
export function resumesToCSV(resumes: Resume[], users: User[]): string {
  const header = '姓名,年龄,教资学段,教资科目,毕业年份,籍贯,毕业院校,是否全日制,专业,学历,工作年限,电话,邮箱,应聘岗位,技能,证书,标签,阶段,负责人,来源,评分,导入时间'
  const rows = resumes.map((r) => {
    const assignee = users.find((u) => u.id === r.assigneeId)?.name ?? ''
    const cells = [
      r.name,
      r.age > 0 ? String(r.age) : '',
      r.certStage,
      r.certSubject,
      r.gradYear > 0 ? String(r.gradYear) : '',
      r.hometown,
      r.university,
      r.fullTime === '未知' ? '' : r.fullTime,
      r.major,
      r.education,
      String(r.experience),
      r.phone,
      r.email,
      r.position,
      r.skills.join(';'),
      r.certificates.join(';'),
      r.tags.join(';'),
      STAGE_LABELS[r.stage],
      assignee,
      r.source,
      r.rating > 0 ? String(r.rating) : '',
      new Date(r.createdAt).toLocaleString('zh-CN'),
    ]
    return cells.map(escapeCsvCell).join(',')
  })
  return '﻿' + [header, ...rows].join('\n')
}

/** 触发浏览器下载 */
export function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
