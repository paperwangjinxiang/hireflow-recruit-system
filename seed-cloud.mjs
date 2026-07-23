import puppeteer from 'puppeteer-core'

// 打开线上站点，等待其向云端播种数据
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage()
await page.goto('https://paperwangjinxiang.github.io/hireflow-recruit-system/', { waitUntil: 'networkidle0', timeout: 90000 })
await new Promise((r) => setTimeout(r, 12000))
const status = await page.evaluate(() => document.body.innerText.match(/同步[状态：\s\S]{0,20}|已同步|同步失败/)?.[0] ?? '未知')
const count = await page.evaluate(() => {
  const raw = localStorage.getItem('hireflow-state-v2')
  return raw ? JSON.parse(raw).resumes.length : 0
})
console.log(`本地简历数: ${count}, 同步状态: ${status}`)
await browser.close()
