import { lazy, Suspense, useEffect, useRef } from 'react'
import { Routes, Route } from 'react-router'
import { toast } from 'sonner'
import { StoreProvider, useStore } from '@/lib/store'
import { clearSession, useSessionUserId } from '@/lib/auth'
import Layout from '@/components/Layout'
import AuthPage from '@/pages/AuthPage'
import Dashboard from '@/pages/Dashboard'
import Resumes from '@/pages/Resumes'
import Jobs from '@/pages/Jobs'
import ProgressPage from '@/pages/Progress'
import ImportPage from '@/pages/ImportPage'
import Team from '@/pages/Team'
import { Toaster } from '@/components/ui/sonner'

const AiParse = lazy(() => import('@/pages/AiParse'))

/** 会话门禁：无有效登录会话时只渲染登录/注册页 */
function AuthGate() {
  const { users, currentUserId, dispatch } = useStore()
  const sessionId = useSessionUserId()
  const sessionUser = sessionId ? users.find((u) => u.id === sessionId) : undefined
  const kickedRef = useRef<string | null>(null)

  // 会话用户被删除，或状态变为 disabled / pending → 强制退出到登录页
  useEffect(() => {
    if (!sessionId) return
    if (!sessionUser) {
      clearSession()
      return
    }
    if (sessionUser.status !== 'active') {
      clearSession()
      if (kickedRef.current !== sessionUser.id) {
        kickedRef.current = sessionUser.id
        toast.error(sessionUser.status === 'disabled' ? '账号已被禁用，请联系管理员' : '账号待管理员审批，已退出登录')
      }
    }
  }, [sessionId, sessionUser])

  // 让全局 store 的 currentUser 与会话用户保持一致
  useEffect(() => {
    if (sessionUser && sessionUser.status === 'active' && currentUserId !== sessionUser.id) {
      dispatch({ type: 'switchUser', userId: sessionUser.id })
    }
  }, [sessionUser, currentUserId, dispatch])

  if (!sessionUser || sessionUser.status !== 'active') {
    return <AuthPage />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/resumes" element={<Resumes />} />
        <Route path="/import" element={<ImportPage />} />
        <Route
          path="/ai-parse"
          element={
            <Suspense fallback={<div className="p-8 text-slate-500">正在加载 AI 解析引擎…</div>}>
              <AiParse />
            </Suspense>
          }
        />
        <Route path="/team" element={<Team />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <AuthGate />
      <Toaster position="top-center" richColors />
    </StoreProvider>
  )
}
