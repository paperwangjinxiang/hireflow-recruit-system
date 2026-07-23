import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router'
import { StoreProvider } from '@/lib/store'
import Layout from '@/components/Layout'
import Dashboard from '@/pages/Dashboard'
import Resumes from '@/pages/Resumes'
import Jobs from '@/pages/Jobs'
import ImportPage from '@/pages/ImportPage'
import Team from '@/pages/Team'

const AiParse = lazy(() => import('@/pages/AiParse'))

export default function App() {
  return (
    <StoreProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/jobs" element={<Jobs />} />
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
    </StoreProvider>
  )
}
