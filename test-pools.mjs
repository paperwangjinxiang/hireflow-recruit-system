import puppeteer from 'puppeteer-core'

// 个人库 + 招聘进展 端到端测试：
// 1. 以当前用户在职位页锁定一份简历
// 2. 总简历库中该简历消失，「我的简历库」中出现
// 3. 招聘进展页展示专员统计
// 4. 释放后该简历回到总库
const BASE = process.argv[2] || 'http://localhost:5190'

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror: ' + e.message))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = false
const check = (ok, label) => { console.log(`${ok ? '✅' : '❌'} ${label}`); if (!ok) failed = true }

// 先清空本地存储，保证从种子数据开始
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 90000 })
await page.evaluate(() => localStorage.clear())
await page.goto(`${BASE}/#/jobs`, { waitUntil: 'networkidle0', timeout: 90000 })

// 1. 锁定一份简历
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('匹配简历'))
  btn?.click()
})
await sleep(1500)
const lockName = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('li button')).find((b) => b.innerText.includes('锁定'))
  if (!btn) return null
  const name = btn.closest('li').querySelector('.font-medium')?.innerText
  btn.click()
  return name
})
check(!!lockName, `已锁定简历：${lockName}`)
await sleep(800)

// 2. 总简历库中不出现该简历（只检查表格区域，避开 toast 通知文本）
await page.goto(`${BASE}/#/resumes`, { waitUntil: 'networkidle0', timeout: 60000 })
await sleep(1200)
let text = await page.evaluate(() => document.querySelector('table')?.innerText ?? '')
check(!text.includes(lockName), '总简历库中不再显示被锁定的简历')

// 3. 切换到我的简历库，应出现
await page.evaluate(() => {
  const item = Array.from(document.querySelectorAll('[data-state], button, a')).find((el) => el.innerText?.includes('我的简历库'))
  item?.click()
})
await sleep(1000)
text = await page.evaluate(() => document.querySelector('table')?.innerText ?? '')
check(text.includes(lockName), '我的简历库中显示该简历')

// 4. 招聘进展页展示专员统计
await page.goto(`${BASE}/#/progress`, { waitUntil: 'networkidle0', timeout: 60000 })
await sleep(1200)
text = await page.evaluate(() => document.body.innerText)
check(text.includes('各招聘专员') && text.includes(lockName) || text.includes('锁定中'), '招聘进展页展示专员面试录用统计')
check(text.includes('职位到岗进度'), '招聘进展页展示职位到岗进度')

// 5. 释放简历后回到总库
await page.goto(`${BASE}/#/jobs`, { waitUntil: 'networkidle0', timeout: 60000 })
await sleep(1200)
await page.evaluate((name) => {
  const row = Array.from(document.querySelectorAll('li')).find((li) => li.innerText.includes(name))
  row?.querySelector('button[title*="释放"]')?.click()
}, lockName)
await sleep(800)
await page.goto(`${BASE}/#/resumes`, { waitUntil: 'networkidle0', timeout: 60000 })
await sleep(1200)
text = await page.evaluate(() => document.querySelector('table')?.innerText ?? '')
check(text.includes(lockName), '释放后简历退回总简历库')

await browser.close()
process.exit(failed ? 1 : 0)
