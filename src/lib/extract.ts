import * as pdfjs from 'pdfjs-dist'
import workerRaw from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
import mammoth from 'mammoth'

// 单文件部署时 data: URL 无法创建 Worker，改用 Blob URL（所有浏览器均允许）
const workerBlob = new Blob([workerRaw], { type: 'text/javascript' })
pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob)

export type ResumeFileKind = 'pdf' | 'docx' | 'text'

export function detectKind(fileName: string): ResumeFileKind | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx' || ext === 'doc') return 'docx'
  if (['txt', 'md', 'text', 'csv', 'json'].includes(ext ?? '')) return 'text'
  return null
}

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    parts.push(text)
  }
  return parts.join('\n')
}

async function extractDocx(buffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value
}

/** 从文件中提取纯文本（PDF / DOCX / 纯文本） */
export async function extractText(file: File): Promise<string> {
  const kind = detectKind(file.name)
  if (!kind) throw new Error(`不支持的文件格式：${file.name}`)
  if (kind === 'text') return file.text()
  const buffer = await file.arrayBuffer()
  if (kind === 'pdf') return extractPdf(buffer)
  return extractDocx(buffer)
}
