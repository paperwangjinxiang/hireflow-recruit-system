import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Search, FileUp, Trash2, UserPlus, RefreshCw, Sparkles, List, LayoutGrid, Download, Star, Lock, Contact, GitCompareArrows, Columns3, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { tagColor } from '@/lib/tags'
import { downloadCSV, resumesToCSV } from '@/lib/csv-export'
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
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import ResumeDetail from './ResumeDetail'
import ResumesKanban from './ResumesKanban'
import CompareDialog from '@/components/CompareDialog'
import { deleteResumeFile } from '@/lib/filestore'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

// ---- 表格列定制与排序 ----
type ColKey =
  | 'name' | 'age' | 'certStage' | 'certSubject' | 'gradYear' | 'hometown' | 'university'
  | 'major' | 'experience' | 'tags' | 'stage' | 'job' | 'assignee' | 'createdAt'
type SortKey = 'age' | 'gradYear' | 'experience' | 'createdAt'
type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null

const COLUMNS: { key: ColKey; label: string; sortKey?: SortKey; fixed?: boolean }[] = [
  { key: 'name', label: '姓名', fixed: true },
  { key: 'age', label: '年龄', sortKey: 'age' },
  { key: 'certStage', label: '教资学段' },
  { key: 'certSubject', label: '教资科目' },
  { key: 'gradYear', label: '毕业年份', sortKey: 'gradYear' },
  { key: 'hometown', label: '籍贯' },
  { key: 'university', label: '毕业院校' },
  { key: 'major', label: '专业' },
  { key: 'experience', label: '经验', sortKey: 'experience' },
  { key: 'tags', label: '标签' },
  { key: 'stage', label: '阶段' },
  { key: 'job', label: '锁定岗位' },
  { key: 'assignee', label: '负责人' },
  { key: 'createdAt', label: '导入时间', sortKey: 'createdAt' },
]

const COLS_STORAGE_KEY = 'hireflow-resumes-cols'
const SORT_STORAGE_KEY = 'hireflow-resumes-sort'

/** 读取列显示偏好（localStorage）；非法/缺失时回退为全部显示，姓名列始终固定 */
function loadVisibleCols(): Set<ColKey> {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as ColKey[]
      const valid = new Set(COLUMNS.map((c) => c.key))
      const cols = new Set(arr.filter((k) => valid.has(k)))
      cols.add('name')
      if (cols.size > 1) return cols
    }
  } catch {
    // 存储不可用时使用默认列
  }
  return new Set(COLUMNS.map((c) => c.key))
}

/** 读取排序偏好（localStorage）；非法/缺失时回退为默认顺序 */
function loadSort(): SortState {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as SortState
      if (s && (s.dir === 'asc' || s.dir === 'desc') && COLUMNS.some((c) => c.sortKey === s.key)) return s
    }
  } catch {
    // 存储不可用时使用默认排序
  }
  return null
}

export default function Resumes() {
  const { resumes, users, jobs, currentUser, dispatch } = useStore()
  const [searchParams] = useSearchParams()
  const [pool, setPool] = useState<'pool' | 'mine'>((searchParams.get('pool') as 'pool' | 'mine') ?? 'pool')
  const [keyword, setKeyword] = useState('')
  const [stageFilter, setStageFilter] = useState<string>(searchParams.get('stage') ?? 'all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>(searchParams.get('assignee') ?? 'all')
  const [positionFilter, setPositionFilter] = useState<string>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [view, setView] = useState<'table' | 'kanban'>('table')

  const positions = useMemo(() => [...new Set(resumes.map((r) => r.position))].sort(), [resumes])

  /** 我锁定的简历数量（个人库角标） */
  const myLockedCount = useMemo(
    () => resumes.filter((r) => r.jobId && r.lockedBy === currentUser.id).length,
    [resumes, currentUser.id],
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    // 可调配口径：stage ∈ {imported, screening, rejected} 且未锁定岗位（jobId 为空），
    // 明确排除 matched/interview/offered/onboarded/offboarded/blacklisted
    const deployable = (r: Resume) =>
      !r.jobId && (r.stage === 'imported' || r.stage === 'screening' || r.stage === 'rejected')
    return resumes.filter((r) => {
      // 总简历库只显示可调配简历（明确按阶段筛选时除外，便于从仪表盘下钻查看）；
      // 个人库只显示我锁定的简历
      if (pool === 'pool' && stageFilter === 'all' && !deployable(r)) return false
      if (pool === 'mine' && !(r.jobId && r.lockedBy === currentUser.id)) return false
      if (kw && ![r.name, r.phone, r.email, r.position, r.university, r.company, r.major, r.hometown, r.certSubject, r.certStage, ...r.skills, ...r.tags, ...r.certificates].join(' ').toLowerCase().includes(kw)) return false
      if (stageFilter !== 'all' && r.stage !== stageFilter) return false
      if (assigneeFilter === 'me' && r.assigneeId !== currentUser.id) return false
      if (assigneeFilter === 'unassigned' && r.assigneeId) return false
      if (assigneeFilter !== 'all' && assigneeFilter !== 'me' && assigneeFilter !== 'unassigned' && r.assigneeId !== assigneeFilter) return false
      if (positionFilter !== 'all' && r.position !== positionFilter) return false
      return true
    })
  }, [resumes, keyword, pool, stageFilter, assigneeFilter, positionFilter, currentUser.id])

  // 列显示定制与表头排序（偏好持久化到 localStorage）
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(loadVisibleCols)
  const [sort, setSort] = useState<SortState>(loadSort)

  const toggleCol = (key: ColKey, checked: boolean) => {
    const next = new Set(visibleCols)
    if (checked) next.add(key)
    else next.delete(key)
    next.add('name') // 姓名列固定显示
    setVisibleCols(next)
    try {
      localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...next]))
    } catch {
      // 存储不可用时仅内存内生效
    }
  }

  /** 表头排序：点击循环 升序 → 降序 → 取消 */
  const toggleSort = (key: SortKey) => {
    const next: SortState =
      !sort || sort.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null
    setSort(next)
    try {
      if (next) localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next))
      else localStorage.removeItem(SORT_STORAGE_KEY)
    } catch {
      // 存储不可用时仅内存内生效
    }
  }

  /** 排序后的列表：0 值（年龄/毕业年份未知）始终排最后 */
  const sorted = useMemo(() => {
    if (!sort) return filtered
    return [...filtered].sort((a, b) => {
      const va = a[sort.key]
      const vb = b[sort.key]
      if (va === 0 && vb === 0) return 0
      if (va === 0) return 1
      if (vb === 0) return -1
      return sort.dir === 'asc' ? va - vb : vb - va
    })
  }, [filtered, sort])

  const visibleColumns = useMemo(() => COLUMNS.filter((c) => visibleCols.has(c.key)), [visibleCols])

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
    // 移入「面试不通过」时，锁定中的简历会被 reducer 同步释放回总库
    // 计数口径与 reducer 一致：r.jobId 非空即视为会被释放（reducer 对任何 jobId 非空的简历都释放锁定）
    const lockedCount =
      stage === 'rejected'
        ? resumes.filter((r) => selectedIds.includes(r.id) && r.jobId).length
        : 0
    dispatch({ type: 'updateStage', ids: selectedIds, stage, actorId: currentUser.id })
    toast.success(
      `已将 ${selectedIds.length} 份简历移至「${STAGE_LABELS[stage]}」${lockedCount > 0 ? `，其中 ${lockedCount} 份已锁定简历已同步释放锁定` : ''}`,
    )
    setSelected(new Set())
  }

  /** 批量导出所选简历为 CSV */
  const batchExportSelected = () => {
    const rows = resumes.filter((r) => selectedIds.includes(r.id))
    downloadCSV(`简历导出-所选${rows.length}份-${new Date().toISOString().slice(0, 10)}.csv`, resumesToCSV(rows, users))
    toast.success(`已导出所选 ${rows.length} 份简历`)
  }

  /** 单元格渲染：按列 key 分发（姓名列固定，其余列可在「列设置」中隐藏） */
  const renderCell = (col: ColKey, r: Resume): ReactNode => {
    const assignee = users.find((u) => u.id === r.assigneeId)
    const job = jobs.find((j) => j.id === r.jobId)
    switch (col) {
      case 'name':
        return (
          <>
            <div className="flex items-center gap-1.5 font-medium">
              {r.name}
              {r.rating > 0 && (
                <span className="flex items-center" title={`评分 ${r.rating}/5`}>
                  {Array.from({ length: r.rating }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                  ))}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">{r.phone}</div>
          </>
        )
      case 'age':
        return <span className="text-slate-600">{r.age > 0 ? `${r.age} 岁` : '—'}</span>
      case 'certStage':
        return r.certStage ? (
          <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-200">{r.certStage}</Badge>
        ) : r.certQualified ? (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200" title={r.certNote || '持教师资格考试合格证明'}>合格证明</Badge>
        ) : (
          <span className="text-xs text-slate-400">无证</span>
        )
      case 'certSubject':
        return <span className="text-slate-600">{r.certSubject || '—'}</span>
      case 'gradYear':
        return <span className="text-slate-600">{r.gradYear > 0 ? r.gradYear : '—'}</span>
      case 'hometown':
        return <span className="text-slate-600">{r.hometown || '—'}</span>
      case 'university':
        return (
          <div className="max-w-[160px]">
            <div className="truncate text-slate-700">{r.university || '—'}</div>
            {r.fullTime !== '未知' && (
              <Badge variant="outline" className={`mt-0.5 text-[10px] ${r.fullTime === '全日制' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                {r.fullTime}
              </Badge>
            )}
          </div>
        )
      case 'major':
        return <span className="block max-w-[120px] truncate text-slate-600">{r.major || '—'}</span>
      case 'experience':
        return <span className="text-slate-600">{r.experience} 年</span>
      case 'tags':
        return (
          <div className="flex max-w-[150px] flex-wrap gap-1">
            {r.tags.slice(0, 2).map((t) => (
              <Badge key={t} variant="outline" className={`text-[11px] ${tagColor(t)}`}>{t}</Badge>
            ))}
            {r.tags.length > 2 && <span className="text-[11px] text-slate-400">+{r.tags.length - 2}</span>}
          </div>
        )
      case 'stage':
        return <Badge variant="outline" className={STAGE_COLORS[r.stage]}>{STAGE_LABELS[r.stage]}</Badge>
      case 'job':
        return job ? (
          <span className="flex items-center gap-1 text-xs text-cyan-700">
            <Lock className="h-3 w-3" />{job.school}·{job.level}{job.subject}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )
      case 'assignee':
        return assignee ? (
          <span className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarFallback style={{ backgroundColor: assignee.color, color: '#fff', fontSize: 11 }}>{assignee.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <span className="text-sm">{assignee.name}</span>
          </span>
        ) : (
          <span className="text-sm text-slate-400">未分配</span>
        )
      case 'createdAt':
        return <span className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleDateString('zh-CN')}</span>
    }
  }

  return (
    <div className="space-y-5 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{pool === 'pool' ? '总简历库' : '我的简历库'}</h1>
          <p className="text-sm text-slate-500">
            {pool === 'pool'
              ? `共 ${filtered.length} 份可调配简历（未锁定的导入/筛选/面试不通过简历；已锁定简历在专员的个人库中）`
              : `我锁定的 ${filtered.length} 份简历，面试不通过或放弃入职释放后自动退回总库`}
            {selectedIds.length > 0 && `，已选 ${selectedIds.length} 份`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={pool} onValueChange={(v) => v && setPool(v as 'pool' | 'mine')} variant="outline">
            <ToggleGroupItem value="pool" className="gap-1 px-3"><Contact className="h-4 w-4" />总简历库</ToggleGroupItem>
            <ToggleGroupItem value="mine" className="gap-1 px-3">
              <Lock className="h-4 w-4" />我的简历库{myLockedCount > 0 && <span className="ml-0.5 rounded-full bg-cyan-100 px-1.5 text-[10px] font-semibold text-cyan-700">{myLockedCount}</span>}
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as 'table' | 'kanban')} variant="outline">
            <ToggleGroupItem value="table" aria-label="表格视图"><List className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="kanban" aria-label="看板视图"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" onClick={() => {
            downloadCSV(`简历导出-${new Date().toISOString().slice(0, 10)}.csv`, resumesToCSV(filtered, users))
            toast.success(`已导出 ${filtered.length} 份简历`)
          }}>
            <Download className="mr-2 h-4 w-4" />导出
          </Button>
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
        {view === 'table' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Columns3 className="mr-1 h-3.5 w-3.5" />列设置</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>显示列</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMNS.filter((c) => !c.fixed).map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={visibleCols.has(c.key)}
                  onCheckedChange={(v) => toggleCol(c.key, !!v)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
              {STAGE_ORDER.filter((s) => s !== 'matched').map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="bg-white" onClick={batchExportSelected}>
            <Download className="mr-1 h-3.5 w-3.5" />导出所选
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={selectedIds.length < 2 || selectedIds.length > 4}
            title="勾选 2-4 份简历进行并排对比"
            onClick={() => setCompareOpen(true)}
          >
            <GitCompareArrows className="mr-1 h-3.5 w-3.5" />对比（{selectedIds.length}）
          </Button>
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
      <div className="overflow-x-auto rounded-lg border bg-white">
        <Table className="min-w-[1280px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allChecked} onCheckedChange={(c) => toggleAll(!!c)} />
              </TableHead>
              {visibleColumns.map((col) => (
                <TableHead key={col.key}>
                  {col.sortKey ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-slate-900"
                      onClick={() => toggleSort(col.sortKey as SortKey)}
                      title="点击切换排序（升序 → 降序 → 取消）"
                    >
                      {col.label}
                      {sort?.key === col.sortKey ? (
                        sort.dir === 'asc'
                          ? <ArrowUp className="h-3 w-3 text-indigo-600" />
                          : <ArrowDown className="h-3 w-3 text-indigo-600" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-slate-300" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r: Resume) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(r.id)} onCheckedChange={(c) => toggleOne(r.id, !!c)} />
                </TableCell>
                {visibleColumns.map((col) => (
                  <TableCell key={col.key}>{renderCell(col.key, r)}</TableCell>
                ))}
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 1} className="py-12 text-center text-slate-400">
                  没有符合条件的简历，试试调整筛选条件或<Link to="/import" className="text-indigo-600 hover:underline">批量导入</Link>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      )}

      <ResumeDetail resume={detailResume} open={!!detailResume} onOpenChange={(o) => !o && setDetailId(null)} onSelectResume={setDetailId} />

      <CompareDialog
        resumes={selectedIds.map((id) => resumes.find((r) => r.id === id)).filter((r): r is Resume => !!r)}
        open={compareOpen}
        onOpenChange={setCompareOpen}
        onView={(id) => {
          setCompareOpen(false)
          setDetailId(id)
        }}
      />

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
                // 同步清理本机 IndexedDB 中的简历原件（失败静默忽略）
                selectedIds.forEach((id) => void deleteResumeFile(id))
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
