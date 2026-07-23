import * as pdfjs from 'pdfjs-dist'
import mammoth from 'mammoth'
import { getLlmConfig, isVisionReady, ocrWithVision } from '@/lib/llm'

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

/** 扫描件 OCR 最多处理的页数（简历页数有限，防止超大文件卡死） */
const OCR_MAX_PAGES = 5

/** 提取 PDF 文字层 */
async function extractPdfTextLayer(doc: pdfjs.PDFDocumentProxy): Promise<string> {
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

/** 把 PDF 页面渲染为 JPEG dataURL（供视觉模型识别） */
async function renderPdfPages(doc: pdfjs.PDFDocumentProxy, onProgress?: (msg: string) => void): Promise<string[]> {
  const maxPages = Math.min(doc.numPages, OCR_MAX_PAGES)
  const images: string[] = []
  for (let i = 1; i <= maxPages; i++) {
    onProgress?.(`正在渲染第 ${i}/${maxPages} 页…`)
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布上下文')
    await page.render({ canvasContext: ctx, viewport }).promise
    images.push(canvas.toDataURL('image/jpeg', 0.85))
  }
  return images
}

/** 本地 OCR 兜底：Tesseract 中文识别（离线可用，精度低于视觉模型） */
async function ocrWithTesseract(doc: pdfjs.PDFDocumentProxy, onProgress?: (msg: string) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const maxPages = Math.min(doc.numPages, OCR_MAX_PAGES)
  let lastReported = -1
  const worker = await createWorker('chi_sim', 1, {
    logger: (m: { status: string; progress?: number }) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        const pct = Math.round(m.progress * 10)
        if (pct !== lastReported) {
          lastReported = pct
          onProgress?.(`本地 OCR 识别中… ${Math.round(m.progress * 100)}%`)
        }
      }
    },
  })
  try {
    const texts: string[] = []
    for (let i = 1; i <= maxPages; i++) {
      onProgress?.(`本地 OCR 识别第 ${i}/${maxPages} 页（首次使用需下载中文模型）…`)
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建画布上下文')
      await page.render({ canvasContext: ctx, viewport }).promise
      const { data } = await worker.recognize(canvas)
      texts.push(data.text)
    }
    return texts.join('\n')
  } finally {
    await worker.terminate()
  }
}

/** 扫描件 OCR：优先视觉大模型，失败或未配置时回退本地 Tesseract */
async function ocrPdf(doc: pdfjs.PDFDocumentProxy, onProgress?: (msg: string) => void): Promise<string> {
  const config = getLlmConfig()
  if (isVisionReady(config)) {
    try {
      onProgress?.('正在使用 AI 视觉模型识别扫描件…')
      const images = await renderPdfPages(doc, onProgress)
      onProgress?.('AI 视觉模型识别中…')
      const text = await ocrWithVision(images, config)
      if (text.trim()) return text
    } catch (e) {
      console.warn('视觉模型识别失败，回退本地 OCR：', e)
      onProgress?.('视觉模型不可用，切换本地 OCR…')
    }
  }
  return ocrWithTesseract(doc, onProgress)
}

async function extractPdf(buffer: ArrayBuffer, onProgress?: (msg: string) => void): Promise<string> {
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  const text = await extractPdfTextLayer(doc)
  // 文字层内容过少 → 判定为扫描件/图片型 PDF，走 OCR
  if (text.replace(/\s/g, '').length >= 30) return text
  onProgress?.('未检测到文字层，正在启用 OCR 识别…')
  return ocrPdf(doc, onProgress)
}

async function extractDocx(buffer: ArrayBuffer, fileName: string): Promise<string> {
  // mammoth 只支持 .docx；老式 .doc 二进制格式无法解析
  if (fileName.toLowerCase().endsWith('.doc') && !fileName.toLowerCase().endsWith('.docx')) {
    throw new Error('暂不支持老式 .doc 格式，请在 Word 中另存为 .docx 后重新上传')
  }
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value
}

/** 从文件中提取纯文本（PDF / DOCX / 纯文本；扫描件 PDF 自动走 OCR） */
export async function extractText(file: File, onProgress?: (msg: string) => void): Promise<string> {
  const kind = detectKind(file.name)
  if (!kind) throw new Error(`不支持的文件格式：${file.name}`)
  if (kind === 'text') return file.text()
  const buffer = await file.arrayBuffer()
  if (kind === 'pdf') return extractPdf(buffer, onProgress)
  return extractDocx(buffer, file.name)
}
