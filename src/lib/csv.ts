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
  职位: 'position', 应聘职位: 'position', 应聘岗位: 'position', position: 'position',
  学历: 'education', education: 'education',
  工作年限: 'experience', 经验: 'experience', 教龄: 'experience', experience: 'experience',
  技能: 'skills', skills: 'skills',
  来源: 'source', source: 'source',
  年龄: 'age', age: 'age',
  教资学段: 'certStage', 教师资格证学段: 'certStage',
  教资科目: 'certSubject', 教师资格证科目: 'certSubject', 科目: 'certSubject',
  毕业年份: 'gradYear', 毕业时间: 'gradYear',
  籍贯: 'hometown', hometown: 'hometown',
  身份证: 'idCard', 身份证号: 'idCard', idcard: 'idCard',
  毕业院校: 'university', 院校: 'university', university: 'university',
  是否全日制: 'fullTime', 全日制: 'fullTime',
  专业: 'major', major: 'major',
}

export const CSV_TEMPLATE = '姓名,电话,邮箱,应聘岗位,年龄,教资学段,教资科目,毕业院校,是否全日制,专业,毕业年份,籍贯,学历,工作年限,技能,来源\n刘子涵,13800001111,liuzh@example.com,高中语文教师,28,高中,语文,华中师范大学,全日制,汉语言文学,2021,湖北武汉,硕士,4,教学设计;作文指导,万行教师人才网\n李思远,13900002222,lisy@example.com,初中数学教师,26,初中,数学,北京师范大学,全日制,数学与应用数学,2022,河南郑州,本科,3,教学设计;竞赛辅导,内推'

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
    const ageRaw = get('age')
    const age = ageRaw ? Number(ageRaw) : 0
    if (ageRaw && Number.isNaN(age)) errors.push(`第 ${idx + 2} 行：年龄「${ageRaw}」不是数字`)
    const gradRaw = get('gradYear')
    const gradYear = gradRaw ? Number(gradRaw) : 0
    if (gradRaw && Number.isNaN(gradYear)) errors.push(`第 ${idx + 2} 行：毕业年份「${gradRaw}」不是数字`)
    const certStageRaw = get('certStage')
    const certStage = (['幼儿园', '小学', '初中', '高中'].includes(certStageRaw) ? certStageRaw : '') as '' | '幼儿园' | '小学' | '初中' | '高中'
    const fullTimeRaw = get('fullTime')
    const fullTime = fullTimeRaw.includes('非') ? '非全日制' : fullTimeRaw.includes('全日制') || fullTimeRaw === '是' ? '全日制' : '未知'
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
        stage: 'imported',
        assigneeId: null,
        age: Number.isNaN(age) ? 0 : age,
        certStage,
        certSubject: get('certSubject'),
        gradYear: Number.isNaN(gradYear) ? 0 : gradYear,
        hometown: get('hometown'),
        fullTime,
        major: get('major'),
        university: get('university'),
        idCard: get('idCard'),
      },
      errors,
    }
  })
}

function emptyResume(): ParsedResume['data'] {
  return { name: '', phone: '', email: '', position: '', education: '', experience: 0, skills: [], source: '', stage: 'imported', assigneeId: null }
}
