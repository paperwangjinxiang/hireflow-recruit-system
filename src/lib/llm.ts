import type { ParsedFields } from '@/lib/parser'

/** 可选的 AI 增强解析：配置任意 OpenAI 兼容接口后，用 LLM 抽取结构化字段 */

export interface LlmConfig {
  enabled: boolean
  baseUrl: string // 如 https://api.moonshot.cn/v1
  apiKey: string
  model: string // 如 moonshot-v1-8k / gpt-4o-mini
}

const CONFIG_KEY = 'hireflow-llm-config'

export function getLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return { enabled: false, baseUrl: '', apiKey: '', model: '', ...JSON.parse(raw) }
  } catch {
    // ignore
  }
  return { enabled: false, baseUrl: '', apiKey: '', model: '' }
}

export function saveLlmConfig(config: LlmConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

const PROMPT = `你是教师招聘简历解析助手。从下面的简历文本中抽取字段，只输出 JSON，不要输出任何其他内容。
JSON 格式：{"name":"","phone":"","email":"","position":"","education":"","experience":0,"skills":[],"age":0,"certStage":"","certSubject":"","gradYear":0,"hometown":"","fullTime":"未知","major":"","university":""}
要求：
- education 只能是：博士/硕士/本科/大专/高中/未知 之一
- experience 是数字，表示工作年限（教龄），无法判断则为 0
- skills 是字符串数组，最多 12 个
- age 是数字年龄，无法判断则为 0
- certStage 是教师资格证学段：幼儿园/小学/初中/高中 之一，没有教师资格证则留空
- certSubject 是教师资格证科目：语文/数学/英语/物理/化学/生物/历史/地理/政治/音乐/体育/美术/信息技术/科学/心理健康 之一，没有则留空
- gradYear 是最高学历毕业年份（数字），无法判断则为 0
- hometown 是籍贯（如 湖北武汉），找不到留空
- fullTime 是最高学历是否全日制：全日制/非全日制/未知 之一
- major 是专业名称（如 汉语言文学），找不到留空
- university 是毕业院校全称，找不到留空
- 其他找不到的字段留空字符串

简历文本：
`

/** 调用 LLM 解析；失败时抛出错误，由调用方回退到本地引擎 */
export async function parseWithLlm(text: string, config: LlmConfig): Promise<Partial<ParsedFields>> {
  const base = config.baseUrl.replace(/\/+$/, '')
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: PROMPT + text.slice(0, 8000) }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  })
  if (!resp.ok) throw new Error(`AI 接口返回 ${resp.status}`)
  const data = await resp.json()
  const content: string = data.choices?.[0]?.message?.content ?? ''
  const jsonStart = content.indexOf('{')
  const jsonEnd = content.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd < 0) throw new Error('AI 返回内容不是有效 JSON')
  const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1))
  const certStages = ['幼儿园', '小学', '初中', '高中']
  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    phone: typeof parsed.phone === 'string' ? parsed.phone : undefined,
    email: typeof parsed.email === 'string' ? parsed.email : undefined,
    position: typeof parsed.position === 'string' ? parsed.position : undefined,
    education: typeof parsed.education === 'string' ? parsed.education : undefined,
    experience: typeof parsed.experience === 'number' ? parsed.experience : undefined,
    skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s: unknown) => typeof s === 'string') : undefined,
    age: typeof parsed.age === 'number' ? parsed.age : undefined,
    certStage: certStages.includes(parsed.certStage) ? parsed.certStage : undefined,
    certSubject: typeof parsed.certSubject === 'string' ? parsed.certSubject : undefined,
    gradYear: typeof parsed.gradYear === 'number' ? parsed.gradYear : undefined,
    hometown: typeof parsed.hometown === 'string' ? parsed.hometown : undefined,
    fullTime: ['全日制', '非全日制', '未知'].includes(parsed.fullTime) ? parsed.fullTime : undefined,
    major: typeof parsed.major === 'string' ? parsed.major : undefined,
    university: typeof parsed.university === 'string' ? parsed.university : undefined,
  }
}

/** 合并：LLM 结果优先，空字段回退到本地引擎结果 */
export function mergeParsed(local: ParsedFields, llm: Partial<ParsedFields>): ParsedFields {
  const merged: ParsedFields = {
    ...local,
    name: llm.name || local.name,
    phone: llm.phone || local.phone,
    email: llm.email || local.email,
    position: llm.position || local.position,
    education: llm.education || local.education,
    experience: llm.experience ?? local.experience,
    skills: llm.skills?.length ? llm.skills : local.skills,
    age: llm.age || local.age,
    certStage: llm.certStage || local.certStage,
    certSubject: llm.certSubject || local.certSubject,
    gradYear: llm.gradYear || local.gradYear,
    hometown: llm.hometown || local.hometown,
    fullTime: llm.fullTime || local.fullTime,
    major: llm.major || local.major,
    university: llm.university || local.university,
    lowConfidence: local.lowConfidence.filter((f) => {
      const key = f as keyof ParsedFields
      const v = llm[key as keyof Partial<ParsedFields>]
      return v === undefined || v === '' || v === 0 || (Array.isArray(v) && v.length === 0)
    }),
  }
  return merged
}
