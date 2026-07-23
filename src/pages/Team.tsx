import { useMemo, useState } from 'react'
import { UserPlus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { ROLE_LABELS, type Role } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']

export default function Team() {
  const { users, resumes, currentUser, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('hr')

  const workload = useMemo(() => {
    const map = new Map<string, { total: number; active: number }>()
    users.forEach((u) => map.set(u.id, { total: 0, active: 0 }))
    resumes.forEach((r) => {
      if (!r.assigneeId) return
      const w = map.get(r.assigneeId)
      if (!w) return
      w.total++
      if (r.stage !== 'hired' && r.stage !== 'rejected') w.active++
    })
    return map
  }, [users, resumes])

  const unassigned = resumes.filter((r) => !r.assigneeId).length

  const addUser = () => {
    if (!name.trim()) {
      toast.error('请输入姓名')
      return
    }
    dispatch({
      type: 'addUser',
      user: {
        name: name.trim(),
        email: email.trim() || `${Date.now()}@hireflow.cn`,
        role,
        color: COLORS[users.length % COLORS.length],
      },
    })
    toast.success(`已添加成员 ${name.trim()}`)
    setName('')
    setEmail('')
    setRole('hr')
    setOpen(false)
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
                <Button className="w-full" onClick={addUser}>确认添加</Button>
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
                  <p className="truncate text-xs text-slate-500">{u.email}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge variant="outline">{ROLE_LABELS[u.role]}</Badge>
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
    </div>
  )
}
