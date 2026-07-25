import { useMemo, useState } from 'react'
import { UserPlus, RotateCcw, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { generateSalt, hashPassword } from '@/lib/auth'
import { ROLE_LABELS, USER_COLORS, USER_STATUS_LABELS, type Role, type User } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

const DEFAULT_PASSWORD = '123456'

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function statusBadgeVariant(status: User['status']) {
  if (status === 'active') return 'border-emerald-300 bg-emerald-50 text-emerald-700'
  if (status === 'pending') return 'border-amber-300 bg-amber-50 text-amber-700'
  return 'border-slate-300 bg-slate-100 text-slate-500'
}

export default function Team() {
  const { users, resumes, currentUser, dispatch } = useStore()
  const isAdmin = currentUser.role === 'admin'
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('hr')
  const [busy, setBusy] = useState(false)
  /** 待审批区：每个待审批用户当前选择的审批角色 */
  const [approveRoles, setApproveRoles] = useState<Record<string, Role>>({})

  const workload = useMemo(() => {
    const map = new Map<string, { total: number; active: number }>()
    users.forEach((u) => map.set(u.id, { total: 0, active: 0 }))
    resumes.forEach((r) => {
      if (!r.assigneeId) return
      const w = map.get(r.assigneeId)
      if (!w) return
      w.total++
      if (!['rejected', 'onboarded', 'offboarded', 'blacklisted'].includes(r.stage)) w.active++
    })
    return map
  }, [users, resumes])

  const unassigned = resumes.filter((r) => !r.assigneeId).length
  const pendingUsers = users.filter((u) => u.status === 'pending')

  const addUser = async () => {
    if (!name.trim()) {
      toast.error('请输入姓名')
      return
    }
    if (phone.trim() && users.some((u) => u.phone === phone.trim())) {
      toast.error('该手机号已被使用')
      return
    }
    setBusy(true)
    try {
      // 管理员直接添加的成员：默认启用，初始密码 123456
      const salt = generateSalt()
      const passwordHash = await hashPassword(DEFAULT_PASSWORD, salt)
      dispatch({
        type: 'register',
        user: {
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || `${phone.trim() || Date.now()}@hireflow.cn`,
          role,
          color: USER_COLORS[users.length % USER_COLORS.length],
          passwordHash,
          salt,
          status: 'active',
        },
      })
      toast.success(`已添加成员 ${name.trim()}，初始密码 ${DEFAULT_PASSWORD}`)
      setName('')
      setPhone('')
      setEmail('')
      setRole('hr')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const approve = (u: User) => {
    const r = approveRoles[u.id] ?? u.role
    dispatch({ type: 'approveUser', userId: u.id, role: r })
    toast.success(`已通过 ${u.name} 的注册申请（${ROLE_LABELS[r]}）`)
  }

  const reject = (u: User) => {
    dispatch({ type: 'rejectUser', userId: u.id })
    toast.success(`已拒绝并删除 ${u.name} 的注册申请`)
  }

  const toggleStatus = (u: User) => {
    if (u.id === currentUser.id) {
      toast.error('不能禁用当前登录账号')
      return
    }
    const next = u.status === 'disabled' ? 'active' : 'disabled'
    dispatch({ type: 'setUserStatus', userId: u.id, status: next })
    toast.success(next === 'disabled' ? `已禁用 ${u.name}，其会话将被强制退出` : `已启用 ${u.name}`)
  }

  const resetPassword = async (u: User) => {
    const salt = generateSalt()
    const passwordHash = await hashPassword(DEFAULT_PASSWORD, salt)
    dispatch({ type: 'resetPassword', userId: u.id, passwordHash, salt })
    toast.success(`已将 ${u.name} 的密码重置为 ${DEFAULT_PASSWORD}`)
  }

  const changeRole = (u: User, r: Role) => {
    if (u.id === currentUser.id && currentUser.role === 'admin' && r !== 'admin') {
      toast.error('管理员不能降级自己的角色')
      return
    }
    dispatch({ type: 'setUserRole', userId: u.id, role: r })
    toast.success(`已将 ${u.name} 的角色调整为「${ROLE_LABELS[r]}」`)
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">团队成员</h1>
          <p className="text-sm text-slate-500">管理协作成员，查看每个人的简历跟进工作量。</p>
        </div>
        <div className="flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline"><RotateCcw className="mr-2 h-4 w-4" />重置演示数据</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>重置全部数据？</AlertDialogTitle>
                <AlertDialogDescription>将清空当前所有简历与改动，恢复为初始演示数据。此操作不可撤销。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => { dispatch({ type: 'resetData' }); toast.success('已重置为演示数据') }}>
                  确认重置
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><UserPlus className="mr-2 h-4 w-4" />添加成员</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>添加团队成员</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label>姓名</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="成员姓名" />
                </div>
                <div className="space-y-1.5">
                  <Label>手机号（登录账号）</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" maxLength={11} placeholder="11 位手机号" />
                </div>
                <div className="space-y-1.5">
                  <Label>邮箱</Label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>角色</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">管理员</SelectItem>
                      <SelectItem value="hr">HR</SelectItem>
                      <SelectItem value="interviewer">面试官</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-slate-400">直接添加的成员立即启用，初始密码为 {DEFAULT_PASSWORD}，请提醒其尽快修改。</p>
                <Button className="w-full" disabled={busy} onClick={addUser}>{busy ? '添加中…' : '确认添加'}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex items-center justify-between py-4">
          <p className="text-sm text-amber-800">
            当前有 <span className="font-bold">{unassigned}</span> 份简历尚未分配负责人，可在简历库中批量勾选后进行分配。
          </p>
          <Badge variant="outline" className="border-amber-300 bg-white text-amber-700">待分配 {unassigned}</Badge>
        </CardContent>
      </Card>

      {/* 待审批（仅管理员可见） */}
      {isAdmin && pendingUsers.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck className="h-5 w-5 text-amber-600" />
              待审批
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">{pendingUsers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingUsers.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-4 py-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback style={{ backgroundColor: u.color, color: '#fff' }}>{u.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{u.name} <span className="ml-1 text-xs text-slate-400">{u.phone}</span></div>
                  <div className="text-xs text-slate-500">申请角色：{ROLE_LABELS[u.role]} · 注册时间：{formatTime(u.createdAt)}</div>
                </div>
                <Select
                  value={approveRoles[u.id] ?? u.role}
                  onValueChange={(v) => setApproveRoles((m) => ({ ...m, [u.id]: v as Role }))}
                >
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">管理员</SelectItem>
                    <SelectItem value="hr">HR</SelectItem>
                    <SelectItem value="interviewer">面试官</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => approve(u)}>通过</Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="text-rose-600 hover:text-rose-700">
                      <UserX className="mr-1 h-4 w-4" />拒绝
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>拒绝注册申请？</AlertDialogTitle>
                      <AlertDialogDescription>将删除 {u.name}（{u.phone}）的注册申请，该操作不可撤销。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => reject(u)}>确认拒绝</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {users.map((u) => {
          const w = workload.get(u.id) ?? { total: 0, active: 0 }
          return (
            <Card key={u.id} className={u.id === currentUser.id ? 'ring-2 ring-indigo-300' : ''}>
              <CardHeader className="flex flex-row items-center gap-3 pb-3">
                <Avatar className="h-11 w-11">
                  <AvatarFallback style={{ backgroundColor: u.color, color: '#fff' }}>{u.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {u.name}
                    {u.id === currentUser.id && <Badge variant="secondary" className="text-xs">当前用户</Badge>}
                  </CardTitle>
                  <p className="truncate text-xs text-slate-500">{u.phone || u.email}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Badge variant="outline">{ROLE_LABELS[u.role]}</Badge>
                  <Badge variant="outline" className={statusBadgeVariant(u.status)}>{USER_STATUS_LABELS[u.status]}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 py-2">
                    <div className="text-xl font-bold">{w.active}</div>
                    <div className="text-xs text-slate-500">跟进中</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-2">
                    <div className="text-xl font-bold">{w.total}</div>
                    <div className="text-xs text-slate-500">累计负责</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 成员管理（仅管理员可见） */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">成员管理</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>注册时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.name}
                      {u.id === currentUser.id && <Badge variant="secondary" className="ml-2 text-xs">我</Badge>}
                    </TableCell>
                    <TableCell>{u.phone || '—'}</TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        onValueChange={(v) => changeRole(u, v as Role)}
                        disabled={u.id === currentUser.id && currentUser.role === 'admin'}
                      >
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">管理员</SelectItem>
                          <SelectItem value="hr">HR</SelectItem>
                          <SelectItem value="interviewer">面试官</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeVariant(u.status)}>{USER_STATUS_LABELS[u.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{formatTime(u.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={u.id === currentUser.id || u.status === 'pending'}
                          onClick={() => toggleStatus(u)}
                        >
                          {u.status === 'disabled' ? '启用' : '禁用'}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline">重置密码</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>重置 {u.name} 的密码？</AlertDialogTitle>
                              <AlertDialogDescription>密码将被重置为 {DEFAULT_PASSWORD}，请转告该成员尽快登录修改。</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction onClick={() => resetPassword(u)}>确认重置</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              轻量账号体系，密码加盐哈希存储；如需更高安全等级建议接入后端服务
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
