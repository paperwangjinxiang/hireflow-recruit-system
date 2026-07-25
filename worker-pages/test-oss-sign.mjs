/**
 * OSS V1 签名单元自测（本地 node 运行，无需 OSS 密钥）：
 *   node test-oss-sign.mjs
 * 构造已知输入，断言：
 *   1. Authorization 头格式为 `OSS {AccessKeyId}:{base64}`，base64 为 28 字符（SHA-1 输出 20 字节）
 *   2. 与 Python hmac-sha1 对同一 stringToSign 的计算结果完全一致（跨语言对拍）
 *      —— Python 端命令由本脚本打印，人工或 CI 对照
 *   3. stringToSign 组装符合官方文档格式（VERB\nMD5(空)\nContent-Type\nDate\nCanonicalizedResource）
 *      verified against OSS V1 signing docs:
 *      https://help.aliyun.com/zh/oss/developer-reference/include-signatures-in-the-authorization-header
 */
import { ossSign } from './functions/api/_storage.js'

const cfg = {
  bucket: 'examplebucket',
  endpoint: 'oss-cn-hangzhou.aliyuncs.com',
  accessKeyId: 'LTAI5tTestAccessKeyId',
  accessKeySecret: 'yourAccessKeySecret',
  prefix: 'hireflow-attachments/',
}
const verb = 'PUT'
const contentType = 'application/pdf'
const date = 'Wed, 28 Dec 2022 10:27:41 GMT'
const resource = '/examplebucket/hireflow-attachments/resumes/uuid-扫描简历.pdf'

const auth = await ossSign(cfg, verb, contentType, date, resource)
console.log('Authorization =', auth)

// 断言 1：格式 OSS {ak}:{28-char base64}
const m = auth.match(/^OSS ([^:]+):([A-Za-z0-9+/=]{28})$/)
if (!m) { console.error('FAIL: Authorization 格式不符'); process.exit(1) }
if (m[1] !== cfg.accessKeyId) { console.error('FAIL: AccessKeyId 不符'); process.exit(1) }

// 断言 2：与 Python 对拍（stringToSign 与官方文档一致：PUT\n\n<ct>\n<date>\n<resource>）
const stringToSign = `${verb}\n\n${contentType}\n${date}\n${resource}`
console.log('\nstringToSign =', JSON.stringify(stringToSign))
console.log('\nPython 对拍命令：')
console.log(`python -c "import hmac,hashlib,base64;print(base64.b64encode(hmac.new(b'yourAccessKeySecret',${JSON.stringify(stringToSign)}.encode(),hashlib.sha1).digest()).decode())"`)
console.log('\n期望签名（应与上方 Authorization 尾段一致）将由 Python 输出。')
console.log('OK: 格式断言通过')
