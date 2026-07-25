import { useSyncExternalStore } from 'react'
import type { User } from '@/types'

/**
 * 轻量账号体系：密码加盐哈希（Web Crypto SHA-256）存储于本地/云端 JSON，
 * 会话仅存 userId。无后端，安全等级有限，生产环境建议接入后端认证服务。
 */

const SESSION_KEY = 'hireflow-session'

/** SHA-256(`${salt}:${password}`)，hex 输出 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 生成 16 位 hex 随机盐 */
export function generateSalt(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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
  if (input.password.length < 6) errors.push('密码长度至少 6 位')
  if (input.password !== input.confirm) errors.push('两次输入的密码不一致')
  if (phone && users.some((u) => u.phone === phone)) errors.push('该手机号已注册，请直接登录')
  return errors
}
