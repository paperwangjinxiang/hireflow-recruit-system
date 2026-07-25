import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { partialResumeFromIndex } from '@/lib/candidates'
import { STAGE_LABELS, STAGE_ORDER, STAGE_COLORS, TERMINAL_STAGES, type Resume, type Stage } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { MessageSquare, Lock, Star, Loader2 } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { tagColor } from '@/lib/tags'
import { cn } from '@/lib/utils'

/** 活跃流程：进行中阶段（导入/筛选/锁定/面试/录用）；历史归档：终态阶段（不通过/入职/离职/黑名单），口径与 TERMINAL_STAGES 一致 */
const ACTIVE_STAGES: Stage[] = STAGE_ORDER.filter((s) => !TERMINAL_STAGES.includes(s))
const HISTORY_STAGES: Stage[] = TERMINAL_STAGES

type KanbanView = 'active' | 'history' | 'all'

/** 看板卡片（两种模式共用） */
function KanbanCard({
  r,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  r: Resume
  dragging: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onClick: () => void
}) {
  const { users, jobs } = useStore()
  const assignee = users.find((u) => u.id === r.assigneeId)
  const job = jobs.find((j) => j.id === r.jobId)
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(e)
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'group cursor-pointer rounded-lg border bg-white p-3 shadow-sm transition-all hover:border-indigo-300 hover:shadow',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="flex items-center gap-1 font-medium leading-tight">
          {r.name}
          {r.age > 0 && <span className="text-xs font-normal text-slate-400">{r.age}岁</span>}
          {r.rating > 0 && (
            <span className="flex items-center">
              {Array.from({ length: r.rating }).map((_, i) => (
                <Star key={i} className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
              ))}
            </span>
          )}
        </span>
        {job && <Lock className="h-3.5 w-3.5 shrink-0 text-cyan-600" />}
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500">
        {r.certStage || '无'}{r.certSubject}教资 · {r.experience} 年
      </p>
      <p className="truncate text-xs text-slate-400">
        {r.university || '院校未知'}{r.fullTime !== '未知' ? `（${r.fullTime}）` : ''}{r.gradYear > 0 ? ` · ${r.gradYear}届` : ''}
      </p>
      {job && (
        <p className="mt-1 truncate text-[11px] text-cyan-700">{job.school} · {job.level}{job.subject}</p>
      )}
      {r.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {r.tags.slice(0, 2).map((t) => (
            <Badge key={t} variant="outline" className={`px-1.5 py-0 text-[10px] ${tagColor(t)}`}>{t}</Badge>
          ))}
          {r.tags.length > 2 && (
            <span className="text-[10px] text-slate-400">+{r.tags.length - 2}</span>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between border-t pt-2">
        {assignee ? (
          <span className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              <AvatarFallback style={{ backgroundColor: assignee.color, color: '#fff', fontSize: 10 }}>
                {assignee.name.slice(0, 1)}
              </AvatarFallback>
            </Avatar>
            <span className="text-[11px] text-slate-500">{assignee.name}</span>
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">未分配</span>
        )}
        {r.notes.length > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-slate-400">
            <MessageSquare className="h-3 w-3" />{r.notes.length}
          </span>
        )}
      </div>
    </div>
  )
}

/** 看板列外壳（拖放目标 + 列头计数，两种模式共用） */
function KanbanColumn({
  stage,
  count,
  dragOver,
  onDragOverStage,
  onDragLeave,
  onDropStage,
  children,
}: {
  stage: Stage
  count: number
  dragOver: boolean
  onDragOverStage: (stage: Stage) => void
  onDragLeave: () => void
  onDropStage: (stage: Stage) => void
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex min-h-96 w-64 shrink-0 flex-col rounded-lg border bg-slate-100/70 transition-colors',
        dragOver && 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200',
      )}
      onDragOver={(e) => {
        e.preventDefault()
        if (!dragOver) onDragOverStage(stage)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragLeave()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDropStage(stage)
      }}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <Badge variant="outline" className={STAGE_COLORS[stage]}>{STAGE_LABELS[stage]}</Badge>
        <span className="text-xs font-medium text-slate-400">{count}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">{children}</div>
    </div>
  )
}

/** 简历看板：api 模式按阶段懒加载（候选人分表）；legacy 模式使用传入的 resumes */
export default function ResumesKanban({
  resumes,
  owner,
  onCardClick,
}: {
  resumes: Resume[]
  /** api 模式：'none' 表示总库（未锁定），否则为锁定人 userId；legacy 模式忽略 */
  owner?: string
  onCardClick: (id: string) => void
}) {
  const { candidatesMode } = useStore()
  if (candidatesMode === 'api') return <ApiKanban owner={owner ?? 'none'} onCardClick={onCardClick} />
  return <LegacyKanban resumes={resumes} onCardClick={onCardClick} />
}

// =====================================================================
// API 模式：列头计数 stageCounts + 每列懒加载（前 50 条，底部加载更多）
// =====================================================================

interface ColumnState {
  items: Resume[]
  page: number
  loading: boolean
  /** 是否还有更多（服务端 total > 已加载条数） */
  hasMore: boolean
}

const COLUMN_PAGE_SIZE = 50

function ApiKanban({ owner, onCardClick }: { owner: string; onCardClick: (id: string) => void }) {
  const { currentUser, dispatch, candidatesQuery, candidateDetail, stageCounts } = useStore()
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [view, setView] = useState<KanbanView>('active')
  const [counts, setCounts] = useState<Record<Stage, number> | null>(null)
  const [columns, setColumns] = useState<Partial<Record<Stage, ColumnState>>>({})
  const [moving, setMoving] = useState(false)

  const visibleStages: Stage[] =
    view === 'active' ? ACTIVE_STAGES : view === 'history' ? HISTORY_STAGES : STAGE_ORDER

  const refreshCounts = () => {
    stageCounts()
      .then(setCounts)
      .catch(() => {})
  }

  /** 加载某列下一页（append）；page=1 时重置该列 */
  const loadColumn = (stage: Stage, page: number) => {
    setColumns((prev) => ({ ...prev, [stage]: { items: prev[stage]?.items ?? [], page, loading: true, hasMore: prev[stage]?.hasMore ?? true } }))
    candidatesQuery({ stage, owner, page, size: COLUMN_PAGE_SIZE, sort: 'updated_at_desc' })
      .then((res) => {
        const items = res.items.map(partialResumeFromIndex)
        setColumns((prev) => {
          const base = page === 1 ? [] : (prev[stage]?.items ?? [])
          return {
            ...prev,
            [stage]: {
              items: [...base, ...items],
              page,
              loading: false,
              hasMore: base.length + items.length < res.total,
            },
          }
        })
      })
      .catch((e) => {
        setColumns((prev) => ({ ...prev, [stage]: { items: prev[stage]?.items ?? [], page: 0, loading: false, hasMore: false } }))
        toast.error(e instanceof Error ? e.message : '加载看板列失败')
      })
  }

  // 视图/owner 变化：重拉计数并重置可见列
  useEffect(() => {
    refreshCounts()
    setColumns({})
    visibleStages.forEach((s) => loadColumn(s, 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, owner])

  async function handleDrop(stage: Stage) {
    setDragOverStage(null)
    if (!draggingId) return
    const id = draggingId
    setDraggingId(null)
    // 找到拖拽卡片当前所在列
    const fromStage = (Object.keys(columns) as Stage[]).find((s) => columns[s]?.items.some((r) => r.id === id))
    if (fromStage === stage) return
    if (stage === 'matched') {
      toast.error('「岗位匹配」需要选择具体职位锁定，请在详情页或职位发布页操作')
      return
    }
    const card = fromStage ? columns[fromStage]?.items.find((r) => r.id === id) : undefined
    if (moving) return
    setMoving(true)
    try {
      // 拖拽改阶段：先拉完整 doc（编辑必须基于完整记录），再走 dispatch（含释放锁定/活动记录），
      // 由 store 的变更冲刷单条 PUT 回候选人 API（不再整库推送）
      const full = await candidateDetail(id)
      if (full.stage === stage) return
      dispatch({ type: 'updateStage', ids: [id], stage, actorId: currentUser.id })
      toast.success(`已将 ${full.name} 移至「${STAGE_LABELS[stage]}」`)
      // 乐观更新：从源列移除并调整计数；目标列若已加载则插入卡片顶部
      if (fromStage) {
        setColumns((prev) => ({
          ...prev,
          [fromStage]: { ...prev[fromStage]!, items: prev[fromStage]!.items.filter((r) => r.id !== id) },
        }))
      }
      if (columns[stage] && card) {
        setColumns((prev) => ({
          ...prev,
          [stage]: { ...prev[stage]!, items: [{ ...card, stage }, ...prev[stage]!.items] },
        }))
      }
      setCounts((prev) =>
        prev
          ? {
              ...prev,
              ...(fromStage ? { [fromStage]: Math.max(0, prev[fromStage] - 1) } : {}),
              [stage]: prev[stage] + 1,
            }
          : prev,
      )
      // 回写完成后（800ms 合并冲刷）再校准一次服务端计数
      setTimeout(refreshCounts, 2500)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '移动失败')
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as KanbanView)} variant="outline">
          <ToggleGroupItem value="active" className="px-4">活跃流程</ToggleGroupItem>
          <ToggleGroupItem value="history" className="px-4">历史归档</ToggleGroupItem>
          <ToggleGroupItem value="all" className="px-4">全部</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-slate-400">
          {view === 'active' ? '导入 → 筛选 → 匹配 → 面试 → 录用' : view === 'history' ? '面试不通过 / 已入职 / 已离职 / 黑名单（按最近变更倒序）' : '全部九个阶段'}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {visibleStages.map((stage) => {
          const col = columns[stage]
          const isOver = dragOverStage === stage
          return (
            <KanbanColumn
              key={stage}
              stage={stage}
              count={counts?.[stage] ?? col?.items.length ?? 0}
              dragOver={isOver}
              onDragOverStage={setDragOverStage}
              onDragLeave={() => setDragOverStage(null)}
              onDropStage={(s) => void handleDrop(s)}
            >
              {(col?.items ?? []).map((r) => (
                <KanbanCard
                  key={r.id}
                  r={r}
                  dragging={draggingId === r.id}
                  onDragStart={() => setDraggingId(r.id)}
                  onDragEnd={() => {
                    setDraggingId(null)
                    setDragOverStage(null)
                  }}
                  onClick={() => onCardClick(r.id)}
                />
              ))}
              {col?.loading && (
                <div className="py-4 text-center text-xs text-slate-400">
                  <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />加载中…
                </div>
              )}
              {!col?.loading && (col?.items.length ?? 0) === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400">
                  拖拽简历到此处
                </div>
              )}
              {col?.hasMore && !col.loading && (
                <Button variant="ghost" size="sm" className="w-full text-xs text-slate-500" onClick={() => loadColumn(stage, col.page + 1)}>
                  加载更多
                </Button>
              )}
            </KanbanColumn>
          )
        })}
      </div>
    </div>
  )
}

// =====================================================================
// 信封兼容模式（legacy）：传入 resumes 全量渲染，原逻辑保留
// =====================================================================

function LegacyKanban({ resumes, onCardClick }: { resumes: Resume[]; onCardClick: (id: string) => void }) {
  const { currentUser, dispatch } = useStore()
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [view, setView] = useState<KanbanView>('active')

  const visibleStages: Stage[] =
    view === 'active' ? ACTIVE_STAGES : view === 'history' ? HISTORY_STAGES : STAGE_ORDER

  const byStage = (stage: Stage) => {
    const list = resumes.filter((r) => r.stage === stage)
    // 历史归档视图：列内按最近变更时间倒序
    return view === 'history' ? list.sort((a, b) => b.updatedAt - a.updatedAt) : list
  }

  function handleDrop(stage: Stage) {
    setDragOverStage(null)
    if (!draggingId) return
    const resume = resumes.find((r) => r.id === draggingId)
    setDraggingId(null)
    if (!resume || resume.stage === stage) return
    if (stage === 'matched') {
      toast.error('「岗位匹配」需要选择具体职位锁定，请在详情页或职位发布页操作')
      return
    }
    dispatch({ type: 'updateStage', ids: [resume.id], stage, actorId: currentUser.id })
    toast.success(`已将 ${resume.name} 移至「${STAGE_LABELS[stage]}」`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as KanbanView)} variant="outline">
          <ToggleGroupItem value="active" className="px-4">活跃流程</ToggleGroupItem>
          <ToggleGroupItem value="history" className="px-4">历史归档</ToggleGroupItem>
          <ToggleGroupItem value="all" className="px-4">全部</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-slate-400">
          {view === 'active' ? '导入 → 筛选 → 匹配 → 面试 → 录用' : view === 'history' ? '面试不通过 / 已入职 / 已离职 / 黑名单（按最近变更倒序）' : '全部九个阶段'}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3">
      {visibleStages.map((stage) => {
        const list = byStage(stage)
        const isOver = dragOverStage === stage
        return (
          <KanbanColumn
            key={stage}
            stage={stage}
            count={list.length}
            dragOver={isOver}
            onDragOverStage={setDragOverStage}
            onDragLeave={() => setDragOverStage(null)}
            onDropStage={handleDrop}
          >
            {list.map((r) => (
              <KanbanCard
                key={r.id}
                r={r}
                dragging={draggingId === r.id}
                onDragStart={() => setDraggingId(r.id)}
                onDragEnd={() => {
                  setDraggingId(null)
                  setDragOverStage(null)
                }}
                onClick={() => onCardClick(r.id)}
              />
            ))}
            {list.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400">
                拖拽简历到此处
              </div>
            )}
          </KanbanColumn>
        )
      })}
      </div>
    </div>
  )
}
