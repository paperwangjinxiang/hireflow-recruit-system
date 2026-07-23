import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage()
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)) })
page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(0, 80), r.failure()?.errorText))
page.on('response', (r) => { if (r.url().includes('jsonblob')) console.log('[jsonblob]', r.request().method(), r.status()) })
await page.goto('https://paperwangjinxiang.github.io/hireflow-recruit-system/', { waitUntil: 'networkidle0', timeout: 90000 })
await new Promise((r) => setTimeout(r, 15000))
await browser.close()
