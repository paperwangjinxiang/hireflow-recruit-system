import type { Resume, User } from '@/types'
import { STAGE_LABELS } from '@/types'

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** 把简历列表导出为 CSV 文本（含 BOM，Excel 直接打开不乱码） */
export function resumesToCSV(resumes: Resume[], users: User[]): string {
  const header = '姓名,电话,邮箱,职位,学历,工作年限,技能,证书,标签,毕业院校,最近公司,阶段,负责人,来源,评分,导入时间'
  const rows = resumes.map((r) => {
    const assignee = users.find((u) => u.id === r.assigneeId)?.name ?? ''
    const cells = [
      r.name, r.phone, r.email, r.position, r.education, String(r.experience),
      r.skills.join(';'), r.certificates.join(';'), r.tags.join(';'),
      r.university, r.company, STAGE_LABELS[r.stage], assignee, r.source,
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
