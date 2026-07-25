import { useState } from 'react'
import { GraduationCap, KeyRound, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { clearSession, createCredential, useSessionUserId, validatePasswordStrength, verifyPassword } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * 强制改密页：mustChangePassword 用户登录成功后全屏阻断，
 * 必须完成密码修改才能进入系统（种子用户/获批新用户/被重置密码的用户）。
 */
export default function ForceChangePassword() {
  const { users, dispatch } = useStore()
  const sessionId = useSessionUserId()
  // 按会话 ID 解析用户（避免 currentUserId 切换生效前误用旧的 currentUser）
  const currentUser = users.find((u) => u.id === sessionId) ?? users[0]
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const strengthError = validatePasswordStrength(newPwd)
    if (strengthError) {
      toast.error(strengthError)
      return
    }
    if (newPwd !== confirmPwd) {
      toast.error('两次输入的新密码不一致')
      return
    }
    if (newPwd === oldPwd) {
      toast.error('新密码不能与原密码相同')
      return
    }
    setBusy(true)
    try {
      const verified = await verifyPassword(currentUser, oldPwd)
      if (!verified.ok) {
        toast.error('原密码错误')
        return
      }
      const { salt, passwordHash } = await createCredential(newPwd)
      // changePassword 会同时解除 mustChangePassword 标记，随后自动放行进入系统
      dispatch({ type: 'changePassword', userId: currentUser.id, passwordHash, salt })
      toast.success('密码已修改，欢迎使用')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-sky-50 p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
            <GraduationCap className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">HireFlow</h1>
            <p className="text-sm text-slate-500">教师招聘管理系统</p>
          </div>
        </div>

        <Card className="shadow-xl shadow-slate-200/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-5 w-5 text-indigo-600" />
              请设置新密码
            </CardTitle>
            <CardDescription>
              {currentUser.name}，出于账号安全要求，首次登录（或密码被重置）后必须先修改密码才能继续使用。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>原密码</Label>
              <Input
                type="password"
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                placeholder="请输入当前使用的密码"
              />
            </div>
            <div className="space-y-1.5">
              <Label>新密码</Label>
              <Input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="至少 8 位，需包含字母和数字"
              />
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
            <Button className="w-full" disabled={busy} onClick={submit}>
              {busy ? '提交中…' : '确认修改并进入系统'}
            </Button>
            <Button
              variant="ghost"
              className="w-full gap-2 text-slate-500"
              onClick={() => {
                clearSession()
                toast.success('已退出登录')
              }}
            >
              <LogOut className="h-4 w-4" />退出登录
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
