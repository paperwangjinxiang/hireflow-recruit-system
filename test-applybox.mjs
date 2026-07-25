/**
 * 投递箱加解密往返测试（Node 18+，使用内置 Web Crypto）。
 * 运行方式：
 *   1) npx tsc src/lib/applybox.ts --outDir .test-build --module esnext --target es2020 --moduleResolution bundler --skipLibCheck
 *   2) node test-applybox.mjs
 * 私钥从工作区根目录 apply-keys.txt 运行时读取（该文件绝不提交进 git）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { encryptApplication, decryptApplication } from './.test-build/applybox.js'

const here = dirname(fileURLToPath(import.meta.url))
const keysText = readFileSync(join(here, '..', 'apply-keys.txt'), 'utf-8')
const privateKey = keysText.match(/PRIVATE_PKCS8_BASE64:\s*\n?([A-Za-z0-9+/=]+)/)?.[1]
if (!privateKey) {
  console.error('✗ 未在 apply-keys.txt 中找到 PRIVATE_PKCS8_BASE64')
  process.exit(1)
}

let failed = 0
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) failed++
}

// 1) 加解密往返：模拟投递页提交的完整表单数据
const sample = {
  name: '测试候选人',
  phone: '13812345678',
  email: 'test@example.com',
  idCard: '',
  certStage: '高中',
  certSubject: '语文',
  education: '硕士',
  fullTime: '全日制',
  university: '华中师范大学',
  major: '汉语言文学',
  gradYear: 2015,
  hometown: '湖北武汉',
  experience: 9,
  region: '东湖高新区',
  rawText: '教育经历：华中师范大学 汉语言文学 硕士…',
}
try {
  const envelope = await encryptApplication(JSON.stringify(sample))
  check('信封格式（v=1，ek/iv/data 均为 base64）',
    envelope.v === 1 && /^[A-Za-z0-9+/=]+$/.test(envelope.ek) && /^[A-Za-z0-9+/=]+$/.test(envelope.iv) && /^[A-Za-z0-9+/=]+$/.test(envelope.data))
  const decrypted = await decryptApplication(envelope, privateKey)
  check('加解密往返内容一致', JSON.stringify(decrypted) === JSON.stringify(sample))
} catch (e) {
  check(`加解密往返（异常：${e.message}）`, false)
}

// 2) 错误私钥解密必须失败：现场生成另一对 RSA-OAEP 密钥
try {
  const wrongPair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  )
  const wrongPkcs8 = await crypto.subtle.exportKey('pkcs8', wrongPair.privateKey)
  const wrongB64 = Buffer.from(wrongPkcs8).toString('base64')
  const envelope = await encryptApplication(JSON.stringify(sample))
  let threw = false
  try {
    await decryptApplication(envelope, wrongB64)
  } catch {
    threw = true
  }
  check('错误私钥解密失败', threw)
} catch (e) {
  check(`错误私钥解密失败（异常：${e.message}）`, false)
}

// 3) 乱序私钥（合法 base64 但非 PKCS8）必须抛异常
try {
  const envelope = await encryptApplication(JSON.stringify(sample))
  let threw = false
  try {
    await decryptApplication(envelope, Buffer.from('not-a-real-key').toString('base64'))
  } catch {
    threw = true
  }
  check('非法私钥解密失败', threw)
} catch (e) {
  check(`非法私钥解密失败（异常：${e.message}）`, false)
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
