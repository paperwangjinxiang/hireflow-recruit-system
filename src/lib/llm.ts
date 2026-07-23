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

const PROMPT = `你是简历解析助手。从下面的简历文本中抽取字段，只输出 JSON，不要输出任何其他内容。
JSON 格式：{"name":"","phone":"","email":"","position":"","education":"","experience":0,"skills":[]}
要求：
- education 只能是：博士/硕士/本科/大专/高中/未知 之一
- experience 是数字，表示工作年限，无法判断则为 0
- skills 是字符串数组，最多 12 个
- 找不到的字段留空字符串

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
  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    phone: typeof parsed.phone === 'string' ? parsed.phone : undefined,
    email: typeof parsed.email === 'string' ? parsed.email : undefined,
    position: typeof parsed.position === 'string' ? parsed.position : undefined,
    education: typeof parsed.education === 'string' ? parsed.education : undefined,
    experience: typeof parsed.experience === 'number' ? parsed.experience : undefined,
    skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s: unknown) => typeof s === 'string') : undefined,
  }
}

/** 合并：LLM 结果优先，空字段回退到本地引擎结果 */
export function mergeParsed(local: ParsedFields, llm: Partial<ParsedFields>): ParsedFields {
  const merged: ParsedFields = {
    name: llm.name || local.name,
    phone: llm.phone || local.phone,
    email: llm.email || local.email,
    position: llm.position || local.position,
    education: llm.education || local.education,
    experience: llm.experience ?? local.experience,
    skills: llm.skills?.length ? llm.skills : local.skills,
    lowConfidence: local.lowConfidence.filter((f) => {
      const key = f as keyof ParsedFields
      const v = llm[key as keyof Partial<ParsedFields>]
      return v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    }),
  }
  return merged
}
