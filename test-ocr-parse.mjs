import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

// OCR 端到端测试：上传扫描件（图片型）PDF，验证能 OCR 出候选人姓名
const BASE = process.argv[2] || 'http://localhost:5190'
const PDF = process.argv[3] || 'D:\\HuaweiMoveData\\Users\\52981\\Documents\\Kimi\\Workspaces\\网站开发\\扫描简历-王慧敏.pdf'
const EXPECT = process.argv[4] || '王慧敏'

const b64 = fs.readFileSync(PDF).toString('base64')

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()) })

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

// OCR 首次需下载中文模型 + 识别，给足 4 分钟
try {
  await page.waitForFunction(
    (expect) => document.body.innerText.includes(expect) || document.body.innerText.includes('解析失败') || document.body.innerText.includes('无法识别'),
    { timeout: 240000, polling: 1000 },
    EXPECT,
  )
} catch {
  // timeout — fall through to dump
}

const bodyText = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map((el) => el.value || '').join(' ')
  return document.body.innerText + '\n' + inputs
})
const hasName = bodyText.includes(EXPECT)
console.log(hasName ? `✅ OCR 解析成功，识别出候选人「${EXPECT}」` : `❌ OCR 未识别出候选人「${EXPECT}」`)
console.log('--- 页面文本摘录 ---')
console.log(bodyText.split('\n').filter((l) => l.trim()).slice(0, 40).join('\n'))
if (consoleErrors.length) {
  console.log('--- 浏览器报错 ---')
  consoleErrors.slice(0, 10).forEach((e) => console.log(e))
}
await browser.close()
process.exit(hasName ? 0 : 1)
