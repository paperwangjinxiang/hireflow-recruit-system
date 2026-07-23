import { NavLink, Outlet } from 'react-router'
import { LayoutDashboard, Users, FileUp, Contact, ChevronsUpDown, Sparkles } from 'lucide-react'
import { useStore } from '@/lib/store'
import { ROLE_LABELS } from '@/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Toaster } from '@/components/ui/sonner'
import SyncIndicator from '@/components/SyncIndicator'

const NAV = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard, end: true },
  { to: '/resumes', label: '简历库', icon: Contact },
  { to: '/import', label: '批量导入', icon: FileUp },
  { to: '/ai-parse', label: 'AI 解析', icon: Sparkles },
  { to: '/team', label: '团队成员', icon: Users },
]

export default function Layout() {
  const { users, currentUser, dispatch } = useStore()

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-60 flex-col border-r bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">聘</div>
          <div>
            <div className="font-semibold leading-tight">HireFlow</div>
            <div className="text-xs text-slate-500">招聘管理系统</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <SyncIndicator />
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-100">
              <Avatar className="h-9 w-9">
                <AvatarFallback style={{ backgroundColor: currentUser.color, color: '#fff' }}>
                  {currentUser.name.slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{currentUser.name}</div>
                <div className="text-xs text-slate-500">{ROLE_LABELS[currentUser.role]}</div>
              </div>
              <ChevronsUpDown className="h-4 w-4 text-slate-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>切换当前用户（模拟登录）</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {users.map((u) => (
                <DropdownMenuItem
                  key={u.id}
                  onClick={() => dispatch({ type: 'switchUser', userId: u.id })}
                  className="flex items-center gap-2"
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-xs text-white"
                    style={{ backgroundColor: u.color }}
                  >
                    {u.name.slice(0, 1)}
                  </span>
                  <span className="flex-1">{u.name}</span>
                  <span className="text-xs text-slate-400">{ROLE_LABELS[u.role]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      <Toaster position="top-center" richColors />
    </div>
  )
}
