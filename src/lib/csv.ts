import type { ImportableResume } from '@/lib/store'

/** 解析 CSV 文本，支持引号包裹与逗号转义 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

export interface ParsedResume {
  data: ImportableResume
  errors: string[]
}

const HEADER_MAP: Record<string, string> = {
  姓名: 'name', name: 'name',
  电话: 'phone', 手机: 'phone', phone: 'phone',
  邮箱: 'email', email: 'email',
  职位: 'position', 应聘职位: 'position', position: 'position',
  学历: 'education', education: 'education',
  工作年限: 'experience', 经验: 'experience', experience: 'experience',
  技能: 'skills', skills: 'skills',
  来源: 'source', source: 'source',
}

export const CSV_TEMPLATE = '姓名,电话,邮箱,职位,学历,工作年限,技能,来源\n张三,13800001111,zhangsan@example.com,前端工程师,本科,5,React;TypeScript,BOSS直聘\n李四,13900002222,lisi@example.com,产品经理,硕士,3,产品规划;Axure,内推'

/** 把 CSV 文本解析为候选人简历列表（第一行为表头） */
export function parseResumesFromCSV(text: string): ParsedResume[] {
  const rows = parseCSV(text.replace(/^﻿/, ''))
  if (rows.length < 2) return []
  const header = rows[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] ?? HEADER_MAP[h.trim()] ?? null)
  if (!header.includes('name')) {
    return [{ data: emptyResume(), errors: ['未找到「姓名」列，请检查表头格式'] }]
  }
  return rows.slice(1).map((cells, idx) => {
    const get = (key: string) => {
      const i = header.indexOf(key)
      return i >= 0 ? (cells[i] ?? '').trim() : ''
    }
    const errors: string[] = []
    const name = get('name')
    if (!name) errors.push(`第 ${idx + 2} 行：姓名不能为空`)
    const expRaw = get('experience')
    const experience = expRaw ? Number(expRaw) : 0
    if (expRaw && Number.isNaN(experience)) errors.push(`第 ${idx + 2} 行：工作年限「${expRaw}」不是数字`)
    return {
      data: {
        name,
        phone: get('phone'),
        email: get('email'),
        position: get('position') || '未指定',
        education: get('education') || '未知',
        experience: Number.isNaN(experience) ? 0 : experience,
        skills: get('skills')
          ? get('skills').split(/[;；、|]/).map((s) => s.trim()).filter(Boolean)
          : [],
        source: get('source') || '批量导入',
        stage: 'new',
        assigneeId: null,
      },
      errors,
    }
  })
}

function emptyResume(): ParsedResume['data'] {
  return { name: '', phone: '', email: '', position: '', education: '', experience: 0, skills: [], source: '', stage: 'new', assigneeId: null }
}
