import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useStore } from '@/lib/store'
import {
  STAGE_LABELS, STAGE_ORDER, STAGE_COLORS, SCHOOL_LEVELS, CERT_STAGES, TEACHER_SUBJECTS,
  type Resume, type Stage, type SchoolLevel, type CertStage, type FullTime,
} from '@/types'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Mail, Phone, Briefcase, GraduationCap, Clock, Tag, Star, Building2, School,
  Award, MapPin, CalendarDays, BookOpen, Lock, Unlock, BedDouble, IdCard,
  Gauge, AlertTriangle, Info, OctagonAlert, FileText, ClipboardList, Pencil, ShieldAlert,
  CheckCircle, Sparkles, Loader2, Copy, Upload, Download, Users, Paperclip,
} from 'lucide-react'
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts'
import { tagColor } from '@/lib/tags'
import { scoreColor, scoreLabel, checkCertFit } from '@/lib/match'
import { evaluateResume, GRADE_COLORS, GRADE_LABELS, type EvalAlert } from '@/lib/evaluate'
import { generateCandidateSummary, isSummaryAiReady, polishSummaryWithLlm } from '@/lib/summary'
import { parseExperiences } from '@/lib/timeline'
import { fileStoreSupported, getResumeFile, saveResumeFile, type StoredResumeFile } from '@/lib/filestore'
import { findDuplicates } from '@/lib/dedup'
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

/** 资料编辑表单：数值字段用字符串承载，保存时转换 */
interface EditForm {
  phone: string
  email: string
  position: string
  education: string
  fullTime: FullTime
  age: string
  gradYear: string
  hometown: string
  university: string
  major: string
  experience: string
  company: string
  certStage: CertStage | 'none'
  certSubject: string
  certQualified: boolean
}

function toEditForm(r: Resume): EditForm {
  return {
    phone: r.phone,
    email: r.email,
    position: r.position,
    education: r.education,
    fullTime: r.fullTime,
    age: r.age > 0 ? String(r.age) : '',
    gradYear: r.gradYear > 0 ? String(r.gradYear) : '',
    hometown: r.hometown,
    university: r.university,
    major: r.major,
    experience: r.experience > 0 ? String(r.experience) : '',
    company: r.company,
    certStage: r.certStage || 'none',
    certSubject: r.certSubject,
    certQualified: r.certQualified,
  }
}

const EDUCATION_OPTIONS = ['博士', '硕士', '本科', '大专', '高中', '未知']

export default function ResumeDetail({
  resume,
  open,
  onOpenChange,
  onSelectResume,
}: {
  resume: Resume | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 切换到另一份简历（重复简历/相似候选人点击跳转） */
  onSelectResume?: (resumeId: string) => void
}) {
  const { resumes, users, jobs, currentUser, dispatch } = useStore()
  const [note, setNote] = useState('')
  const [matchLevel, setMatchLevel] = useState<SchoolLevel | 'all'>('all')
  const [matchJobId, setMatchJobId] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState<EditForm | null>(null)
  // 教资硬约束确认弹窗：warn/block 时挂起待锁定的职位
  const [certCheck, setCertCheck] = useState<{ jobId: string; level: 'warn' | 'block'; messages: string[] } | null>(null)
  // AI 润色后的画像（null = 使用规则摘要）
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [polishing, setPolishing] = useState(false)
  // 简历原件（IndexedDB 本机存储）
  const [rawFile, setRawFile] = useState<StoredResumeFile | null>(null)
  const [fileChecked, setFileChecked] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resumeId = resume?.id ?? ''

  // 切换简历时重置画像润色结果与原件
  useEffect(() => {
    setAiSummary(null)
    setPolishing(false)
  }, [resumeId])
  useEffect(() => {
    let alive = true
    setRawFile(null)
    setFileChecked(false)
    if (!resumeId) return
    getResumeFile(resumeId).then((f) => {
      if (alive) {
        setRawFile(f)
        setFileChecked(true)
      }
    })
    return () => {
      alive = false
    }
  }, [resumeId])

  // 原件 blob URL：组件卸载或文件变化时释放
  const fileUrl = useMemo(() => {
    if (!rawFile) return null
    try {
      return URL.createObjectURL(rawFile.blob)
    } catch {
      return null
    }
  }, [rawFile])
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl)
    }
  }, [fileUrl])

  // 经历时间线解析（空原文返回空数组）
  const experiences = useMemo(() => parseExperiences(resume?.rawText ?? ''), [resume?.rawText])

  if (!resume) return null
  const assignee = users.find((u) => u.id === resume.assigneeId)
  const lockedJob = jobs.find((j) => j.id === resume.jobId)
  const locker = users.find((u) => u.id === resume.lockedBy)
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '系统'
  const userColor = (id: string) => users.find((u) => u.id === id)?.color ?? '#94a3b8'

  const openJobs = jobs.filter((j) => j.status === 'open' && (matchLevel === 'all' || j.level === matchLevel))
  const canMatch = !resume.jobId && (resume.stage === 'imported' || resume.stage === 'screening')

  /** 教资硬约束检查后的锁定入口：ok 直接锁定，warn/block 先弹确认 */
  const tryMatchJob = (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return
    const fit = checkCertFit(resume, job)
    if (fit.level === 'ok') {
      doMatchJob(jobId)
    } else {
      setCertCheck({ jobId, level: fit.level, messages: fit.messages })
    }
  }

  const doMatchJob = (jobId: string) => {
    dispatch({ type: 'matchJob', resumeId: resume.id, jobId, actorId: currentUser.id })
    toast.success('已匹配并锁定该岗位')
    setMatchJobId('')
    setCertCheck(null)
  }

  const openEdit = () => {
    setForm(toEditForm(resume))
    setEditOpen(true)
  }

  const saveEdit = () => {
    if (!form) return
    const certStage = form.certStage === 'none' ? '' : form.certStage
    dispatch({
      type: 'updateResumeFields',
      id: resume.id,
      actorId: currentUser.id,
      fields: {
        phone: form.phone.trim(),
        email: form.email.trim(),
        position: form.position.trim(),
        education: form.education,
        fullTime: form.fullTime,
        age: Math.max(0, parseInt(form.age, 10) || 0),
        gradYear: Math.max(0, parseInt(form.gradYear, 10) || 0),
        hometown: form.hometown.trim(),
        university: form.university.trim(),
        major: form.major.trim(),
        experience: Math.max(0, parseInt(form.experience, 10) || 0),
        company: form.company.trim(),
        certStage,
        certSubject: certStage ? form.certSubject : '',
        certQualified: form.certQualified,
      },
    })
    setEditOpen(false)
    toast.success('资料已更新')
  }

  // 综合评估：锁定岗位后按岗位评估
  const evaluation = evaluateResume(resume, lockedJob ?? null)

  // 候选人画像（规则摘要；AI 润色成功时展示润色文本）
  const summary = generateCandidateSummary(resume, lockedJob ?? null)
  const summaryText = aiSummary ?? summary.text

  // 疑似重复简历
  const duplicates = findDuplicates(resume, resumes)

  // 相似候选人（规则打分取前 5，排除自身/黑名单/已入职）
  const similarCandidates = resumes
    .filter((c) => c.id !== resume.id && c.stage !== 'blacklisted' && c.stage !== 'onboarded')
    .map((c) => {
      let score = 0
      if (resume.certSubject && c.certSubject === resume.certSubject) score += 3
      if (resume.certStage && c.certStage === resume.certStage) score += 2
      if (resume.major && c.major === resume.major) score += 2
      if (resume.university && c.university === resume.university) score += 2
      score += c.tags.filter((t) => resume.tags.includes(t)).length
      if (resume.hometown && c.hometown === resume.hometown) score += 1
      return { c, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  /** AI 润色候选人画像；失败回退规则摘要 */
  const polishSummary = async () => {
    setPolishing(true)
    try {
      const text = await polishSummaryWithLlm(resume)
      setAiSummary(text)
      toast.success('AI 润色完成')
    } catch (e) {
      console.warn('AI 润色失败，回退规则摘要：', e)
      setAiSummary(null)
      toast.error('AI 润色失败，已回退到规则摘要')
    } finally {
      setPolishing(false)
    }
  }

  /** 上传简历原件到本机 IndexedDB */
  const handleUploadFile = async (file: File) => {
    const ok = await saveResumeFile(resume.id, file)
    if (ok) {
      const stored = await getResumeFile(resume.id)
      setRawFile(stored ?? { blob: file, name: file.name, type: file.type })
      setFileChecked(true)
      toast.success('原件已保存到本机浏览器')
    } else {
      toast.error('保存失败：当前浏览器不支持本地文件存储（可能处于隐私模式）')
    }
  }

  const rawFileName = rawFile?.name ?? ''
  const rawFileType = rawFile?.type ?? ''
  const isPdfFile = !!rawFile && (rawFileType.includes('pdf') || /\.pdf$/i.test(rawFileName))
  const isImageFile = !!rawFile && (rawFileType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(rawFileName))

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
            {/* 候选人画像（AI 摘要卡） */}
            <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-indigo-600" />候选人画像
                </h3>
                {isSummaryAiReady() && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={polishing} onClick={polishSummary}>
                    {polishing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                    {polishing ? '润色中…' : 'AI 润色'}
                  </Button>
                )}
              </div>
              <p className="text-sm leading-relaxed text-slate-700">{summaryText}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-emerald-600">亮点</div>
                  {summary.highlights.length > 0 ? (
                    <ul className="space-y-1">
                      {summary.highlights.map((h, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />{h}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400">暂无明显亮点</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-rose-600">风险</div>
                  {summary.risks.length > 0 ? (
                    <ul className="space-y-1">
                      {summary.risks.map((r, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />{r}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400">暂无风险提示</p>
                  )}
                </div>
              </div>
            </div>

            {/* 疑似重复简历提示 */}
            {duplicates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <Copy className="h-4 w-4 shrink-0" />
                <span className="font-medium">检测到 {duplicates.length} 份疑似重复简历：</span>
                {duplicates.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onSelectResume?.(d.id)}
                    className={`rounded-full border border-amber-300 bg-white px-2 py-0.5 text-xs ${onSelectResume ? 'hover:bg-amber-100' : 'cursor-default'}`}
                  >
                    {d.name}（{d.source}·{STAGE_LABELS[d.stage]}）
                  </button>
                ))}
              </div>
            )}

            {/* 教师档案 */}
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={openEdit}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />编辑资料
              </Button>
            </div>
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
                {resume.certStage
                  ? `${resume.certStage}${resume.certSubject}教师资格证`
                  : resume.certQualified
                    ? '持教师资格考试合格证明（待认定）'
                    : '暂无教师资格证'}
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
                {/* 七维度评估雷达图（雷达看全貌、下方进度条看数值） */}
                <div className="mt-4 flex justify-center">
                  <RadarChart
                    width={280}
                    height={220}
                    data={evaluation.dimensions.map((d) => ({ dim: d.label, score: d.score }))}
                  >
                    <PolarGrid />
                    <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                  </RadarChart>
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
                        {openJobs.map((j) => {
                          const blocked = checkCertFit(resume, j).level === 'block'
                          return (
                            <SelectItem key={j.id} value={j.id}>
                              {j.school} · {j.level}{j.subject}（{j.region}）{blocked ? ' ⚠ 学段不符' : ''}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    disabled={!matchJobId}
                    onClick={() => tryMatchJob(matchJobId)}
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

            {/* 经历时间线（从简历原文解析） */}
            {experiences.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="flex items-center gap-1.5 font-semibold">
                    <Clock className="h-4 w-4 text-slate-500" />经历时间线
                  </h3>
                  <ol className="space-y-4">
                    {experiences.map((e, i) => (
                      <li key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-white ${
                              e.kind === 'edu' ? 'border-sky-200 text-sky-600' : 'border-emerald-200 text-emerald-600'
                            }`}
                          >
                            {e.kind === 'edu' ? <GraduationCap className="h-3.5 w-3.5" /> : <Briefcase className="h-3.5 w-3.5" />}
                          </span>
                          {i < experiences.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
                        </div>
                        <div className="min-w-0 pb-1">
                          <div className="text-xs font-medium tabular-nums text-slate-400">{e.start} — {e.end}</div>
                          <div className="text-sm font-medium text-slate-700">{e.org}</div>
                          {e.detail && (
                            <div className="truncate text-xs text-slate-500" title={e.detail}>{e.detail}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
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

            {/* 原件预览（IndexedDB 本机存储，不参与云端同步；不支持时整块隐藏） */}
            {fileStoreSupported() && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 font-semibold">
                      <Paperclip className="h-4 w-4 text-slate-500" />原件预览
                    </h3>
                    {rawFile && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-indigo-600" onClick={() => fileInputRef.current?.click()}>
                        更换原件
                      </Button>
                    )}
                  </div>
                  {!fileChecked ? (
                    <p className="text-xs text-slate-400">正在读取本机原件…</p>
                  ) : rawFile && fileUrl ? (
                    <>
                      {isPdfFile ? (
                        <iframe src={fileUrl} className="h-[500px] w-full rounded-lg border bg-white" title={`简历原件 · ${rawFile.name}`} />
                      ) : isImageFile ? (
                        <img src={fileUrl} alt={rawFile.name} className="max-h-[500px] w-auto rounded-lg border" />
                      ) : (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed p-3">
                          <span className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
                            <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="truncate">{rawFile.name}</span>
                          </span>
                          <Button size="sm" variant="outline" asChild>
                            <a href={fileUrl} download={rawFile.name}>
                              <Download className="mr-1.5 h-3.5 w-3.5" />下载原件
                            </a>
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-slate-400">原件仅保存在本机浏览器，不占用云端同步</p>
                    </>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-dashed p-4 text-center">
                      <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="mr-1.5 h-3.5 w-3.5" />上传原件
                      </Button>
                      <p className="text-xs text-slate-400">原件仅保存在本机浏览器，不占用云端同步</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.md,image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleUploadFile(f)
                      e.target.value = ''
                    }}
                  />
                </div>
              </>
            )}

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

            {/* 相似候选人（人才库激活：规则相似度前 5） */}
            {similarCandidates.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="flex items-center gap-1.5 font-semibold">
                    <Users className="h-4 w-4 text-indigo-600" />相似候选人
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {similarCandidates.map(({ c }) => {
                      const ev = evaluateResume(c)
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onSelectResume?.(c.id)}
                          disabled={!onSelectResume}
                          className="space-y-1.5 rounded-lg border p-3 text-left transition-colors enabled:hover:border-indigo-300 enabled:hover:bg-indigo-50/40 disabled:cursor-default"
                        >
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-slate-400">
                            {c.certStage ? `${c.certStage}${c.certSubject}` : c.position || '—'}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${GRADE_COLORS[ev.grade]}`}>
                              {ev.grade} · {ev.overall}
                            </Badge>
                            <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${STAGE_COLORS[c.stage]}`}>
                              {STAGE_LABELS[c.stage]}
                            </Badge>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

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

      {/* 教资硬约束确认弹窗 */}
      <AlertDialog open={!!certCheck} onOpenChange={(o) => !o && setCertCheck(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className={`flex items-center gap-2 ${certCheck?.level === 'block' ? 'text-rose-600' : 'text-amber-600'}`}>
              {certCheck?.level === 'block' ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              {certCheck?.level === 'block' ? '教资学段不满足岗位要求' : '教资信息确认'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className={`space-y-1.5 rounded-md border p-3 text-sm ${certCheck?.level === 'block' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                {certCheck?.messages.map((m, i) => <li key={i}>· {m}</li>)}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            {certCheck?.level === 'warn' && (
              <AlertDialogAction onClick={() => certCheck && doMatchJob(certCheck.jobId)}>
                确认锁定
              </AlertDialogAction>
            )}
            {certCheck?.level === 'block' && currentUser.role === 'admin' && (
              <AlertDialogAction
                className="bg-rose-600 hover:bg-rose-700"
                onClick={() => certCheck && doMatchJob(certCheck.jobId)}
              >
                强制锁定（管理员）
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 资料编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>编辑资料 · {resume.name}</DialogTitle></DialogHeader>
          {form && (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>手机号</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>邮箱</Label>
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>应聘岗位</Label>
                  <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>最近任职单位</Label>
                  <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>学历</Label>
                  <Select value={form.education} onValueChange={(v) => setForm({ ...form, education: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EDUCATION_OPTIONS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>是否全日制</Label>
                  <Select value={form.fullTime} onValueChange={(v) => setForm({ ...form, fullTime: v as FullTime })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="全日制">全日制</SelectItem>
                      <SelectItem value="非全日制">非全日制</SelectItem>
                      <SelectItem value="未知">未知</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>年龄</Label>
                  <Input type="number" min={0} value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="未知留空" />
                </div>
                <div className="space-y-1.5">
                  <Label>毕业年份</Label>
                  <Input type="number" min={0} value={form.gradYear} onChange={(e) => setForm({ ...form, gradYear: e.target.value })} placeholder="未知留空" />
                </div>
                <div className="space-y-1.5">
                  <Label>籍贯</Label>
                  <Input value={form.hometown} onChange={(e) => setForm({ ...form, hometown: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>工作年限</Label>
                  <Input type="number" min={0} value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>毕业院校</Label>
                  <Input value={form.university} onChange={(e) => setForm({ ...form, university: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>专业</Label>
                  <Input value={form.major} onChange={(e) => setForm({ ...form, major: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>教资学段</Label>
                  <Select value={form.certStage} onValueChange={(v) => setForm({ ...form, certStage: v as CertStage | 'none' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未取得证书</SelectItem>
                      {CERT_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>教资科目</Label>
                  <Select
                    value={form.certSubject || 'none'}
                    disabled={form.certStage === 'none'}
                    onValueChange={(v) => setForm({ ...form, certSubject: v === 'none' ? '' : v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未填写</SelectItem>
                      {TEACHER_SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Checkbox
                  checked={form.certQualified}
                  onCheckedChange={(c) => setForm({ ...form, certQualified: !!c })}
                />
                持有教师资格考试合格证明（未取得证书）
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={saveEdit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
