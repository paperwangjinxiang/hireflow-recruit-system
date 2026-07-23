import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Search, FileUp, Trash2, UserPlus, RefreshCw, Sparkles, List, LayoutGrid } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { STAGE_LABELS, STAGE_ORDER, STAGE_COLORS, type Resume, type Stage } from '@/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import ResumeDetail from './ResumeDetail'
import ResumesKanban from './ResumesKanban'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export default function Resumes() {
  const { resumes, users, currentUser, dispatch } = useStore()
  const [keyword, setKeyword] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [positionFilter, setPositionFilter] = useState<string>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [view, setView] = useState<'table' | 'kanban'>('table')

  const positions = useMemo(() => [...new Set(resumes.map((r) => r.position))].sort(), [resumes])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return resumes.filter((r) => {
      if (kw && ![r.name, r.phone, r.email, r.position, ...r.skills].join(' ').toLowerCase().includes(kw)) return false
      if (stageFilter !== 'all' && r.stage !== stageFilter) return false
      if (assigneeFilter === 'me' && r.assigneeId !== currentUser.id) return false
      if (assigneeFilter === 'unassigned' && r.assigneeId) return false
      if (assigneeFilter !== 'all' && assigneeFilter !== 'me' && assigneeFilter !== 'unassigned' && r.assigneeId !== assigneeFilter) return false
      if (positionFilter !== 'all' && r.position !== positionFilter) return false
      return true
    })
  }, [resumes, keyword, stageFilter, assigneeFilter, positionFilter, currentUser.id])

  const selectedIds = [...selected].filter((id) => filtered.some((r) => r.id === id))
  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  const detailResume = resumes.find((r) => r.id === detailId) ?? null

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(filtered.map((r) => r.id)) : new Set())
  }
  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const batchAssign = (assigneeId: string | null) => {
    dispatch({ type: 'assign', ids: selectedIds, assigneeId, actorId: currentUser.id })
    toast.success(`已将 ${selectedIds.length} 份简历${assigneeId ? `分配给 ${users.find((u) => u.id === assigneeId)?.name}` : '取消分配'}`)
    setSelected(new Set())
  }

  const batchStage = (stage: Stage) => {
    dispatch({ type: 'updateStage', ids: selectedIds, stage, actorId: currentUser.id })
    toast.success(`已将 ${selectedIds.length} 份简历移至「${STAGE_LABELS[stage]}」`)
    setSelected(new Set())
  }

  return (
    <div className="space-y-5 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">简历库</h1>
          <p className="text-sm text-slate-500">共 {filtered.length} 份简历{selectedIds.length > 0 && `，已选 ${selectedIds.length} 份`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as 'table' | 'kanban')} variant="outline">
            <ToggleGroupItem value="table" aria-label="表格视图"><List className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="kanban" aria-label="看板视图"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" asChild>
            <Link to="/ai-parse"><Sparkles className="mr-2 h-4 w-4" />AI 解析</Link>
          </Button>
          <Button asChild>
            <Link to="/import"><FileUp className="mr-2 h-4 w-4" />批量导入</Link>
          </Button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="搜索姓名 / 职位 / 技能 / 电话" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
        {view === 'table' && (
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="阶段" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部阶段</SelectItem>
              {STAGE_ORDER.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="负责人" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部负责人</SelectItem>
            <SelectItem value="me">分配给我</SelectItem>
            <SelectItem value="unassigned">未分配</SelectItem>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={positionFilter} onValueChange={setPositionFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="职位" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部职位</SelectItem>
            {positions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        {(keyword || stageFilter !== 'all' || assigneeFilter !== 'all' || positionFilter !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => { setKeyword(''); setStageFilter('all'); setAssigneeFilter('all'); setPositionFilter('all') }}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />重置
          </Button>
        )}
      </div>

      {/* 批量操作栏 */}
      {view === 'table' && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5">
          <span className="text-sm font-medium text-indigo-700">已选 {selectedIds.length} 份</span>
          <Select onValueChange={(v) => batchAssign(v === 'none' ? null : v)}>
            <SelectTrigger className="h-8 w-40 bg-white"><SelectValue placeholder={<span className="flex items-center gap-1"><UserPlus className="h-3.5 w-3.5" />分配给…</span>} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">取消分配</SelectItem>
              {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select onValueChange={(v) => batchStage(v as Stage)}>
            <SelectTrigger className="h-8 w-40 bg-white"><SelectValue placeholder="移动到阶段…" /></SelectTrigger>
            <SelectContent>
              {STAGE_ORDER.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />删除
          </Button>
        </div>
      )}

      {/* 看板视图 */}
      {view === 'kanban' && (
        <ResumesKanban resumes={filtered} onCardClick={setDetailId} />
      )}

      {/* 表格视图 */}
      {view === 'table' && (
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allChecked} onCheckedChange={(c) => toggleAll(!!c)} />
              </TableHead>
              <TableHead>候选人</TableHead>
              <TableHead>应聘职位</TableHead>
              <TableHead>经验 / 学历</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>阶段</TableHead>
              <TableHead>负责人</TableHead>
              <TableHead className="text-right">更新时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r: Resume) => {
              const assignee = users.find((u) => u.id === r.assigneeId)
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={(c) => toggleOne(r.id, !!c)} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-slate-400">{r.phone}</div>
                  </TableCell>
                  <TableCell>{r.position}</TableCell>
                  <TableCell className="text-slate-600">{r.experience} 年 · {r.education}</TableCell>
                  <TableCell className="text-slate-600">{r.source}</TableCell>
                  <TableCell><Badge variant="outline" className={STAGE_COLORS[r.stage]}>{STAGE_LABELS[r.stage]}</Badge></TableCell>
                  <TableCell>
                    {assignee ? (
                      <span className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback style={{ backgroundColor: assignee.color, color: '#fff', fontSize: 11 }}>{assignee.name.slice(0, 1)}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{assignee.name}</span>
                      </span>
                    ) : (
                      <span className="text-sm text-slate-400">未分配</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-400">
                    {new Date(r.updatedAt).toLocaleDateString('zh-CN')}
                  </TableCell>
                </TableRow>
              )
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-slate-400">
                  没有符合条件的简历，试试调整筛选条件或<Link to="/import" className="text-indigo-600 hover:underline">批量导入</Link>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      )}

      <ResumeDetail resume={detailResume} open={!!detailResume} onOpenChange={(o) => !o && setDetailId(null)} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除 {selectedIds.length} 份简历？</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复，相关的备注与动态也会一并删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                dispatch({ type: 'deleteResumes', ids: selectedIds })
                toast.success(`已删除 ${selectedIds.length} 份简历`)
                setSelected(new Set())
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
