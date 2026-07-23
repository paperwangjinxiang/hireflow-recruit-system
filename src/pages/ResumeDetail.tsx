import { useState } from 'react'
import { format } from 'date-fns'
import { useStore } from '@/lib/store'
import {
  STAGE_LABELS, STAGE_ORDER, STAGE_COLORS, SCHOOL_LEVELS,
  type Resume, type Stage, type SchoolLevel,
} from '@/types'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Mail, Phone, Briefcase, GraduationCap, Clock, Tag, Star, Building2, School,
  Award, MapPin, CalendarDays, BookOpen, Lock, Unlock, BedDouble,
} from 'lucide-react'
import { tagColor } from '@/lib/tags'
import { computeMatchScore, scoreColor, scoreLabel } from '@/lib/match'
import InterviewSection from './InterviewSection'
import { toast } from 'sonner'

export default function ResumeDetail({
  resume,
  open,
  onOpenChange,
}: {
  resume: Resume | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { users, jobs, currentUser, dispatch } = useStore()
  const [note, setNote] = useState('')
  const [matchLevel, setMatchLevel] = useState<SchoolLevel | 'all'>('all')
  const [matchJobId, setMatchJobId] = useState('')

  if (!resume) return null
  const assignee = users.find((u) => u.id === resume.assigneeId)
  const lockedJob = jobs.find((j) => j.id === resume.jobId)
  const locker = users.find((u) => u.id === resume.lockedBy)
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '系统'
  const userColor = (id: string) => users.find((u) => u.id === id)?.color ?? '#94a3b8'

  const openJobs = jobs.filter((j) => j.status === 'open' && (matchLevel === 'all' || j.level === matchLevel))
  const canMatch = !resume.jobId && (resume.stage === 'imported' || resume.stage === 'screening')

  const timeline = [
    ...resume.activities.map((a) => ({ kind: 'activity' as const, ...a })),
    ...resume.notes.map((n) => ({ kind: 'note' as const, ...n })),
  ].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <span className="text-xl">{resume.name}</span>
            <Badge variant="outline" className={STAGE_COLORS[resume.stage]}>{STAGE_LABELS[resume.stage]}</Badge>
          </SheetTitle>
          <div className="flex items-center gap-1 pt-1" title="候选人综合评分">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  const next = resume.rating === n ? 0 : n
                  dispatch({ type: 'setRating', id: resume.id, rating: next })
                  toast.success(next > 0 ? `已评 ${next} 星` : '已清除评分')
                }}
                className="p-0.5 transition-transform hover:scale-110"
              >
                <Star className={`h-5 w-5 ${n <= resume.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
              </button>
            ))}
            <span className="ml-1 text-xs text-slate-400">{resume.rating > 0 ? `${resume.rating}/5` : '点击评分'}</span>
          </div>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-6rem)] pr-4">
          <div className="mt-4 space-y-6">
            {/* 教师档案 */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-slate-600"><Phone className="h-4 w-4 text-slate-400" />{resume.phone || '—'}</div>
              <div className="flex items-center gap-2 text-slate-600"><Mail className="h-4 w-4 text-slate-400" />{resume.email || '—'}</div>
              <div className="flex items-center gap-2 text-slate-600"><Briefcase className="h-4 w-4 text-slate-400" />{resume.position} · {resume.experience} 年经验</div>
              <div className="flex items-center gap-2 text-slate-600">
                <GraduationCap className="h-4 w-4 text-slate-400" />
                {resume.education}{resume.fullTime !== '未知' ? `（${resume.fullTime}）` : ''}{resume.age > 0 ? ` · ${resume.age} 岁` : ''}
              </div>
              <div className="flex items-center gap-2 text-slate-600"><MapPin className="h-4 w-4 text-slate-400" />籍贯：{resume.hometown || '—'}</div>
              <div className="flex items-center gap-2 text-slate-600"><CalendarDays className="h-4 w-4 text-slate-400" />{resume.gradYear > 0 ? `${resume.gradYear} 年毕业` : '毕业年份未知'}</div>
              <div className="flex items-center gap-2 text-slate-600"><School className="h-4 w-4 text-slate-400" />{resume.university || '院校未知'}</div>
              <div className="flex items-center gap-2 text-slate-600"><BookOpen className="h-4 w-4 text-slate-400" />{resume.major || '专业未知'}</div>
              <div className="flex items-center gap-2 text-slate-600">
                <Award className="h-4 w-4 text-slate-400" />
                {resume.certStage ? `${resume.certStage}${resume.certSubject}教师资格证` : '暂无教师资格证'}
              </div>
              {resume.company && (
                <div className="flex items-center gap-2 text-slate-600"><Building2 className="h-4 w-4 text-slate-400" />最近任职：{resume.company}</div>
              )}
              <div className="flex items-center gap-2 text-slate-600"><Tag className="h-4 w-4 text-slate-400" />来源：{resume.source}</div>
              <div className="flex items-center gap-2 text-slate-600"><Clock className="h-4 w-4 text-slate-400" />{format(resume.createdAt, 'yyyy-MM-dd HH:mm')}</div>
            </div>

            {resume.tags.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-500">智能标签</div>
                <div className="flex flex-wrap gap-1.5">
                  {resume.tags.map((t) => (
                    <Badge key={t} variant="outline" className={tagColor(t)}>{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {resume.certificates.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-xs font-medium text-slate-500"><Award className="h-3.5 w-3.5" />技能证书</div>
                <div className="flex flex-wrap gap-1.5">
                  {resume.certificates.map((c) => (
                    <Badge key={c} variant="secondary" className="bg-amber-50 text-amber-700">{c}</Badge>
                  ))}
                </div>
              </div>
            )}

            {resume.skills.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-500">教学技能</div>
                <div className="flex flex-wrap gap-1.5">
                  {resume.skills.map((s) => (
                    <Badge key={s} variant="secondary">{s}</Badge>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* 岗位锁定 */}
            <div className="space-y-3">
              <h3 className="flex items-center gap-1.5 font-semibold"><Lock className="h-4 w-4 text-cyan-600" />岗位匹配</h3>
              {lockedJob ? (
                <div className="space-y-2 rounded-lg border border-cyan-200 bg-cyan-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium">{lockedJob.school}</span>
                      <span className="text-slate-500"> · {lockedJob.region} · {lockedJob.level}{lockedJob.subject}教师</span>
                    </div>
                    {lockedJob.dormitory && (
                      <Badge variant="secondary" className="bg-sky-50 text-sky-700"><BedDouble className="mr-1 h-3 w-3" />宿舍</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    由 {locker?.name ?? '—'} 于 {resume.lockedAt ? format(resume.lockedAt, 'MM-dd HH:mm') : '—'} 锁定
                  </p>
                  <Button
                    size="sm" variant="outline" className="text-rose-600"
                    onClick={() => {
                      dispatch({ type: 'releaseResumes', ids: [resume.id], reason: '手动释放', toStage: 'screening', actorId: currentUser.id })
                      toast.success('已释放简历回筛选池')
                    }}
                  >
                    <Unlock className="mr-1.5 h-3.5 w-3.5" />释放简历
                  </Button>
                </div>
              ) : canMatch ? (
                <div className="space-y-2 rounded-lg border border-dashed p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={matchLevel} onValueChange={(v) => { setMatchLevel(v as SchoolLevel | 'all'); setMatchJobId('') }}>
                      <SelectTrigger><SelectValue placeholder="学段" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部学段</SelectItem>
                        {SCHOOL_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={matchJobId} onValueChange={setMatchJobId}>
                      <SelectTrigger><SelectValue placeholder="选择职位" /></SelectTrigger>
                      <SelectContent>
                        {openJobs.map((j) => (
                          <SelectItem key={j.id} value={j.id}>{j.school} · {j.level}{j.subject}（{j.region}）</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    disabled={!matchJobId}
                    onClick={() => {
                      dispatch({ type: 'matchJob', resumeId: resume.id, jobId: matchJobId, actorId: currentUser.id })
                      toast.success('已匹配并锁定该岗位')
                      setMatchJobId('')
                    }}
                  >
                    <Lock className="mr-1.5 h-3.5 w-3.5" />匹配并锁定
                  </Button>
                  {matchJobId && (() => {
                    const job = jobs.find((j) => j.id === matchJobId)
                    if (!job) return null
                    const m = computeMatchScore(resume, job)
                    return (
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className={scoreColor(m.score)}>{m.score} 分 · {scoreLabel(m.score)}</Badge>
                        <span className="text-slate-400">{m.reasons.join('；')}</span>
                      </div>
                    )
                  })()}
                  {jobs.filter((j) => j.status === 'open').length === 0 && (
                    <p className="text-xs text-slate-400">暂无开放中的职位，请先到「职位发布」创建。</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400">当前阶段无需锁定岗位。</p>
              )}
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500">负责人</label>
                <Select
                  value={resume.assigneeId ?? 'none'}
                  onValueChange={(v) => {
                    dispatch({ type: 'assign', ids: [resume.id], assigneeId: v === 'none' ? null : v, actorId: currentUser.id })
                    toast.success(v === 'none' ? '已取消分配' : '分配成功')
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未分配</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500">招聘阶段</label>
                <Select
                  value={resume.stage}
                  onValueChange={(v) => {
                    dispatch({ type: 'updateStage', ids: [resume.id], stage: v as Stage, actorId: currentUser.id })
                    toast.success('阶段已更新')
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGE_ORDER.filter((s) => s !== 'matched' || s === resume.stage).map((s) => (
                      <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {assignee && (
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                <Avatar className="h-7 w-7">
                  <AvatarFallback style={{ backgroundColor: assignee.color, color: '#fff' }}>{assignee.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                当前由 <span className="font-medium">{assignee.name}</span> 跟进
              </div>
            )}

            <Separator />

            <InterviewSection resume={resume} />

            <Separator />

            <div className="space-y-3">
              <h3 className="font-semibold">添加备注</h3>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="记录试讲反馈、沟通要点……"
                rows={3}
              />
              <Button
                size="sm"
                disabled={!note.trim()}
                onClick={() => {
                  dispatch({ type: 'addNote', resumeId: resume.id, authorId: currentUser.id, content: note.trim() })
                  setNote('')
                  toast.success('备注已添加')
                }}
              >
                保存备注
              </Button>
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="font-semibold">动态与备注</h3>
              <ul className="space-y-4">
                {timeline.map((item) => {
                  const personId = item.kind === 'note' ? item.authorId : item.actorId
                  return (
                  <li key={item.id} className="flex gap-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback style={{ backgroundColor: userColor(personId), color: '#fff' }}>
                        {userName(personId).slice(0, 1)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">{userName(personId)}</span>
                        <span className="shrink-0 text-xs text-slate-400">{format(item.createdAt, 'MM-dd HH:mm')}</span>
                      </div>
                      {item.kind === 'note' ? (
                        <p className="mt-1 rounded-lg bg-amber-50 p-2.5 text-sm text-slate-700">{item.content}</p>
                      ) : (
                        <p className="mt-0.5 text-sm text-slate-500">{item.action}</p>
                      )}
                    </div>
                  </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
