import puppeteer from 'puppeteer-core'

// 打开线上站点，等待其通过指针向新 manifest 播种数据
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage()
page.on('response', (r) => { if (r.url().includes('jsonblob')) console.log('[jsonblob]', r.request().method(), r.status()) })
await page.goto('https://paperwangjinxiang.github.io/hireflow-recruit-system/', { waitUntil: 'networkidle0', timeout: 90000 })
await new Promise((r) => setTimeout(r, 15000))
const count = await page.evaluate(() => {
  const raw = localStorage.getItem('hireflow-state-v2')
  return raw ? JSON.parse(raw).resumes.length : 0
})
console.log(`本地简历数: ${count}`)
await browser.close()
