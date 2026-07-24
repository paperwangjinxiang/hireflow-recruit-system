/**
 * 生成 src/lib/regions.ts 的离线数据模块。
 * 数据来源：https://github.com/modood/Administrative-divisions-of-China （dist/pca-code.json，省/市/县三级含 6 位行政区划代码）
 *
 * 用法：
 *   node scripts/build-regions.mjs [pca-code.json 本地路径]
 * 不传参数时自动从 GitHub 拉取。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const URL = 'https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/master/dist/pca-code.json'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'src', 'lib', 'regions.ts')

async function loadPca() {
  const localPath = process.argv[2]
  if (localPath) {
    return JSON.parse(await readFile(localPath, 'utf-8'))
  }
  const resp = await fetch(URL)
  if (!resp.ok) throw new Error(`下载失败：HTTP ${resp.status}`)
  return resp.json()
}

const pca = await loadPca()

const prov = {}
const city = {}
const county = {}
for (const p of pca) {
  prov[p.code] = p.name
  for (const c of p.children ?? []) {
    city[c.code] = c.name
    for (const d of c.children ?? []) {
      county[d.code] = d.name
    }
  }
}

// 历史撤并代码别名：旧身份证上仍是撤市设区/撤县设区前的老码，映射到现行名称
const LEGACY_ALIAS = {
  440181: '广东省广州市番禺区', // 原番禺市
  440182: '广东省广州市花都区', // 原花都市
  440183: '广东省广州市增城区', // 原增城市
  440184: '广东省广州市从化区', // 原从化市
  440283: '广东省韶关市南雄市',
  440582: '广东省汕头市潮阳区', // 原潮阳市
  440583: '广东省汕头市澄海区', // 原澄海市
  440681: '广东省佛山市顺德区', // 原顺德市
  440682: '广东省佛山市南海区', // 原南海市
  440683: '广东省佛山市三水区', // 原三水市
  440684: '广东省佛山市高明区', // 原高明市
  441283: '广东省肇庆市高要区', // 原高要市
  441881: '广东省清远市英德市',
  441882: '广东省清远市连州市',
  445281: '广东省揭阳市普宁市',
  445381: '广东省云浮市罗定市',
}

const dump = (obj) =>
  JSON.stringify(obj).replace(/,"/g, ',"')

const ts = `/** 中国行政区划数据（省 2 位 / 市 4 位 / 区县 6 位代码）——由 scripts/build-regions.mjs 自动生成，请勿手改 */
/** 数据来源：modood/Administrative-divisions-of-China dist/pca-code.json；省 ${Object.keys(prov).length} 条，市 ${Object.keys(city).length} 条，区县 ${Object.keys(county).length} 条 */

const PROV: Record<string, string> = ${dump(prov)}
const CITY: Record<string, string> = ${dump(city)}
const COUNTY: Record<string, string> = ${dump(county)}
/** 历史撤并代码 → 现行全称（旧身份证上的老地址码） */
const LEGACY_ALIAS: Record<string, string> = ${dump(LEGACY_ALIAS)}

export interface RegionInfo {
  province: string
  city: string
  county: string
  /** 拼接展示名，如「广东省广州市增城区」 */
  label: string
}

/** 身份证号是否具备基本格式（18 位，末位可为 X） */
export function isValidIdCard(idCard: string): boolean {
  return /^\\d{17}[\\dXx]$/.test(idCard.trim())
}

/** 根据身份证号前 6 位地址码解析户籍地；查不到县时退回省市 */
export function regionFromIdCard(idCard: string): RegionInfo | null {
  const code = idCard.trim().slice(0, 6)
  if (!/^\\d{6}$/.test(code)) return null
  const province = PROV[code.slice(0, 2)]
  if (!province) return null
  const cityName = CITY[code.slice(0, 4)] ?? ''
  const countyName = COUNTY[code] ?? ''
  // 直辖市/省直辖县的中间级叫「市辖区」「县」，展示时跳过
  const cityShown = cityName && !/^(市辖区|县)$/.test(cityName) ? cityName : ''
  const label = province + cityShown + countyName
  if (!countyName && LEGACY_ALIAS[code]) {
    // 撤市设区/撤县设区前的老码：直接使用别名全称
    const alias = LEGACY_ALIAS[code]
    return { province, city: cityShown, county: alias.slice(province.length + cityShown.length), label: alias }
  }
  return { province, city: cityShown, county: countyName, label }
}

/** 第 17 位奇男偶女 */
export function genderFromIdCard(idCard: string): '男' | '女' | '' {
  const id = idCard.trim()
  if (!isValidIdCard(id)) return ''
  return Number(id[16]) % 2 === 1 ? '男' : '女'
}

/** 出生日期 YYYY-MM-DD；校验日期有效性，无效返回 '' */
export function birthFromIdCard(idCard: string): string {
  const id = idCard.trim()
  if (!isValidIdCard(id)) return ''
  const y = Number(id.slice(6, 10))
  const m = Number(id.slice(10, 12))
  const d = Number(id.slice(12, 14))
  if (y < 1900 || y > new Date().getFullYear() || m < 1 || m > 12 || d < 1 || d > 31) return ''
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return ''
  return \`\${y}-\${String(m).padStart(2, '0')}-\${String(d).padStart(2, '0')}\`
}

/** 按出生日期计算周岁；无效身份证返回 0 */
export function ageFromIdCard(idCard: string): number {
  const birth = birthFromIdCard(idCard)
  if (!birth) return 0
  const [y, m, d] = birth.split('-').map(Number)
  const now = new Date()
  let age = now.getFullYear() - y
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--
  return age > 0 && age <= 120 ? age : 0
}

/** 身份证号脱敏：前 6 后 4，中间星号 */
export function maskIdCard(idCard: string): string {
  const id = idCard.trim()
  if (!isValidIdCard(id)) return id
  return id.slice(0, 6) + '********' + id.slice(-4)
}
`

await writeFile(OUT, ts, 'utf-8')
console.log(`regions.ts 已生成：省 ${Object.keys(prov).length}，市 ${Object.keys(city).length}，区县 ${Object.keys(county).length}`)
console.log('验证 440183 →', prov['44'], city['4401'], county['440183'])
