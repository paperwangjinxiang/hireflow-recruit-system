import * as pdfjs from 'pdfjs-dist'
import mammoth from 'mammoth'
import { getLlmConfig, isVisionReady, ocrWithVision } from '@/lib/llm'

// Worker 作为同源静态文件随应用一起部署（public/pdf.worker.min.mjs，随 pdfjs-dist 4.x 升级）。
// Chrome 禁止从 data:/blob: URL 创建 ES module Worker，因此必须走同源文件。
// 升级 pdfjs-dist 后需同步执行：cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/
pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs'

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
/** 单文件大小上限：超过直接拒绝（内存与解析耗时护栏） */
export const MAX_FILE_SIZE = 20 * 1024 * 1024
/** Tesseract 单页 OCR 超时：超时按该页识别失败处理，不得永远「解析中」 */
const OCR_PAGE_TIMEOUT_MS = 3 * 60 * 1000
/** 单页有效字符达到该值视为文字页，直接使用文字层 */
const TEXT_PAGE_MIN_CHARS = 80
/** 整份 PDF 有效字符低于该值时判定为纯扫描件，全量 OCR */
const DOC_SCAN_MAX_CHARS = 30
/** 替换符/控制符比例超过该值视为乱码页（文字层损坏），改走 OCR */
const JUNK_RATIO_MAX = 0.3

/** 统计一页文本的有效字符数（CJK/字母/数字，忽略空白）与乱码（替换符/控制符）比例 */
function analyzePageText(text: string): { valid: number; junkRatio: number } {
  let valid = 0
  let junk = 0
  let nonSpace = 0
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    nonSpace++
    if (/[\p{L}\p{N}]/u.test(ch)) valid++
    else if (ch === '' || /[\p{Cc}\p{Cf}]/u.test(ch)) junk++
  }
  return { valid, junkRatio: nonSpace > 0 ? junk / nonSpace : 0 }
}

/** 提取 PDF 文字层（所有页并发取 textContent，按页重组行结构），返回每页文本数组 */
async function extractPdfTextLayer(doc: pdfjs.PDFDocumentProxy): Promise<string[]> {
  const pageNums = Array.from({ length: doc.numPages }, (_, i) => i + 1)
  const contents = await Promise.all(
    pageNums.map(async (i) => {
      const page = await doc.getPage(i)
      return page.getTextContent()
    }),
  )
  return contents.map((content) => {
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
    return pageText
  })
}

/** 渲染指定页为 canvas */
async function renderPageCanvas(
  doc: pdfjs.PDFDocumentProxy,
  pageNum: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas
}

/** 图像增强：灰度化 + 直方图对比度拉伸（1%~99% 分位），提升本地 OCR 对细小/浅淡文字的识别率 */
function enhanceCanvasForOcr(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data
  const total = width * height
  const hist = new Uint32Array(256)
  // 第一遍：整数近似灰度化（0.299/0.587/0.114 ≈ 77/150/29 >> 8）并统计直方图
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8
    d[i] = d[i + 1] = d[i + 2] = g
    hist[g]++
  }
  // 取 1% / 99% 分位作为拉伸端点，忽略极端噪点
  let acc = 0
  let lo = 0
  let hi = 255
  const loTarget = total * 0.01
  const hiTarget = total * 0.99
  for (let g = 0; g < 256; g++) {
    acc += hist[g]
    if (acc <= loTarget) lo = g
    if (acc <= hiTarget) hi = g
  }
  const range = Math.max(hi - lo, 1)
  const lut = new Uint8Array(256)
  for (let g = 0; g < 256; g++) {
    lut[g] = Math.min(255, Math.max(0, Math.round(((g - lo) * 255) / range)))
  }
  // 第二遍：查表拉伸
  for (let i = 0; i < d.length; i += 4) {
    const v = lut[d[i]]
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
}

/** 把指定 PDF 页面渲染为 JPEG dataURL（供视觉模型识别；scale 2.5 / 质量 0.92 兼顾细小文字） */
async function renderPdfPages(
  doc: pdfjs.PDFDocumentProxy,
  pageNums: number[],
  onProgress?: (msg: string) => void,
): Promise<string[]> {
  const images: string[] = []
  for (const p of pageNums) {
    onProgress?.(`正在渲染第 ${p} 页…`)
    const canvas = await renderPageCanvas(doc, p, 2.5)
    images.push(canvas.toDataURL('image/jpeg', 0.92))
  }
  return images
}

/** OCR 结果：页码 → 识别文本，外加超时/失败等提醒（并入解析结果的低置信度提示） */
interface OcrOutcome {
  result: Map<number, string>
  warnings: string[]
}

/** 本地 OCR 兜底：Tesseract 中英文联合模型识别（离线可用，精度低于视觉模型） */
async function ocrWithTesseract(
  doc: pdfjs.PDFDocumentProxy,
  pageNums: number[],
  onProgress?: (msg: string) => void,
): Promise<OcrOutcome> {
  const { createWorker } = await import('tesseract.js')
  let lastReported = -1
  const makeWorker = () =>
    createWorker(['chi_sim', 'eng'], 1, {
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
  let worker = await makeWorker()
  const result = new Map<number, string>()
  const warnings: string[] = []
  try {
    for (const p of pageNums) {
      onProgress?.(`本地 OCR 识别第 ${p} 页（共 ${pageNums.length} 页，首次使用需下载中英文模型）…`)
      // scale 3 + 灰度/对比度增强 + PNG 无损，尽量保住细小文字
      const canvas = await renderPageCanvas(doc, p, 3)
      enhanceCanvasForOcr(canvas)
      // 单页 3 分钟超时护栏：超时按该页识别失败处理，后续页继续（worker 可能仍卡死，重建）
      let timedOut = false
      const { data } = await Promise.race([
        worker.recognize(canvas.toDataURL('image/png')),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            timedOut = true
            reject(new Error(`第 ${p} 页 OCR 超时`))
          }, OCR_PAGE_TIMEOUT_MS)
        }),
      ]).catch(async (e: unknown) => {
        if (!timedOut) throw e
        warnings.push(`第 ${p} 页本地 OCR 识别超时（超过 3 分钟），该页内容未识别`)
        return { data: { text: '' } }
      })
      result.set(p, data.text)
      if (timedOut) {
        // 超时的 worker 内部任务可能仍在执行，直接废弃并为后续页重建
        try {
          await worker.terminate()
        } catch {
          // ignore
        }
        if (p !== pageNums[pageNums.length - 1]) worker = await makeWorker()
      }
    }
    return { result, warnings }
  } finally {
    try {
      await worker.terminate()
    } catch {
      // ignore
    }
  }
}

/** 扫描页 OCR：优先视觉大模型，失败或未配置时回退本地 Tesseract；仅处理 pageNums 指定的页 */
async function ocrPdf(
  doc: pdfjs.PDFDocumentProxy,
  pageNums: number[],
  onProgress?: (msg: string) => void,
): Promise<OcrOutcome> {
  const config = getLlmConfig()
  if (isVisionReady(config)) {
    try {
      onProgress?.('正在使用 AI 视觉模型识别扫描页…')
      const result = new Map<number, string>()
      for (const p of pageNums) {
        const images = await renderPdfPages(doc, [p], onProgress)
        onProgress?.(`AI 视觉模型识别第 ${p} 页…`)
        const text = await ocrWithVision(images, config)
        result.set(p, text)
      }
      if ([...result.values()].some((t) => t.trim())) return { result, warnings: [] }
    } catch (e) {
      console.warn('视觉模型识别失败，回退本地 OCR：', e)
      onProgress?.('视觉模型不可用，切换本地 OCR…')
    }
  }
  return ocrWithTesseract(doc, pageNums, onProgress)
}

/** 文本提取结果：正文 + 提醒（OCR 截断/超时等，并入低置信度提示） */
export interface ExtractResult {
  text: string
  warnings: string[]
}

async function extractPdf(buffer: ArrayBuffer, onProgress?: (msg: string) => void): Promise<ExtractResult> {
  let doc: pdfjs.PDFDocumentProxy
  try {
    // pdfjs-dist 4.x 要求 TypedArray 入参（ArrayBuffer 已废弃）
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/password/i.test(msg)) throw new Error('PDF 已加密，请先解除密码保护后重新上传')
    throw new Error('PDF 文件损坏或格式异常，无法读取')
  }
  try {
    const pageTexts = await extractPdfTextLayer(doc)
    const stats = pageTexts.map(analyzePageText)
    const totalValid = stats.reduce((s, x) => s + x.valid, 0)

    // 逐页判定：整份有效字符 < 30 → 纯扫描件全量 OCR；
    // 否则单页有效字符 < 80 或乱码比例过高 → 该页走 OCR，其余页用文字层
    const scanPages: number[] = []
    if (totalValid < DOC_SCAN_MAX_CHARS) {
      for (let i = 1; i <= doc.numPages; i++) scanPages.push(i)
    } else {
      stats.forEach((s, idx) => {
        if (s.valid < TEXT_PAGE_MIN_CHARS || s.junkRatio > JUNK_RATIO_MAX) scanPages.push(idx + 1)
      })
    }
    // OCR 最多处理前 OCR_MAX_PAGES 页，超出页保留其（稀疏的）文字层
    const ocrPages = scanPages.filter((p) => p <= OCR_MAX_PAGES)
    const warnings: string[] = []
    // 发生了截断（存在未 OCR 的扫描页）时提醒：后续页内容未识别
    if (doc.numPages > OCR_MAX_PAGES && scanPages.length > ocrPages.length) {
      warnings.push(`共 ${doc.numPages} 页，仅识别前 ${OCR_MAX_PAGES} 页，后续内容未识别`)
    }
    if (ocrPages.length === 0) return { text: pageTexts.join('\n'), warnings }

    onProgress?.(
      `检测到 ${scanPages.length} 页为图片/扫描页，正在启用 OCR 识别（扫描件仅识别前 ${OCR_MAX_PAGES} 页）…`,
    )
    const ocr = await ocrPdf(doc, ocrPages, onProgress)
    warnings.push(...ocr.warnings)
    // 按页序合并：文字页用文字层，扫描页用 OCR 文本
    return { text: pageTexts.map((t, idx) => ocr.result.get(idx + 1) ?? t).join('\n'), warnings }
  } finally {
    // 释放 PDF 文档句柄与缓存，避免每解析一份 PDF 驻留一份内存（destroy 是异步的，失败静默忽略）
    try {
      await doc.destroy()
    } catch {
      // ignore
    }
  }
}

async function extractDocx(buffer: ArrayBuffer, fileName: string): Promise<string> {
  // mammoth 只支持 .docx；老式 .doc 二进制格式无法解析
  if (fileName.toLowerCase().endsWith('.doc') && !fileName.toLowerCase().endsWith('.docx')) {
    throw new Error('暂不支持老式 .doc 格式，请在 Word 中另存为 .docx 后重新上传')
  }
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value
}

/** 从文件中提取纯文本（PDF / DOCX / 纯文本；扫描页 PDF 自动走 OCR）；单文件 >20MB 直接拒绝 */
export async function extractText(file: File, onProgress?: (msg: string) => void): Promise<ExtractResult> {
  const kind = detectKind(file.name)
  if (!kind) throw new Error(`不支持的文件格式：${file.name}`)
  if (file.size > MAX_FILE_SIZE) throw new Error('文件过大（>20MB），请先压缩后重新上传')
  if (kind === 'text') return { text: await file.text(), warnings: [] }
  const buffer = await file.arrayBuffer()
  if (kind === 'pdf') return extractPdf(buffer, onProgress)
  return { text: await extractDocx(buffer, file.name), warnings: [] }
}
