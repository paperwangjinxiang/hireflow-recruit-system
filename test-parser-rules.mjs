/**
 * 解析规则回归测试（A2/A6/A7/A8）：
 * 先用 esbuild 把真实 src/lib/parser.ts 打包为 ESM，再逐条断言。
 * 运行：node test-parser-rules.mjs
 */
import { build } from 'esbuild'
import fs from 'node:fs'

fs.mkdirSync('.tmp-test', { recursive: true })
await build({
  entryPoints: ['src/lib/parser.ts'],
  bundle: true,
  format: 'esm',
  outfile: '.tmp-test/parser.mjs',
  alias: { '@': './src' },
  logLevel: 'silent',
})
const { parseResumeText } = await import('./.tmp-test/parser.mjs')

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

// ---- A2：身份证 GB11643 校验 ----
console.log('A2 身份证校验码')
const valid = parseResumeText('姓名：张三\n身份证号：11010519491231002X\n电话：13800138000', 'a.pdf')
check('合法身份证（…002X）被采纳', valid.idCard === '11010519491231002X')
check('合法身份证可推性别（第17位为2→女）', valid.gender === '女')
const invalid = parseResumeText('姓名：张三\n身份证号：11010519491231002Y'.replace('Y', '1') + '\n', 'a.pdf')
check('校验码错误的身份证被弃用', invalid.idCard === '')
check('弃用后性别不推断', invalid.gender === '')
check('低置信度含「身份证号校验失败」提醒', invalid.lowConfidence.some((m) => m.includes('身份证号校验失败')))

// ---- A6：非全日制判定收窄 ----
console.log('A6 全日制判定')
const mixed = parseResumeText('姓名：李四\n2010.09-2014.06 XX学院 非全日制大专\n2018.09-2021.06 XX大学 全日制硕士', 'a.pdf')
check('非全日制大专+全日制硕士 → 全日制', mixed.fullTime === '全日制')
const partTime = parseResumeText('姓名：王五\n2015.09-2019.06 XX大学 非全日制本科', 'a.pdf')
check('非全日制本科 → 非全日制', partTime.fullTime === '非全日制')

// ---- A7：多教资证与合格证明 ----
console.log('A7 多教资证/合格证明')
const multi = parseResumeText('姓名：赵六\n持有小学数学教师资格证，后取得高级中学语文教师资格证', 'a.pdf')
check('多证取最高学段（高中）', multi.certStage === '高中')
check('其余证加入提醒', multi.lowConfidence.some((m) => m.includes('第 2 个教师资格证')))
const qualified = parseResumeText('姓名：孙七\n已通过中小学教师资格考试合格证明（高中英语）', 'a.pdf')
check('只有合格证明 → certQualified=true', qualified.certQualified === true)
check('合格证明提醒已标注', qualified.lowConfidence.some((m) => m.includes('合格证明')))
const certNormal = parseResumeText('姓名：周八\n初级中学数学教师资格证', 'a.pdf')
check('正常有证 → certQualified=false', certNormal.certQualified === false && certNormal.certStage === '初中')

// ---- A8：学历/院校误判 ----
console.log('A8 学历/院校')
const postdoc = parseResumeText('姓名：吴九\n2019.09-2022.06 在华东师范大学从事博士后研究\n本科毕业于北京师范大学', 'a.pdf')
check('博士后不算学历（取本科）', postdoc.education === '本科')
const reading = parseResumeText('姓名：郑十\n华南理工大学硕士在读', 'a.pdf')
check('在读硕士不算已获学历', reading.education !== '硕士')
const addr = parseResumeText('姓名：钱一\n住址：广州市中山大学路 88 号\n电话：13800138000', 'a.pdf')
check('「中山大学路」不误判为院校', addr.university === '')
const edu = parseResumeText('姓名：冯二\n2016.09-2020.06 本科毕业于华中师范大学 汉语言文学专业', 'a.pdf')
check('正常院校可识别', edu.university === '华中师范大学')

// ---- A9：相邻多教资证窗口互吞 ----
console.log('A9 相邻多教资证')
const adj1 = parseResumeText('姓名：张三\n小学语文教师资格证、高中数学教师资格证', 'a.pdf')
check('小学语文+高中数学 → 主证高中数学 + 第2证提醒',
  adj1.certStage === '高中' && adj1.certSubject === '数学' && adj1.lowConfidence.some((m) => m.includes('第 2 个教师资格证')))
const adj2 = parseResumeText('姓名：张三\n高中数学教师资格证、小学语文教师资格证', 'a.pdf')
check('高中数学+小学语文 → 主证高中数学 + 第2证提醒',
  adj2.certStage === '高中' && adj2.certSubject === '数学' && adj2.lowConfidence.some((m) => m.includes('第 2 个教师资格证')))

// ---- A10：教资证学段不带偏学历 ----
console.log('A10 教资证学段与学历')
const certEdu = parseResumeText('姓名：李四\n高中数学教师资格证持证者，本科学历', 'a.pdf')
check('「高中数学教师资格证持证者，本科学历」→ 本科', certEdu.education === '本科')

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
fs.rmSync('.tmp-test', { recursive: true, force: true })
process.exit(fail > 0 ? 1 : 0)
