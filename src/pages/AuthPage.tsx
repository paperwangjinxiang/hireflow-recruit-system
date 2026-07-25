import { useState } from 'react'
import { GraduationCap, LogIn, ShieldCheck, UserRoundPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { generateSalt, hashPassword, setSession, validateRegister } from '@/lib/auth'
import { USER_COLORS, type Role } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ApplyRole = Exclude<Role, 'admin'>

export default function AuthPage() {
  const { users, dispatch } = useStore()
  const [tab, setTab] = useState<'login' | 'register'>('login')

  // 登录表单
  const [loginPhone, setLoginPhone] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)

  // 注册表单
  const [regName, setRegName] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirm, setRegConfirm] = useState('')
  const [regRole, setRegRole] = useState<ApplyRole>('hr')
  const [regErrors, setRegErrors] = useState<string[]>([])
  const [regBusy, setRegBusy] = useState(false)

  const handleLogin = async () => {
    setLoginError('')
    const phone = loginPhone.trim()
    if (!phone || !loginPassword) {
      setLoginError('请输入手机号和密码')
      return
    }
    const user = users.find((u) => u.phone === phone)
    if (!user) {
      setLoginError('账号不存在，请先注册')
      return
    }
    if (user.status === 'pending') {
      setLoginError('账号待管理员审批，通过后即可登录')
      return
    }
    if (user.status === 'disabled') {
      setLoginError('账号已被禁用，请联系管理员')
      return
    }
    setLoginBusy(true)
    try {
      const hash = await hashPassword(loginPassword, user.salt)
      if (hash !== user.passwordHash) {
        setLoginError('密码错误，请重试')
        return
      }
      setSession(user.id)
      toast.success(`欢迎回来，${user.name}`)
    } finally {
      setLoginBusy(false)
    }
  }

  const handleRegister = async () => {
    const errors = validateRegister(
      { name: regName, phone: regPhone, password: regPassword, confirm: regConfirm },
      users,
    )
    setRegErrors(errors)
    if (errors.length) return

    setRegBusy(true)
    try {
      const salt = generateSalt()
      const passwordHash = await hashPassword(regPassword, salt)
      const phone = regPhone.trim()
      // 边界：系统内一个用户都没有时，首个注册用户自动成为 active 的管理员
      const isFirstUser = users.length === 0
      dispatch({
        type: 'register',
        user: {
          name: regName.trim(),
          phone,
          email: `${phone}@hireflow.cn`,
          role: isFirstUser ? 'admin' : regRole,
          color: USER_COLORS[users.length % USER_COLORS.length],
          passwordHash,
          salt,
          status: isFirstUser ? 'active' : 'pending',
        },
      })
      if (isFirstUser) {
        toast.success('首个账号已创建为管理员，请登录')
      } else {
        toast.success('注册成功，待管理员审批后登录')
      }
      setRegName('')
      setRegPhone('')
      setRegPassword('')
      setRegConfirm('')
      setRegRole('hr')
      setRegErrors([])
      setTab('login')
      setLoginPhone(phone)
    } finally {
      setRegBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-sky-50 p-6">
      <div className="w-full max-w-md space-y-6">
        {/* 品牌区 */}
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
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'login' | 'register')}>
            <CardHeader className="pb-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login" className="gap-1.5"><LogIn className="h-4 w-4" />登录</TabsTrigger>
                <TabsTrigger value="register" className="gap-1.5"><UserRoundPlus className="h-4 w-4" />注册</TabsTrigger>
              </TabsList>
            </CardHeader>

            <CardContent>
              <TabsContent value="login" className="mt-0 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="login-phone">手机号</Label>
                  <Input
                    id="login-phone"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="请输入手机号"
                    value={loginPhone}
                    onChange={(e) => setLoginPhone(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login-password">密码</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="请输入密码"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  />
                </div>
                {loginError && <p className="text-sm text-rose-600">{loginError}</p>}
                <Button className="w-full" disabled={loginBusy} onClick={handleLogin}>
                  {loginBusy ? '正在登录…' : '登 录'}
                </Button>
                <div className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                  演示账号：13800000001 / 123456（管理员）
                </div>
              </TabsContent>

              <TabsContent value="register" className="mt-0 space-y-4">
                <CardDescription className="text-xs">
                  注册后需管理员审批通过方可登录；审批时可调整角色。
                </CardDescription>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-name">姓名</Label>
                  <Input id="reg-name" placeholder="真实姓名" value={regName} onChange={(e) => setRegName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-phone">手机号</Label>
                  <Input
                    id="reg-phone"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="将作为登录账号"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-password">密码</Label>
                    <Input
                      id="reg-password"
                      type="password"
                      placeholder="至少 6 位"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-confirm">确认密码</Label>
                    <Input
                      id="reg-confirm"
                      type="password"
                      placeholder="再次输入"
                      value={regConfirm}
                      onChange={(e) => setRegConfirm(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>申请角色</Label>
                  <Select value={regRole} onValueChange={(v) => setRegRole(v as ApplyRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hr">HR 招聘专员</SelectItem>
                      <SelectItem value="interviewer">面试官</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {regErrors.length > 0 && (
                  <ul className="list-inside list-disc space-y-0.5 text-sm text-rose-600">
                    {regErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
                <Button className="w-full" disabled={regBusy} onClick={handleRegister}>
                  {regBusy ? '正在提交…' : '提交注册申请'}
                </Button>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          轻量账号体系，密码加盐哈希存储；如需更高安全等级建议接入后端服务
        </p>
      </div>
    </div>
  )
}
