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
import { Progress } from '@/components/ui/progress'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Mail, Phone, Briefcase, GraduationCap, Clock, Tag, Star, Building2, School,
  Award, MapPin, CalendarDays, BookOpen, Lock, Unlock, BedDouble, IdCard,
  Gauge, AlertTriangle, Info, OctagonAlert, FileText, ClipboardList,
} from 'lucide-react'
import { tagColor } from '@/lib/tags'
import { scoreColor, scoreLabel } from '@/lib/match'
import { evaluateResume, GRADE_COLORS, GRADE_LABELS, type EvalAlert } from '@/lib/evaluate'
import { regionFromIdCard, genderFromIdCard, birthFromIdCard, maskIdCard, isValidIdCard } from '@/lib/regions'
import InterviewSection from './InterviewSection'
import { toast } from 'sonner'

const ALERT_STYLES: Record<EvalAlert['level'], { icon: typeof Info; cls: string }> = {
  danger: { icon: OctagonAlert, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  warning: { icon: AlertTriangle, cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  info: { icon: Info, cls: 'border-sky-200 bg-sky-50 text-sky-700' },
}

/** 解析 WPS 收集表备注：按「key：value」逐行拆分 */
function parseWpsNote(content: string): { key: string; value: string }[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('：')
      if (idx < 0) return { key: '', value: line }
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() }
    })
}

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

  // 综合评估：锁定岗位后按岗位评估
  const evaluation = evaluateResume(resume, lockedJob ?? null)

  // 身份证解析
  const idCardValid = isValidIdCard(resume.idCard)
  const region = idCardValid ? regionFromIdCard(resume.idCard) : null
  const gender = idCardValid ? genderFromIdCard(resume.idCard) : ''
  const birth = idCardValid ? birthFromIdCard(resume.idCard) : ''

  // WPS 收集表原始信息
  const wpsNote =
    resume.source === 'WPS收集表'
      ? resume.notes.find((n) => n.content.includes('WPS 填写ID：'))
      : undefined
  const wpsRows = wpsNote ? parseWpsNote(wpsNote.content) : []

  const timeline = [
    ...resume.activities.map((a) => ({ kind: 'activity' as const, ...a })),
    ...resume.notes.map((n) => ({ kind: 'note' as const, ...n })),
  ].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <span className="text-xl">{resume.name}</span>
            <Badge variant="outline" className={STAGE_COLORS[resume.stage]}>{STAGE_LABELS[resume.stage]}</Badge>
            <Badge variant="outline" className={GRADE_COLORS[evaluation.grade]}>
              {evaluation.grade} · {GRADE_LABELS[evaluation.grade]}
            </Badge>
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

            {/* 身份信息（身份证解析） */}
            {idCardValid && (
              <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <IdCard className="h-3.5 w-3.5" />身份信息（由身份证号识别）
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <div className="text-xs text-slate-400">身份证号</div>
                    <div className="font-mono text-slate-700">{maskIdCard(resume.idCard)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">性别</div>
                    <div className="text-slate-700">{gender || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">出生日期</div>
                    <div className="text-slate-700">{birth || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">户籍地</div>
                    <div className="text-slate-700">{region?.label || resume.hometown || '—'}</div>
                  </div>
                </div>
              </div>
            )}

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

            {/* 综合评估 */}
            <div className="space-y-3">
              <h3 className="flex items-center gap-1.5 font-semibold"><Gauge className="h-4 w-4 text-indigo-600" />综合评估</h3>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-4">
                  <div className="text-4xl font-bold tabular-nums text-slate-800">{evaluation.overall}</div>
                  <div className="space-y-1">
                    <Badge variant="outline" className={`${GRADE_COLORS[evaluation.grade]} text-sm`}>
                      {evaluation.grade} 级 · {GRADE_LABELS[evaluation.grade]}
                    </Badge>
                    <div className="text-xs text-slate-400">
                      {lockedJob ? `按锁定岗位「${lockedJob.school}·${lockedJob.level}${lockedJob.subject}」评估` : '未锁定岗位，按通用标准评估'}
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2.5">
                  {evaluation.dimensions.map((d) => (
                    <div key={d.key} className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-3">
                      <span className="text-xs text-slate-500">
                        {d.label}<span className="ml-0.5 text-slate-300">{d.weight}%</span>
                      </span>
                      <div className="min-w-0">
                        <Progress value={d.score} className="h-2" />
                        <div className="mt-0.5 truncate text-xs text-slate-400" title={d.reason}>{d.reason}</div>
                      </div>
                      <span className="text-right text-xs font-medium tabular-nums text-slate-600">{d.score}</span>
                    </div>
                  ))}
                </div>
                {evaluation.alerts.length > 0 && (
                  <div className="mt-4 space-y-1.5 border-t pt-3">
                    {evaluation.alerts.map((a, i) => {
                      const style = ALERT_STYLES[a.level]
                      const Icon = style.icon
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${style.cls} ${a.level === 'warning' ? 'font-medium' : ''}`}
                        >
                          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {a.text}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

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
                  {evaluation.matchScore !== undefined && (
                    <div className="space-y-1.5 rounded-md bg-white/70 p-2.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500">岗位匹配度</span>
                        <Badge variant="outline" className={scoreColor(evaluation.matchScore)}>
                          {evaluation.matchScore} 分 · {scoreLabel(evaluation.matchScore)}
                        </Badge>
                      </div>
                      <ul className="space-y-0.5 text-xs text-slate-500">
                        {evaluation.matchReasons?.map((r, i) => <li key={i}>· {r}</li>)}
                      </ul>
                    </div>
                  )}
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
                    const ev = evaluateResume(resume, job)
                    return (
                      <div className="space-y-1.5 rounded-md bg-slate-50 p-2.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">岗位匹配度</span>
                          <Badge variant="outline" className={scoreColor(ev.matchScore ?? 0)}>
                            {ev.matchScore} 分 · {scoreLabel(ev.matchScore ?? 0)}
                          </Badge>
                        </div>
                        <ul className="space-y-0.5 text-slate-500">
                          {ev.matchReasons?.map((r, i) => <li key={i}>· {r}</li>)}
                        </ul>
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

            {/* WPS 收集表原始信息 */}
            {wpsNote && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 font-semibold">
                    <ClipboardList className="h-4 w-4 text-teal-600" />收集表原始信息
                  </h3>
                  <dl className="overflow-hidden rounded-lg border">
                    {wpsNote.createdAt > 0 && (
                      <div className="grid grid-cols-[8rem_1fr] border-b bg-slate-50/60 px-3 py-2 text-sm">
                        <dt className="text-slate-400">提交时间</dt>
                        <dd className="text-slate-700">{format(wpsNote.createdAt, 'yyyy-MM-dd HH:mm')}</dd>
                      </div>
                    )}
                    {wpsRows.map((row, i) => (
                      <div key={i} className={`grid grid-cols-[8rem_1fr] px-3 py-2 text-sm ${i < wpsRows.length - 1 ? 'border-b' : ''} ${i % 2 === 0 ? '' : 'bg-slate-50/60'}`}>
                        <dt className="text-slate-400">{row.key || '内容'}</dt>
                        <dd className="break-all text-slate-700">{row.value || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </>
            )}

            {/* 简历原文 */}
            <Separator />
            <Accordion type="single" collapsible>
              <AccordionItem value="rawtext" className="border-none">
                <AccordionTrigger className="py-1 hover:no-underline">
                  <h3 className="flex items-center gap-1.5 font-semibold">
                    <FileText className="h-4 w-4 text-slate-500" />简历原文
                    {resume.rawText && <span className="text-xs font-normal text-slate-400">（{resume.rawText.length} 字符）</span>}
                  </h3>
                </AccordionTrigger>
                <AccordionContent>
                  {resume.rawText ? (
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-600">
                      {resume.rawText}
                    </pre>
                  ) : (
                    <p className="text-sm text-slate-400">暂无简历原文（WPS 收集表来源或未上传文件）</p>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>

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
                        <p className="mt-1 whitespace-pre-wrap rounded-lg bg-amber-50 p-2.5 text-sm text-slate-700">{item.content}</p>
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
