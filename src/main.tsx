import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from '@/components/ErrorBoundary'

// 全局兜底：未处理的 Promise rejection 记录日志（不因未捕获异常静默失败）
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection] 未处理的 Promise 异常：', event.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
