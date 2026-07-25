import { toast } from 'sonner'
import type { AttachmentMeta } from '@/types'
import { authHeaders, deriveAttachmentKey } from '@/lib/sync'

/**
 * 简历原始附件云端留存（零知识）：
 * - 文件字节在本机用信封同款密钥（PBKDF2(团队口令, 'hireflow-sync-envelope-v2', 100000) → AES-GCM 256）
 *   加密后才上传，每个文件使用随机 12 字节 IV，IV 以 base64 随候选人 doc 保存；
 * - 服务端（POST/GET/DELETE /api/files）只存密文字节，全部请求带 X-HF-Token；
 * - 任何一步失败都降级为「原件未留存」，绝不阻断解析入库主流程。
 */

const FILES_API = 'https://hireflow-store-api.pages.dev/api/files'
/** 服务端限制：解码后单文件 ≤4MB。密文 = 明文 + 16 字节 GCM tag，明文上限留足余量 */
export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024 - 1024

function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 附件是否可直接在浏览器预览（PDF / 图片） */
export function isPreviewable(meta: Pick<AttachmentMeta, 'mime' | 'name'>): boolean {
  return (
    meta.mime.includes('pdf') ||
    /\.pdf$/i.test(meta.name) ||
    meta.mime.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(meta.name)
  )
}

/**
 * 加密并上传原始附件。成功返回 AttachmentMeta；
 * 超过 4MB / 未设口令 / 网络或加解密失败时 toast 原因并返回 null（不阻断导入）。
 */
export async function uploadAttachment(file: File | Blob, name?: string): Promise<AttachmentMeta | null> {
  const displayName = name ?? (file instanceof File ? file.name : '简历原件')
  if (file.size > ATTACHMENT_MAX_BYTES) {
    toast.warning(`「${displayName}」超过 4MB，已跳过云端原件留存（解析入库不受影响）`)
    return null
  }
  try {
    const key = await deriveAttachmentKey()
    if (!key) {
      toast.warning(`「${displayName}」未设置团队同步口令，无法加密上传，已跳过原件留存`)
      return null
    }
    const plain = new Uint8Array(await file.arrayBuffer())
    const iv = new Uint8Array(12)
    crypto.getRandomValues(iv)
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource)

    const resp = await fetch(FILES_API, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({
        name: displayName,
        mime: file.type || 'application/octet-stream',
        data_b64: bytesToB64(new Uint8Array(cipher)),
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (resp.status !== 201) {
      toast.warning(`「${displayName}」原件留存失败（服务器 ${resp.status}），解析入库不受影响`)
      return null
    }
    const data = (await resp.json()) as { key?: string; ok?: boolean }
    if (!data.ok || typeof data.key !== 'string' || !data.key) {
      toast.warning(`「${displayName}」原件留存失败（响应异常），解析入库不受影响`)
      return null
    }
    return {
      key: data.key,
      name: displayName,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      iv: bytesToB64(iv),
      uploadedAt: Date.now(),
    }
  } catch (e) {
    console.warn('附件加密/上传失败：', e)
    toast.warning(`「${displayName}」原件留存失败（${e instanceof Error ? e.message : '网络异常'}），解析入库不受影响`)
    return null
  }
}

/**
 * 拉取并解密云端附件：fetch（带 X-HF-Token）→ base64 解码 → AES-GCM 解密 → 按 meta.mime 构造 Blob。
 * 失败抛中文错误（口令缺失/不匹配、网络异常、密文损坏）。
 */
export async function fetchAttachment(meta: AttachmentMeta): Promise<Blob> {
  const key = await deriveAttachmentKey()
  if (!key) throw new Error('未设置团队同步口令，无法解密云端原件')
  const resp = await fetch(`${FILES_API}/${encodeURIComponent(meta.key)}`, {
    headers: await authHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
  })
  if (!resp.ok) throw new Error(`原件下载失败（服务器 ${resp.status}）`)
  // GET 返回原始字节（即上传时的密文）
  const cipher = new Uint8Array(await resp.arrayBuffer())
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(meta.iv) as BufferSource },
      key,
      cipher as BufferSource,
    )
  } catch {
    throw new Error('原件解密失败：团队口令不匹配或数据已损坏')
  }
  return new Blob([plain], { type: meta.mime || 'application/octet-stream' })
}

/** 删除云端附件；失败仅警告并返回 false（不影响候选人删除主流程） */
export async function deleteAttachment(meta: AttachmentMeta): Promise<boolean> {
  try {
    const resp = await fetch(`${FILES_API}/${encodeURIComponent(meta.key)}`, {
      method: 'DELETE',
      headers: await authHeaders(),
      signal: AbortSignal.timeout(30_000),
    })
    if (!resp.ok && resp.status !== 404) {
      toast.warning(`云端原件「${meta.name}」删除失败（${resp.status}），候选人操作不受影响`)
      return false
    }
    return true
  } catch (e) {
    console.warn('附件删除失败：', e)
    toast.warning(`云端原件「${meta.name}」删除失败（网络异常），候选人操作不受影响`)
    return false
  }
}
