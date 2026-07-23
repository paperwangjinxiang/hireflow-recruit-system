import { useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { STAGE_LABELS, STAGE_ORDER, STAGE_COLORS, type Resume, type Stage } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { MessageSquare, Lock, Star } from 'lucide-react'
import { tagColor } from '@/lib/tags'
import { cn } from '@/lib/utils'

/** 简历看板：按招聘流程分列（导入→筛选→匹配→面试→录用→不通过→入职→离职→黑名单），拖拽卡片流转阶段 */
export default function ResumesKanban({
  resumes,
  onCardClick,
}: {
  resumes: Resume[]
  onCardClick: (id: string) => void
}) {
  const { users, jobs, currentUser, dispatch } = useStore()
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const byStage = (stage: Stage) => resumes.filter((r) => r.stage === stage)

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
    <div className="flex gap-3 overflow-x-auto pb-3">
      {STAGE_ORDER.map((stage) => {
        const list = byStage(stage)
        const isOver = dragOverStage === stage
        return (
          <div
            key={stage}
            className={cn(
              'flex min-h-96 w-64 shrink-0 flex-col rounded-lg border bg-slate-100/70 transition-colors',
              isOver && 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200',
            )}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragOverStage !== stage) setDragOverStage(stage)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              handleDrop(stage)
            }}
          >
            <div className="flex items-center justify-between px-3 py-2.5">
              <Badge variant="outline" className={STAGE_COLORS[stage]}>{STAGE_LABELS[stage]}</Badge>
              <span className="text-xs font-medium text-slate-400">{list.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {list.map((r) => {
                const assignee = users.find((u) => u.id === r.assigneeId)
                const job = jobs.find((j) => j.id === r.jobId)
                return (
                  <div
                    key={r.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      setDraggingId(r.id)
                    }}
                    onDragEnd={() => {
                      setDraggingId(null)
                      setDragOverStage(null)
                    }}
                    onClick={() => onCardClick(r.id)}
                    className={cn(
                      'group cursor-pointer rounded-lg border bg-white p-3 shadow-sm transition-all hover:border-indigo-300 hover:shadow',
                      draggingId === r.id && 'opacity-40',
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
              })}
              {list.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400">
                  拖拽简历到此处
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
