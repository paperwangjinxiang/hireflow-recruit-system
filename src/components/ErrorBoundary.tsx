import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

/** 「清空本地缓存恢复」需要清除的本应用 localStorage key 前缀 */
const APP_KEY_PREFIXES = ['hireflow-']

function clearAppLocalStorage() {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && APP_KEY_PREFIXES.some((p) => key.startsWith(p))) keys.push(key)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    // 存储本身损坏时尽量清空
    try {
      localStorage.clear()
    } catch {
      // 实在无法清理也继续 reload，由浏览器自行恢复
    }
  }
}

/**
 * 全局渲染兜底：任何组件渲染崩溃时展示友好错误页，
 * 提供「重新加载」与「清空本地缓存恢复」（清除本应用 localStorage 后 reload）两个出口。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // 记录完整错误栈，便于排查（不中断用户）
    console.error('[ErrorBoundary] 渲染崩溃：', error, info.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReset = () => {
    clearAppLocalStorage()
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md space-y-6 rounded-2xl border bg-white p-8 text-center shadow-xl shadow-slate-200/60">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold">页面出现异常</h1>
            <p className="text-sm leading-relaxed text-slate-500">
              应用渲染时发生错误。你的数据保存在本机与云端，通常重新加载即可恢复；
              若反复出现，可清空本地缓存后从云端重新同步。
            </p>
            {this.state.message && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs break-all text-slate-400">{this.state.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <button
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={this.handleReload}
            >
              <RefreshCw className="h-4 w-4" />重新加载
            </button>
            <button
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 px-4 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
              onClick={this.handleReset}
            >
              <Trash2 className="h-4 w-4" />清空本地缓存恢复
            </button>
            <p className="text-xs text-slate-400">清空缓存会移除本机的登录状态与离线数据（云端数据不受影响）</p>
          </div>
        </div>
      </div>
    )
  }
}
