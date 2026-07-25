import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { LayoutDashboard, Users, FileUp, Contact, KeyRound, LogOut, Sparkles, BriefcaseBusiness, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { clearSession, generateSalt, hashPassword } from '@/lib/auth'
import { ROLE_LABELS } from '@/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SyncIndicator from '@/components/SyncIndicator'

const NAV = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard, end: true },
  { to: '/jobs', label: '职位发布', icon: BriefcaseBusiness },
  { to: '/resumes', label: '简历库', icon: Contact },
  { to: '/progress', label: '招聘进展', icon: ClipboardList },
  { to: '/import', label: '批量导入', icon: FileUp },
  { to: '/ai-parse', label: 'AI 解析', icon: Sparkles },
  { to: '/team', label: '团队成员', icon: Users },
]

/** 修改密码对话框 */
function ChangePasswordDialog() {
  const { currentUser, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (newPwd.length < 6) {
      toast.error('新密码长度至少 6 位')
      return
    }
    if (newPwd !== confirmPwd) {
      toast.error('两次输入的新密码不一致')
      return
    }
    setBusy(true)
    try {
      const oldHash = await hashPassword(oldPwd, currentUser.salt)
      if (oldHash !== currentUser.passwordHash) {
        toast.error('原密码错误')
        return
      }
      const salt = generateSalt()
      const passwordHash = await hashPassword(newPwd, salt)
      dispatch({ type: 'changePassword', userId: currentUser.id, passwordHash, salt })
      toast.success('密码已修改，下次登录请使用新密码')
      setOpen(false)
      setOldPwd('')
      setNewPwd('')
      setConfirmPwd('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2">
          <KeyRound className="h-4 w-4" />修改密码
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>修改密码</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>原密码</Label>
            <Input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} placeholder="请输入原密码" />
          </div>
          <div className="space-y-1.5">
            <Label>新密码</Label>
            <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="至少 6 位" />
          </div>
          <div className="space-y-1.5">
            <Label>确认新密码</Label>
            <Input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="再次输入新密码"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <Button className="w-full" disabled={busy} onClick={submit}>{busy ? '提交中…' : '确认修改'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function Layout() {
  const { currentUser } = useStore()

  const logout = () => {
    clearSession()
    toast.success('已退出登录')
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-60 flex-col border-r bg-white">
          <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">师</div>
          <div>
            <div className="font-semibold leading-tight">HireFlow</div>
            <div className="text-xs text-slate-500">教师招聘管理系统</div>
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
        <div className="space-y-3 border-t p-3">
          <SyncIndicator />
          {/* 当前登录用户（只读展示） */}
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-2 py-2">
            <Avatar className="h-9 w-9">
              <AvatarFallback style={{ backgroundColor: currentUser.color, color: '#fff' }}>
                {currentUser.name.slice(0, 1)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{currentUser.name}</div>
              <Badge variant="outline" className="mt-0.5 text-xs">{ROLE_LABELS[currentUser.role]}</Badge>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <ChangePasswordDialog />
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-slate-600 hover:text-rose-600" onClick={logout}>
              <LogOut className="h-4 w-4" />退出登录
            </Button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
