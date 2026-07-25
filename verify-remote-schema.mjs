/**
 * 真实云端数据校验脚本（对应修复项 ❌1）：
 * 指针文件 → manifestUrl → GET manifest（gzip-b64-chunks）→ 下载全部 parts
 * → base64 + gunzip 还原 JSON → 用 esbuild 打包的真实 remote-schema.ts 跑 validateSharedState。
 * 运行：node verify-remote-schema.mjs
 */
import { build } from 'esbuild'
import zlib from 'node:zlib'
import fs from 'node:fs'

const POINTER_URL = 'https://paperwangjinxiang.github.io/hireflow-recruit-system/sync-config.json'
const API_BASE = 'https://jsonblob.com/api/jsonBlob'

// 1. 打包真实 src/lib/remote-schema.ts 为 ESM
fs.mkdirSync('.tmp-test', { recursive: true })
await build({
  entryPoints: ['src/lib/remote-schema.ts'],
  bundle: true,
  format: 'esm',
  outfile: '.tmp-test/remote-schema.mjs',
  alias: { '@': './src' },
  logLevel: 'silent',
})
const { validateSharedState } = await import('./.tmp-test/remote-schema.mjs')

// 2. 指针 → manifestUrl → manifest
const pointerResp = await fetch(POINTER_URL, { cache: 'no-store' })
if (!pointerResp.ok) throw new Error(`指针文件不可达：HTTP ${pointerResp.status}`)
const pointer = await pointerResp.json()
const manifestUrl = pointer.manifestUrl
console.log(`manifestUrl: ${manifestUrl}`)

const manifestResp = await fetch(manifestUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' })
if (!manifestResp.ok) throw new Error(`manifest 不可达：HTTP ${manifestResp.status}`)
const manifest = await manifestResp.json()
if (manifest?.version !== 2 || !Array.isArray(manifest.parts) || manifest.encoding !== 'gzip-b64-chunks') {
  throw new Error(`manifest 格式不是 gzip-b64-chunks：${JSON.stringify(manifest).slice(0, 200)}`)
}
console.log(`manifest: ${manifest.parts.length} 个分片，updatedAt=${manifest.updatedAt}`)

// 3. 下载全部分片 → base64 + gunzip 还原 JSON
const chunks = []
for (const id of manifest.parts) {
  const resp = await fetch(`${API_BASE}/${id}`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!resp.ok) throw new Error(`分片 ${id} 下载失败：HTTP ${resp.status}`)
  const data = await resp.json()
  if (typeof data !== 'string') throw new Error(`分片 ${id} 内容不是字符串`)
  chunks.push(data)
}
const text = zlib.gunzipSync(Buffer.from(chunks.join(''), 'base64')).toString('utf8')
const parsed = JSON.parse(text)

if (parsed?.v === 2 && parsed?.enc === true) {
  console.log('云端数据已加密（envelope），无口令无法解密，跳过结构校验')
  process.exit(2)
}

const state = parsed
console.log(`还原成功：users=${state.users?.length} resumes=${state.resumes?.length} interviews=${state.interviews?.length} jobs=${state.jobs?.length}`)
for (const u of state.users ?? []) {
  console.log(`  用户 ${u.id}（${u.name}）：字段 = ${Object.keys(u).join(', ')}`)
}

// 4. 跑 validateSharedState
const result = validateSharedState(state)
if (result.ok) {
  console.log('\n校验通过')
} else {
  console.error('\n校验失败：')
  for (const issue of result.issues) console.error(`  - ${issue}`)
  process.exit(1)
}
fs.rmSync('.tmp-test', { recursive: true, force: true })
