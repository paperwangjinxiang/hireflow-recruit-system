/** 经历时间线解析：从简历原文中按时间段正则定位教育/工作经历（对标 Moka 结构化经历解析） */

export interface ExperienceItem {
  kind: 'edu' | 'work'
  /** 归一化开始时间，如 2016.09 */
  start: string
  /** 归一化结束时间，如 2020.06 或 至今 */
  end: string
  /** 机构名称（学校/公司） */
  org: string
  /** 一行描述 */
  detail: string
}

/** 时间段正则：2016.09-2020.06 / 2020年7月-至今 / 2018/03—2021/05 / 2016-2020 等 */
const RANGE_RE =
  /((?:19|20)\d{2})\s*(?:[./年-]\s*(\d{1,2})\s*月?)?\s*[-–—~～]+\s*((?:19|20)\d{2}\s*(?:[./年-]\s*\d{1,2}\s*月?)?|至今|现在|迄今)/g

const EDU_RE = /大学|学院|研究生院|高等专科/
const ORG_RE = /大学|学院|学校|中学|小学|幼儿园|公司|机构|集团|中心|教育科技|培训/
/** 明显不是经历时间段的内容（成绩、证书考试时间等） */
const NOISE_RE = /成绩|分数|排名|GPA|绩点|考试时间|报名|有效期|出生/

function normYear(y: string, m?: string): string {
  return m ? `${y}.${m.padStart(2, '0')}` : y
}

function sortKey(y: string, m?: string): number {
  return parseInt(y, 10) * 100 + (m ? parseInt(m, 10) : 0)
}

/** 从一行文本中提取机构名：按分隔符切段，取第一个像机构的段 */
function extractOrg(text: string): { org: string; rest: string } {
  const segs = text
    .split(/[\s\u3000，,、|｜·•：]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const idx = segs.findIndex((s) => ORG_RE.test(s) && s.length >= 4 && !/^\d/.test(s))
  if (idx < 0) return { org: '', rest: text.trim() }
  const org = segs[idx].replace(/[（(].*$/, '')
  const rest = segs.filter((_, i) => i !== idx).join(' ')
  return { org, rest }
}

/**
 * 从简历原文解析教育/工作经历时间线。
 * 对空 rawText 健壮；按开始时间倒序；最多 10 条。
 */
export function parseExperiences(rawText: string): ExperienceItem[] {
  if (!rawText.trim()) return []
  const lines = rawText.split(/\r?\n/)
  const items: ExperienceItem[] = []
  const seen = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (NOISE_RE.test(line)) continue
    RANGE_RE.lastIndex = 0
    const m = RANGE_RE.exec(line)
    if (!m) continue

    const [, sy, sm, endRaw] = m
    const start = normYear(sy, sm)
    let end = '至今'
    let endKey = 999999
    const em = /((?:19|20)\d{2})\s*(?:[./年-]\s*(\d{1,2}))?/.exec(endRaw)
    if (em) {
      end = normYear(em[1], em[2])
      endKey = sortKey(em[1], em[2])
    }
    const startKey = sortKey(sy, sm)
    if (startKey > endKey) continue

    // 时间段之外的同行文本 + 下一行（若下一行不含时间段、不是栏目名、不是噪声行）作为上下文
    let context = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).trim()
    if (i + 1 < lines.length) {
      const next = lines[i + 1].trim()
      RANGE_RE.lastIndex = 0
      const isSection = /^(教育|工作|项目|实习|在校)(经历|经验|背景)?$/.test(next)
      if (!RANGE_RE.test(next) && !isSection && !NOISE_RE.test(next)) context += ' ' + next
    }

    const { org, rest } = extractOrg(context)
    // 去噪：机构为空或过短的丢弃
    if (!org || org.length < 4) continue

    const kind: ExperienceItem['kind'] = EDU_RE.test(org) ? 'edu' : 'work'
    let detail = rest.replace(/\s+/g, ' ').trim()
    if (detail.length > 60) detail = detail.slice(0, 60) + '…'

    const dedupKey = `${start}-${org}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    items.push({ kind, start, end, org, detail })
    if (items.length >= 10) break
  }

  const keyOf = (s: string) => {
    const [y, m] = s.split('.')
    return parseInt(y, 10) * 100 + (m ? parseInt(m, 10) : 0)
  }
  return items.sort((a, b) => keyOf(b.start) - keyOf(a.start))
}
