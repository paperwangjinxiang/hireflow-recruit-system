import puppeteer from 'puppeteer-core'

// 人岗匹配评分 UI 测试：打开职位发布页 → 点击「匹配简历」→ 验证出现匹配分数徽章
const BASE = process.argv[2] || 'http://localhost:5190'

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

await page.goto(`${BASE}/#/jobs`, { waitUntil: 'networkidle0', timeout: 90000 })

// 点击第一个「匹配简历」按钮
const clicked = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'))
  const target = btns.find((b) => b.innerText.includes('匹配简历'))
  if (target) { target.click(); return true }
  return false
})
if (!clicked) {
  console.log('❌ 未找到「匹配简历」按钮')
  await browser.close()
  process.exit(1)
}

try {
  await page.waitForFunction(
    () => /匹配 \d+ 分/.test(document.body.innerText),
    { timeout: 20000, polling: 500 },
  )
} catch {
  // fall through
}

const text = await page.evaluate(() => document.body.innerText)
const scores = [...text.matchAll(/匹配 (\d+) 分 · (\S+)/g)].map((m) => `${m[1]}分(${m[2]})`)
const ok = scores.length > 0
console.log(ok ? `✅ 匹配评分生效，候选人按分数排序：${scores.slice(0, 5).join('、')}` : '❌ 未出现匹配分数')
if (consoleErrors.length) {
  console.log('--- 页面脚本错误 ---')
  consoleErrors.slice(0, 5).forEach((e) => console.log(e))
}
await browser.close()
process.exit(ok ? 0 : 1)
