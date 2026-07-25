import * as pdfjs from 'pdfjs-dist'
import mammoth from 'mammoth'
import { getLlmConfig, isVisionReady, ocrWithVision } from '@/lib/llm'
import { authHeaders } from '@/lib/sync'

// Worker 作为同源静态文件随应用一起部署（public/pdf.worker.min.mjs，随 pdfjs-dist 4.x 升级）。
// Chrome 禁止从 data:/blob: URL 创建 ES module Worker，因此必须走同源文件。
// 升级 pdfjs-dist 后需同步执行：cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/
pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs'

export type ResumeFileKind = 'pdf' | 'docx' | 'doc' | 'text'

export function detectKind(fileName: string): ResumeFileKind | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') return 'doc'
  if (['txt', 'md', 'text', 'csv', 'json'].includes(ext ?? '')) return 'text'
  return null
}

/** 扫描件 OCR 最多处理的页数（简历扫描件常见 6-10 页，防止超大文件卡死） */
const OCR_MAX_PAGES = 10
/** 云 OCR 端点（Pages Function 代理，密钥在服务端环境变量；与同步接口同域跨域访问） */
const OCR_API_URL = 'https://hireflow-store-api.pages.dev/api/ocr'
/** 云 OCR 单页请求超时（云端识别含网络往返，给足但不无限等待） */
const CLOUD_OCR_TIMEOUT_MS = 60 * 1000
/** 预处理后有效字符低于该值时视为「预处理反而变差」，用原图重识别一次取更优结果 */
const PREPROCESS_FALLBACK_MIN_VALID = 20
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

/**
 * 自适应二值化（局部均值窗口法）：灰度低于 w×w 邻域均值 × RATIO 判为黑，否则为白。
 * 用积分图把窗口求和降为 O(1)，整页 O(n)，A4 @ scale 3（约 2500×3500）在百毫秒内完成。
 * 这是小字号/浅淡扫描件识别率的关键步骤；对彩色底纹/照片页可能反而有害 → 上层有原图回退兜底。
 * 前置条件：已灰度化（enhanceCanvasForOcr 之后调用），只读 R 通道。
 */
function binarizeCanvasAdaptive(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data
  const stride = width + 1
  // 积分图：Uint32 足够（255 × 约 875 万像素 ≈ 2.2e9 < 2^32）
  const integral = new Uint32Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    const rowOff = (y + 1) * stride
    const prevOff = y * stride
    for (let x = 0; x < width; x++) {
      rowSum += d[(y * width + x) * 4]
      integral[rowOff + x + 1] = integral[prevOff + x + 1] + rowSum
    }
  }
  // 窗口半径随分辨率自适应（约 1-2 个字宽）：过小会填死笔画，过大失去局部性
  const r = Math.max(10, Math.min(40, Math.round(Math.min(width, height) / 100)))
  const RATIO = 0.9
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height - 1, y + r)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width - 1, x + r)
      const sum =
        integral[(y1 + 1) * stride + x1 + 1] -
        integral[y0 * stride + x1 + 1] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0]
      const count = (y1 - y0 + 1) * (x1 - x0 + 1)
      const i = (y * width + x) * 4
      const v = d[i] * count < sum * RATIO ? 0 : 255
      d[i] = d[i + 1] = d[i + 2] = v
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** 本地 OCR 预处理开关（默认开；个别扫描件原图效果更好时可在控制台关闭） */
let ocrPreprocessEnabled = true
export function setOcrPreprocess(enabled: boolean): void {
  ocrPreprocessEnabled = enabled
}

/** 本地 OCR 预处理管线：灰度化 → 直方图对比度拉伸 → 自适应二值化（全程毫秒级，直接操作 ImageData 像素） */
function preprocessCanvasForOcr(canvas: HTMLCanvasElement): void {
  enhanceCanvasForOcr(canvas)
  binarizeCanvasAdaptive(canvas)
}

/** 复制 canvas（预处理是原地操作，回退用原图重识别时需要未处理的副本） */
function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas')
  copy.width = src.width
  copy.height = src.height
  copy.getContext('2d')?.drawImage(src, 0, 0)
  return copy
}

/** 统计 OCR 文本的有效字符数（CJK/字母/数字），用于比较两次识别结果的优劣 */
function countValidChars(text: string): number {
  let n = 0
  for (const ch of text) if (/[\p{L}\p{N}]/u.test(ch)) n++
  return n
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

/** 本地 OCR 兜底：Tesseract 中英文联合模型识别（离线可用，精度低于视觉/云端模型） */
async function ocrWithTesseract(
  doc: pdfjs.PDFDocumentProxy,
  pageNums: number[],
  onProgress?: (msg: string) => void,
): Promise<OcrOutcome> {
  const { createWorker, PSM } = await import('tesseract.js')
  let lastReported = -1
  const makeWorker = async () => {
    const w = await createWorker(['chi_sim', 'eng'], 1, {
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
    // PSM.AUTO：自动版面分析（含分栏/表格检测），不强制单栏，适配双栏排版简历
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    return w
  }
  let worker = await makeWorker()
  const result = new Map<number, string>()
  const warnings: string[] = []
  /** 单页识别 + 3 分钟超时护栏；超时返回空文本并标记（调用方负责重建 worker） */
  const recognizeWithTimeout = async (canvas: HTMLCanvasElement): Promise<{ text: string; timedOut: boolean }> => {
    let timedOut = false
    try {
      const { data } = await Promise.race([
        worker.recognize(canvas.toDataURL('image/png')),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            timedOut = true
            reject(new Error('OCR 超时'))
          }, OCR_PAGE_TIMEOUT_MS)
        }),
      ])
      return { text: data.text, timedOut: false }
    } catch (e) {
      if (timedOut) return { text: '', timedOut: true }
      throw e
    }
  }
  try {
    for (const p of pageNums) {
      onProgress?.(`本地 OCR 识别第 ${p} 页（共 ${pageNums.length} 页，首次使用需下载中英文模型）…`)
      // scale 3 + PNG 无损尽量保住细小文字；预处理管线可开关（setOcrPreprocess）
      const rendered = await renderPageCanvas(doc, p, 3)
      let input = rendered
      let fallbackInput: HTMLCanvasElement | null = null
      if (ocrPreprocessEnabled) {
        input = cloneCanvas(rendered)
        preprocessCanvasForOcr(input)
        fallbackInput = rendered
      }
      const first = await recognizeWithTimeout(input)
      let text = first.text
      let timedOut = first.timedOut
      // 预处理反而变差（有效字符极少）时，用原图重识别一次，取字符数更多的结果
      if (!timedOut && fallbackInput && countValidChars(text) < PREPROCESS_FALLBACK_MIN_VALID) {
        onProgress?.(`第 ${p} 页预处理后字符过少，改用原图重识别…`)
        const second = await recognizeWithTimeout(fallbackInput)
        if (!second.timedOut && countValidChars(second.text) > countValidChars(text)) text = second.text
        timedOut = second.timedOut
      }
      if (timedOut) warnings.push(`第 ${p} 页本地 OCR 识别超时（超过 3 分钟），该页内容未识别`)
      result.set(p, text)
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

/**
 * 云 OCR（可选引擎）：POST 单页图片到 Pages Function 代理（百度通用文字识别高精度版，
 * 密钥存服务端环境变量，不进客户端）。返回 null 表示云端不可用（501 未配置/网络失败），
 * 调用方回退本地 Tesseract；个别页失败时其余页保留云端结果。
 */
async function ocrWithCloud(
  doc: pdfjs.PDFDocumentProxy,
  pageNums: number[],
  onProgress?: (msg: string) => void,
): Promise<OcrOutcome | null> {
  const result = new Map<number, string>()
  const warnings: string[] = []
  for (const p of pageNums) {
    onProgress?.(`云端 OCR 识别第 ${p} 页（共 ${pageNums.length} 页）…`)
    // JPEG 0.92 控制体积（服务端单请求体上限 4MB），云端高精度模型无需本地预处理
    const canvas = await renderPageCanvas(doc, p, 2.5)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    try {
      const resp = await fetch(OCR_API_URL, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
        body: JSON.stringify({ image: dataUrl.split(',')[1] ?? '' }),
        signal: AbortSignal.timeout(CLOUD_OCR_TIMEOUT_MS),
      })
      if (resp.status === 501) return null // 未配置云 OCR：整批回退本地
      if (resp.status === 401) throw new Error('团队口令与服务端不匹配，请检查同步设置')
      if (!resp.ok) throw new Error(`云端 OCR 返回 ${resp.status}`)
      const data = await resp.json()
      if (typeof data?.text !== 'string') throw new Error('云端 OCR 响应格式异常')
      result.set(p, data.text)
    } catch (e) {
      // 首页就失败（网络/服务端故障）：整批回退本地，避免半云半本地的混乱状态
      if (result.size === 0) {
        console.warn('云端 OCR 不可用，回退本地 OCR：', e)
        return null
      }
      warnings.push(`第 ${p} 页云端 OCR 识别失败：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }
  return { result, warnings }
}

/** 扫描页 OCR：视觉大模型 → 云 OCR → 本地 Tesseract 三级回退；仅处理 pageNums 指定的页 */
async function ocrPdf(
  doc: pdfjs.PDFDocumentProxy,
  pageNums: number[],
  onProgress?: (msg: string) => void,
): Promise<OcrOutcome> {
  const config = getLlmConfig()
  // 1) 用户已配置视觉大模型：精度最高，优先
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
      console.warn('视觉模型识别失败，尝试云端 OCR：', e)
      onProgress?.('视觉模型不可用，尝试云端 OCR…')
    }
  }
  // 2) 云 OCR（可选，密钥在服务端；501/网络失败返回 null 回退本地）
  try {
    const cloud = await ocrWithCloud(doc, pageNums, onProgress)
    if (cloud) {
      // 云端未识别出文字的页面（空结果或识别失败），回退本地 Tesseract 补齐
      const missing = pageNums.filter((p) => !(cloud.result.get(p) ?? '').trim())
      if (missing.length > 0 && missing.length < pageNums.length) {
        onProgress?.('部分页面云端未识别，回退本地 OCR 补齐…')
        const local = await ocrWithTesseract(doc, missing, onProgress)
        local.result.forEach((t, p) => {
          if (t.trim()) cloud.result.set(p, t)
        })
        cloud.warnings.push(...local.warnings)
      } else if (missing.length === pageNums.length) {
        // 云端全部页空结果：视为不可用，整批走本地
        return ocrWithTesseract(doc, pageNums, onProgress)
      }
      return cloud
    }
  } catch (e) {
    console.warn('云端 OCR 异常，回退本地 OCR：', e)
  }
  // 3) 本地 Tesseract 兜底
  onProgress?.('云端 OCR 不可用，切换本地 OCR…')
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
  // mammoth 只支持 .docx；老式 .doc 二进制格式走 word-extractor（见 extractLegacyDoc）
  if (fileName.toLowerCase().endsWith('.doc') && !fileName.toLowerCase().endsWith('.docx')) {
    return extractLegacyDoc(buffer)
  }
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value
}

/** 老式二进制 Word（.doc, OLE2/CFB 格式）：word-extractor 提取正文纯文本 */
async function extractLegacyDoc(buffer: ArrayBuffer): Promise<string> {
  const { extractLegacyDocText } = await import('@/lib/legacy-doc')
  return extractLegacyDocText(buffer)
}

/** 从文件中提取纯文本（PDF / DOCX / DOC / 纯文本；扫描页 PDF 自动走 OCR）；单文件 >20MB 直接拒绝 */
export async function extractText(file: File, onProgress?: (msg: string) => void): Promise<ExtractResult> {
  const kind = detectKind(file.name)
  if (!kind) throw new Error(`不支持的文件格式：${file.name}`)
  if (file.size > MAX_FILE_SIZE) throw new Error('文件过大（>20MB），请先压缩后重新上传')
  if (kind === 'text') return { text: await file.text(), warnings: [] }
  const buffer = await file.arrayBuffer()
  if (kind === 'pdf') return extractPdf(buffer, onProgress)
  if (kind === 'doc') return { text: await extractLegacyDoc(buffer), warnings: [] }
  return { text: await extractDocx(buffer, file.name), warnings: [] }
}
