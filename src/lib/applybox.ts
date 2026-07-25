/**
 * 在线投递箱：候选人通过公开投递页（#/apply）提交简历，
 * 浏览器内用「混合加密」（AES-GCM 256 加密正文 + RSA-OAEP 2048 加密 AES 密钥）
 * 生成密文信封后 append 到独立的 JSONBlob「投递箱」；
 * HR 端用私钥（存主库、随主库 AES 加密同步）解密后入库。
 * 投递箱 blob 中存的全是密文，服务器/存储方无法读取内容。
 */

/** 投递箱 JSONBlob 地址（内容为 JSON 数组） */
export const APPLY_BOX_URL = 'https://jsonblob.com/api/jsonBlob/019f979c-a34c-76f3-b8ee-b0cfa2852a47'

/** 投递公钥（SPKI base64，RSA-OAEP 2048 / SHA-256），私钥由管理员在「批量导入」页配置 */
export const APPLY_PUBLIC_KEY_SPKI_B64 =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4q/hmH3gLZUPZ+/cOgU2XphNGlrvhDZJdTm+DsIQErPv/NUSm+AaOM3mVauzuJT9YfD62EBkjbOfbLQwQ6c3UPjCCV1NGgVThBoLz16JyjiFTa359kmK6BCpcUR5M9/6mRiUJ8eJjC9kQsMW8h5v/AlsBduFXIo2KCXA6XHyWw1I4T4No8Rv1nyqcIfT9Wcteey71Npdgrf1nEsdY9N+2/TwGIs2BRHooJHOAc889fv/qXFlDeV0XiszIl70RGDPvOSwY2s7Kc1MfcmBdmFqbJviF1bbCdQJN7qiO2n/VwVdqzvehAfJJSqz0fq1FBmL0PXHDyBt9xlvsMZZwHV2OQIDAQAB'

/** 投递箱条目上限：JSONBlob 单 blob 写建议 ≤60KB，超过则投递页提示改用电话联系 */
export const APPLY_BOX_MAX_ITEMS = 400

/** 密文信封：v=1 表示混合加密格式 */
export interface ApplyEnvelope {
  v: 1
  /** RSA-OAEP 加密后的 AES 密钥（base64） */
  ek: string
  /** AES-GCM iv（base64） */
  iv: string
  /** AES-GCM 密文（base64） */
  data: string
}

/** 投递箱中的单条投递记录 */
export interface ApplyBoxItem {
  id: string
  submittedAt: number
  jobId: string | null
  jobName: string
  payload: ApplyEnvelope
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64decode(b64: string): Uint8Array {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

/** 导入投递公钥（SPKI → RSA-OAEP/SHA-256） */
async function importPublicKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    b64decode(APPLY_PUBLIC_KEY_SPKI_B64) as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
}

/** 导入投递私钥（PKCS8 base64 → RSA-OAEP/SHA-256） */
async function importPrivateKey(pkcs8B64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    b64decode(pkcs8B64.trim()) as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  )
}

/** 校验私钥是否为可导入的 PKCS8 RSA-OAEP 密钥（管理员保存配置前调用） */
export async function validateApplyPrivateKey(pkcs8B64: string): Promise<boolean> {
  try {
    await importPrivateKey(pkcs8B64)
    return true
  } catch {
    return false
  }
}

/**
 * 加密投递内容：随机 AES-GCM 256 密钥加密 JSON 正文，
 * 再用投递公钥（RSA-OAEP）加密 AES 密钥，输出 base64 信封。
 */
export async function encryptApplication(json: string): Promise<ApplyEnvelope> {
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode(json)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, aesKey, plain)
  const rawKey = await crypto.subtle.exportKey('raw', aesKey)
  const publicKey = await importPublicKey()
  const ek = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey)
  return { v: 1, ek: b64encode(ek), iv: b64encode(iv), data: b64encode(cipher) }
}

/**
 * 解密投递内容：私钥（PKCS8 base64）解出 AES 密钥 → AES-GCM 解密正文 → JSON.parse。
 * 私钥不符或密文损坏时抛异常（调用方标记「密文损坏/密钥不符」并跳过）。
 */
export async function decryptApplication(envelope: ApplyEnvelope, privateKeyPkcs8B64: string): Promise<unknown> {
  const privateKey = await importPrivateKey(privateKeyPkcs8B64)
  const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, b64decode(envelope.ek) as BufferSource)
  const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(envelope.iv) as BufferSource },
    aesKey,
    b64decode(envelope.data) as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plain))
}

/** 读取投递箱数组（blob 不存在 / 非数组时按 [] 处理） */
async function readBox(): Promise<ApplyBoxItem[]> {
  const res = await fetch(APPLY_BOX_URL, { headers: { Accept: 'application/json' } })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`读取投递箱失败（HTTP ${res.status}）`)
  const data = await res.json().catch(() => null)
  return Array.isArray(data) ? (data as ApplyBoxItem[]) : []
}

/** 整体写回投递箱；429 限流时指数退避重试 3 次（1s / 2s / 4s） */
async function writeBox(items: ApplyBoxItem[]): Promise<void> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    try {
      const res = await fetch(APPLY_BOX_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(items),
      })
      if (res.status === 429) {
        lastError = new Error('投递箱服务繁忙（限流），请稍后重试')
        continue
      }
      if (!res.ok) throw new Error(`写入投递箱失败（HTTP ${res.status}）`)
      return
    } catch (e) {
      // 网络错误也按可重试处理（限流分支单独标注文案）
      lastError = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw lastError ?? new Error('写入投递箱失败')
}

/**
 * 提交一条投递：读 → 上限检查 → push → 整体写回。
 * 已知并接受：读-改-写存在并发覆盖风险（两个候选人同一秒提交可能互相覆盖），
 * 公共存储无原子 append，低频投递场景下影响可忽略。
 */
export async function submitApplication(
  envelope: ApplyEnvelope,
  meta: { jobId: string | null; jobName: string },
): Promise<void> {
  const box = await readBox()
  if (box.length >= APPLY_BOX_MAX_ITEMS) {
    throw new Error('投递箱已满，请电话联系 HR')
  }
  box.push({
    id: `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    submittedAt: Date.now(),
    jobId: meta.jobId,
    jobName: meta.jobName,
    payload: envelope,
  })
  await writeBox(box)
}

/** 拉取投递箱全部条目 */
export async function fetchApplications(): Promise<ApplyBoxItem[]> {
  return readBox()
}

/** 按 id 删除投递箱条目（入库成功 / 垃圾删除后调用） */
export async function removeApplications(ids: string[]): Promise<void> {
  const idSet = new Set(ids)
  const box = await readBox()
  const kept = box.filter((it) => !idSet.has(it.id))
  await writeBox(kept)
}
