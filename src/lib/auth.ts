import { useSyncExternalStore } from 'react'
import type { User } from '@/types'

/**
 * 轻量账号体系：密码使用 Web Crypto PBKDF2（SHA-256，100,000 轮，16 字节随机盐）。
 * 存储格式：passwordHash 字段保存完整信封 `pbkdf2:<iterations>:<saltHex>:<hashHex>`，
 * salt 字段冗余保存当前盐（兼容旧代码读取）。
 *
 * 兼容迁移：旧格式（无前缀，passwordHash = SHA-256(`${salt}:${password}`)）仍可验证；
 * 验证成功后调用方应使用 verifyPassword 返回的 upgraded 凭据静默升级入库。
 *
 * 会话仅存 userId。无后端，安全等级有限，生产环境建议接入后端认证服务。
 */

const SESSION_KEY = 'hireflow-session'
/** PBKDF2 迭代次数（OWASP 对 SHA-256 的建议量级） */
export const PBKDF2_ITERATIONS = 100_000
const PBKDF2_PREFIX = 'pbkdf2'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** 旧格式：单轮 SHA-256(`${salt}:${password}`)，hex 输出（仅用于兼容验证历史账号） */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(new Uint8Array(digest))
}

/** PBKDF2-SHA256 派生密码哈希，hex 输出 */
async function pbkdf2Hex(password: string, saltHex: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations },
    keyMaterial,
    256,
  )
  return toHex(new Uint8Array(bits))
}

/** 生成 16 字节随机盐（32 位 hex） */
export function generateSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

/** 用 PBKDF2 生成完整凭据（新密码/重置密码时使用） */
export async function createCredential(password: string): Promise<{ salt: string; passwordHash: string }> {
  const salt = generateSalt()
  const hashHex = await pbkdf2Hex(password, salt, PBKDF2_ITERATIONS)
  return { salt, passwordHash: `${PBKDF2_PREFIX}:${PBKDF2_ITERATIONS}:${salt}:${hashHex}` }
}

export interface VerifyResult {
  ok: boolean
  /** 旧格式验证成功时给出的 PBKDF2 升级凭据（调用方应静默入库） */
  upgraded?: { salt: string; passwordHash: string }
}

/** 验证用户密码；兼容旧单轮 SHA-256 格式，旧格式验证成功时自动生成 PBKDF2 升级凭据 */
export async function verifyPassword(user: Pick<User, 'salt' | 'passwordHash'>, password: string): Promise<VerifyResult> {
  const stored = user.passwordHash ?? ''
  if (stored.startsWith(`${PBKDF2_PREFIX}:`)) {
    // 新格式：pbkdf2:<iterations>:<saltHex>:<hashHex>
    const parts = stored.split(':')
    if (parts.length !== 4) return { ok: false }
    const iterations = Number(parts[1])
    const saltHex = parts[2] || user.salt
    // 迭代次数必须在合理区间：被篡改的数据（如 pbkdf2:999999999:...）直接验证失败，避免卡死登录页
    if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 10_000_000 || !saltHex) {
      return { ok: false }
    }
    const hashHex = await pbkdf2Hex(password, saltHex, iterations)
    return { ok: hashHex === parts[3] }
  }
  // 旧格式：单轮 SHA-256(`${salt}:${password}`)
  const legacyHash = await hashPassword(password, user.salt)
  if (legacyHash !== stored) return { ok: false }
  return { ok: true, upgraded: await createCredential(password) }
}

/** 新密码强度：≥8 位且同时包含字母和数字 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return '密码长度至少 8 位'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码需同时包含字母和数字'
  return null
}

// ---- 会话（响应式：login/logout 后组件自动更新） ----

const listeners = new Set<() => void>()

function emitSessionChange() {
  listeners.forEach((l) => l())
}

export function getSessionUserId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function setSession(userId: string) {
  try {
    localStorage.setItem(SESSION_KEY, userId)
  } catch {
    // 存储不可用时仅内存态失效，刷新后需重新登录
  }
  emitSessionChange()
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
  emitSessionChange()
}

/** 订阅当前会话 userId（无会话为 null） */
export function useSessionUserId(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSessionUserId,
  )
}

/** 根据会话解析当前用户；用户被删除或不再是 active 时返回 null */
export function getSessionUser(users: User[]): User | null {
  const id = getSessionUserId()
  if (!id) return null
  const user = users.find((u) => u.id === id)
  return user && user.status === 'active' ? user : null
}

// ---- 注册校验 ----

export interface RegisterInput {
  name: string
  phone: string
  password: string
  confirm: string
}

/** 校验注册表单，返回错误信息数组（空数组 = 通过） */
export function validateRegister(input: RegisterInput, users: User[]): string[] {
  const errors: string[] = []
  const name = input.name.trim()
  const phone = input.phone.trim()
  if (!name) errors.push('请输入姓名')
  if (!/^1[3-9]\d{9}$/.test(phone)) errors.push('请输入 11 位有效手机号（1 开头，第二位 3-9）')
  const pwdError = validatePasswordStrength(input.password)
  if (pwdError) errors.push(pwdError)
  if (input.password !== input.confirm) errors.push('两次输入的密码不一致')
  if (phone && users.some((u) => u.phone === phone)) errors.push('该手机号已注册，请直接登录')
  return errors
}
