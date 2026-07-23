import * as pdfjs from 'pdfjs-dist'
import mammoth from 'mammoth'

// Worker 作为同源静态文件随应用一起部署（public/pdf.worker.min.js）。
// Chrome 禁止从 data:/blob: URL 创建 ES module Worker，因此必须走同源文件。
pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js'

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
    // 按行重组：利用 hasEOL 与纵坐标变化还原简历的行结构
    let pageText = ''
    let lastY: number | null = null
    for (const item of content.items) {
      if (!('str' in item)) continue
      const y = item.transform[5]
      if (lastY !== null && Math.abs(y - lastY) > 2) pageText += '\n'
      else if (lastY !== null && pageText.length > 0) pageText += ' '
      pageText += item.str
      if (item.hasEOL) pageText += '\n'
      lastY = item.transform[5]
    }
    parts.push(pageText)
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
