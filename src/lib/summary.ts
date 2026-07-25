/** AI 候选人摘要：规则模板生成中文画像 + 可选 LLM 润色（对标 Greenhouse AI Summary） */

import type { Job, Resume } from '@/types'
import { evaluateResume } from '@/lib/evaluate'
import { getLlmConfig, type LlmConfig } from '@/lib/llm'

export interface CandidateSummary {
  /** 2-4 句中文候选人画像 */
  text: string
  /** 绿色亮点（最多 5 条） */
  highlights: string[]
  /** 红色风险（最多 5 条，复用 evaluate.ts 的 alerts） */
  risks: string[]
}

const NORMAL_UNI_KEYWORD = /师范|教育学院/

/** 证书简写：取前几个有代表性的证书名 */
function certBrief(certificates: string[]): string[] {
  const brief: string[] = []
  const pick = (re: RegExp) => {
    const hit = certificates.find((c) => re.test(c))
    if (hit) brief.push(hit.length > 12 ? hit.slice(0, 12) : hit)
  }
  pick(/普通话/)
  pick(/CET-6|英语六级|专八/)
  if (brief.length === 0) pick(/CET-4|英语四级|专四|雅思|托福/)
  pick(/计算机/)
  return brief.slice(0, 3)
}

/** 规则模板生成候选人画像（信息缺失时跳过对应子句，不堆砌「未知」） */
export function generateCandidateSummary(resume: Resume, job?: Job | null): CandidateSummary {
  const r = resume
  const s1: string[] = []
  if (r.age > 0) s1.push(`${r.age} 岁`)
  // 学历子句：华南师范大学全日制本科（汉语言文学）
  const eduParts: string[] = []
  if (r.university) eduParts.push(r.university)
  if (r.fullTime !== '未知') eduParts.push(r.fullTime)
  if (r.education && r.education !== '未知') eduParts.push(r.education)
  if (eduParts.length > 0) {
    s1.push(eduParts.join('') + (r.major ? `（${r.major}）` : ''))
  } else if (r.major) {
    s1.push(`${r.major}专业`)
  }
  if (r.certStage) {
    s1.push(`持${r.certStage}${r.certSubject}教师资格证`)
  } else if (r.certQualified) {
    s1.push('持教师资格考试合格证明（待认定）')
  }
  if (r.experience > 0) {
    const teach = r.certStage && r.certSubject ? `${r.certStage}${r.certSubject}教学` : ''
    s1.push(`${r.experience} 年${teach}经验`)
  }
  if (r.company) s1.push(`最近任职于${r.company}`)

  const s2: string[] = []
  const certs = certBrief(r.certificates)
  if (certs.length > 0) s2.push(certs.join('、'))
  if (r.skills.length > 0) s2.push(`擅长${r.skills.slice(0, 3).join('、')}`)

  const s3: string[] = []
  if (r.position) s3.push(`应聘${r.position}`)
  if (job?.region && r.tags.some((t) => t.includes(job.region))) s3.push(`意向${job.region}`)
  if (r.hometown) s3.push(`籍贯${r.hometown}`)
  if (r.gradYear > 0) s3.push(`${r.gradYear} 年毕业`)

  const sentences = [s1, s2, s3].filter((s) => s.length > 0).map((s) => s.join('，') + '。')
  const text = sentences.length > 0 ? sentences.join('') : '暂无足够信息生成候选人画像，请补充资料。'

  // ---- 亮点 ----
  const highlights: string[] = []
  if (r.university && NORMAL_UNI_KEYWORD.test(r.university)) highlights.push(`师范类院校背景（${r.university}）`)
  if (r.fullTime === '全日制' && ['本科', '硕士', '博士'].includes(r.education)) {
    highlights.push(`全日制${r.education}学历`)
  }
  if (r.certStage) {
    if (job && r.certStage === job.level && r.certSubject === job.subject) {
      highlights.push(`教资学段科目与应聘岗位完全匹配（${r.certStage}${r.certSubject}）`)
    } else {
      highlights.push(`持${r.certStage}${r.certSubject}教师资格证`)
    }
  }
  if (r.certificates.length >= 3) highlights.push(`证书丰富（${r.certificates.length} 项）`)
  if (r.experience >= 5) highlights.push(`${r.experience} 年教学经验，教龄稳定`)
  else if (r.experience >= 2) highlights.push(`${r.experience} 年教学经验`)
  if (r.age >= 22 && r.age <= 30) highlights.push(`年龄优势明显（${r.age} 岁）`)

  // ---- 风险：复用 evaluate.ts 的 alerts ----
  const evaluation = evaluateResume(resume, job)
  if (evaluation.overall >= 85 && highlights.length < 5) highlights.push(`综合评估优秀（${evaluation.overall} 分 · A 级）`)
  const risks = evaluation.alerts.map((a) => a.text).slice(0, 5)

  return { text, highlights: highlights.slice(0, 5), risks }
}

/** 是否配置了可用的 LLM（决定是否显示「AI 润色」按钮） */
export function isSummaryAiReady(): boolean {
  const c = getLlmConfig()
  return !!(c.enabled && c.baseUrl && c.apiKey && c.model)
}

const POLISH_PROMPT = `你是教师招聘领域的 HR 助手。根据下面候选人的结构化信息和简历原文，写一段 2-4 句的自然中文候选人画像（80-160 字），语气专业客观，突出与教师岗位相关的学历、教资、经验与证书，信息缺失的内容不要编造。只输出画像文字本身，不要输出标题、解释或 Markdown。

候选人结构化信息：
`

/** 调用 LLM 基于结构化字段 + 简历原文生成更自然的摘要；失败时抛错由调用方回退 */
export async function polishSummaryWithLlm(resume: Resume, config?: LlmConfig): Promise<string> {
  const c = config ?? getLlmConfig()
  const base = c.baseUrl.replace(/\/+$/, '')
  const fields = {
    姓名: resume.name,
    年龄: resume.age > 0 ? resume.age : undefined,
    学历: resume.education !== '未知' ? resume.education : undefined,
    全日制: resume.fullTime !== '未知' ? resume.fullTime : undefined,
    毕业院校: resume.university || undefined,
    专业: resume.major || undefined,
    毕业年份: resume.gradYear > 0 ? resume.gradYear : undefined,
    教师资格证: resume.certStage ? `${resume.certStage}${resume.certSubject}` : resume.certQualified ? '考试合格证明（待认定）' : undefined,
    工作年限: resume.experience > 0 ? `${resume.experience} 年` : undefined,
    最近任职: resume.company || undefined,
    籍贯: resume.hometown || undefined,
    应聘岗位: resume.position || undefined,
    证书: resume.certificates.length > 0 ? resume.certificates.join('、') : undefined,
    技能: resume.skills.length > 0 ? resume.skills.join('、') : undefined,
  }
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.apiKey}`,
    },
    body: JSON.stringify({
      model: c.model,
      messages: [
        {
          role: 'user',
          content:
            POLISH_PROMPT +
            JSON.stringify(fields, null, 2) +
            '\n\n简历原文（节选）：\n' +
            resume.rawText.slice(0, 3000),
        },
      ],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!resp.ok) throw new Error(`AI 接口返回 ${resp.status}`)
  const data = await resp.json()
  const content: string = data.choices?.[0]?.message?.content ?? ''
  const text = content.trim().replace(/^["「]|["」]$/g, '')
  if (!text) throw new Error('AI 未返回有效摘要')
  return text
}
