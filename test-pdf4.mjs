/**
 * pdfjs-dist 4.x Node 端到端验证：用真实 PDF 简历提取文字层，确认中文字符正常输出。
 * 用法：node test-pdf4.mjs [pdf路径]
 *
 * pdfjs 4.x 在 Node 下的要点：
 * - 使用 legacy 构建（pdfjs-dist/legacy/build/pdf.mjs），对非浏览器环境兼容更好
 * - getDocument 入参必须是 TypedArray（4.x 已废弃直接传 ArrayBuffer）
 * - Node 没有 DOM Worker，pdfjs 会自动回退到「fake worker」（主线程内动态 import worker 模块），
 *   前提是 workerSrc 指向可解析的 worker 文件路径
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PDF = process.argv[2] || path.join('test-fixtures', '江洁彤个人简历.pdf')

// 显式指定 worker（file URL），fake worker 回退时能解析到模块
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.resolve('node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs'),
).href

const data = new Uint8Array(fs.readFileSync(PDF))
console.log(`pdfjs-dist 版本：${pdfjs.version}`)
console.log(`测试文件：${PDF}（${(data.length / 1024).toFixed(1)} KB）`)

const doc = await pdfjs.getDocument({
  data,
  isEvalSupported: false, // Node 下关闭 eval，走纯解析路径
}).promise

console.log(`总页数：${doc.numPages}`)

let all = ''
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i)
  const content = await page.getTextContent()
  const pageText = content.items.filter((it) => 'str' in it).map((it) => it.str).join('')
  all += pageText + '\n'
}

const trimmed = all.trim()
console.log(`提取字符数：${trimmed.length}`)
console.log('--- 前 200 字 ---')
console.log(trimmed.slice(0, 200))

// 中文输出校验：提取文本中应包含足够的中文字符
const cjkCount = (trimmed.match(/[一-龥]/g) ?? []).length
console.log(`中文字符数：${cjkCount}`)
if (cjkCount < 10) {
  console.error('❌ 中文字符过少，pdfjs 4.x 文字层提取可能异常')
  process.exit(1)
}
console.log('✅ pdfjs-dist 4.x 真实 PDF 中文文字层提取正常')
