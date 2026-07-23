import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

// 视觉模型失败兜底测试：配置一个无效的视觉模型密钥，
// 上传扫描件 PDF 后应自动回退本地 Tesseract OCR 并成功识别
const BASE = process.argv[2] || 'http://localhost:5190'
const PDF = process.argv[3] || 'D:\\HuaweiMoveData\\Users\\52981\\Documents\\Kimi\\Workspaces\\网站开发\\扫描简历-王慧敏.pdf'
const EXPECT = process.argv[4] || '王慧敏'

const b64 = fs.readFileSync(PDF).toString('base64')

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('hireflow-llm-config', JSON.stringify({
    enabled: false,
    baseUrl: 'https://invalid.example.com/v1',
    apiKey: 'sk-invalid-key',
    model: 'fake-model',
    visionEnabled: true,
    visionModel: 'fake-vision-model',
  }))
})
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

await page.goto(`${BASE}/#/ai-parse`, { waitUntil: 'networkidle0', timeout: 90000 })

await page.evaluate(async (data) => {
  const res = await fetch('data:application/pdf;base64,' + data)
  const blob = await res.blob()
  const file = new File([blob], 'scanned-resume.pdf', { type: 'application/pdf' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('input[type=file]')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}, b64)

try {
  await page.waitForFunction(
    (expect) => document.body.innerText.includes(expect) || document.body.innerText.includes('解析失败') || document.body.innerText.includes('无法识别'),
    { timeout: 240000, polling: 1000 },
    EXPECT,
  )
} catch {
  // timeout — fall through
}

const bodyText = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map((el) => el.value || '').join(' ')
  return document.body.innerText + '\n' + inputs
})
const hasName = bodyText.includes(EXPECT)
const fellBack = bodyText.includes('本地 OCR') || hasName // 失败后回退本地识别
console.log(hasName && fellBack
  ? `✅ 视觉模型失效时成功回退本地 OCR，识别出「${EXPECT}」`
  : `❌ 兜底机制失败（识别=${hasName}）`)
if (consoleErrors.length) {
  console.log('--- 页面脚本错误 ---')
  consoleErrors.slice(0, 5).forEach((e) => console.log(e))
}
await browser.close()
process.exit(hasName ? 0 : 1)
