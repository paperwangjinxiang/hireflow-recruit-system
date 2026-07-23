import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  BriefcaseBusiness, Plus, MapPin, School, BedDouble, Users as UsersIcon,
  Lock, Unlock, Trash2, Ban, RotateCcw, Search,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { SCHOOL_LEVELS, TEACHER_SUBJECTS, STAGE_LABELS, STAGE_COLORS, type Job, type Resume, type SchoolLevel } from '@/types'
import { tagColor } from '@/lib/tags'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** 职位发布：片区学校岗位管理 + 简历锁定匹配 */
export default function Jobs() {
  const { jobs, resumes, currentUser, dispatch } = useStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [matchJobId, setMatchJobId] = useState<string | null>(null)
  const [closeJobId, setCloseJobId] = useState<string | null>(null)
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')

  const jobCandidates = (jobId: string) => resumes.filter((r) => r.jobId === jobId)

  const filteredJobs = useMemo(() => {
    const kw = keyword.trim()
    if (!kw) return jobs
    return jobs.filter((j) => j.school.includes(kw) || j.region.includes(kw) || j.subject.includes(kw))
  }, [jobs, keyword])

  const matchJob = jobs.find((j) => j.id === matchJobId) ?? null

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BriefcaseBusiness className="h-6 w-6 text-indigo-600" />职位发布
          </h1>
          <p className="text-sm text-slate-500">发布片区学校教师岗位，并将简历库中的候选人锁定匹配到岗位。</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />发布职位
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" placeholder="搜索学校 / 片区 / 学科…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filteredJobs.map((job) => {
          const locked = jobCandidates(job.id)
          const active = locked.filter((r) => r.stage !== 'rejected' && r.stage !== 'blacklisted')
          return (
            <Card key={job.id} className={job.status === 'closed' ? 'opacity-60' : ''}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <School className="h-4 w-4 text-indigo-500" />{job.school}
                    </CardTitle>
                    <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                      <MapPin className="h-3.5 w-3.5" />{job.region} · {job.level}{job.subject}教师 · 招 {job.headcount} 人
                    </p>
                  </div>
                  <Badge variant="outline" className={job.status === 'open' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}>
                    {job.status === 'open' ? '招聘中' : '已关闭'}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {job.dormitory && (
                    <Badge variant="secondary" className="bg-sky-50 text-sky-700"><BedDouble className="mr-1 h-3 w-3" />提供宿舍</Badge>
                  )}
                  <Badge variant="secondary"><UsersIcon className="mr-1 h-3 w-3" />已锁定 {active.length} 人</Badge>
                  {job.note && <span className="text-xs text-slate-400">{job.note}</span>}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {locked.length > 0 && (
                  <ul className="space-y-1.5">
                    {locked.slice(0, 4).map((r) => (
                      <LockedResumeRow key={r.id} resume={r} />
                    ))}
                    {locked.length > 4 && <li className="text-xs text-slate-400">还有 {locked.length - 4} 人…</li>}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {job.status === 'open' && (
                    <Button size="sm" variant="outline" onClick={() => setMatchJobId(job.id)}>
                      <Lock className="mr-1.5 h-3.5 w-3.5" />匹配简历
                    </Button>
                  )}
                  {job.status === 'open' ? (
                    <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => setCloseJobId(job.id)}>
                      <Ban className="mr-1.5 h-3.5 w-3.5" />关闭
                    </Button>
                  ) : (
                    <Button
                      size="sm" variant="ghost" className="text-emerald-600"
                      onClick={() => {
                        dispatch({ type: 'updateJob', id: job.id, patch: { status: 'open' }, actorId: currentUser.id })
                        toast.success('职位已重新开放')
                      }}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />重新开放
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDeleteJobId(job.id)}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
        {filteredJobs.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed py-16 text-center text-slate-400">
            {jobs.length === 0 ? '还没有发布职位，点击右上角「发布职位」开始' : '没有符合条件的职位'}
          </div>
        )}
      </div>

      <CreateJobDialog open={createOpen} onOpenChange={setCreateOpen} />
      {matchJob && <MatchResumeDialog job={matchJob} onClose={() => setMatchJobId(null)} />}

      <AlertDialog open={!!closeJobId} onOpenChange={(o) => !o && setCloseJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关闭该职位？</AlertDialogTitle>
            <AlertDialogDescription>关闭后，锁定在该职位上的简历将被释放回筛选池。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (closeJobId) {
                  dispatch({ type: 'updateJob', id: closeJobId, patch: { status: 'closed' }, actorId: currentUser.id })
                  toast.success('职位已关闭，相关简历已释放')
                }
              }}
            >
              确认关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteJobId} onOpenChange={(o) => !o && setDeleteJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除该职位？</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复，锁定在该职位上的简历会被解除锁定（保留在简历库中）。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                if (deleteJobId) {
                  dispatch({ type: 'deleteJob', id: deleteJobId })
                  toast.success('职位已删除')
                }
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

function LockedResumeRow({ resume }: { resume: Resume }) {
  const { users, currentUser, dispatch } = useStore()
  const locker = users.find((u) => u.id === resume.lockedBy)
  const released = resume.stage === 'rejected' || resume.stage === 'blacklisted'
  return (
    <li className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span className="font-medium">{resume.name}</span>
        <span className="truncate text-xs text-slate-400">{resume.certStage}{resume.certSubject}教资 · {resume.experience}年</span>
        <Badge variant="outline" className={`text-[10px] ${STAGE_COLORS[resume.stage]}`}>{STAGE_LABELS[resume.stage]}</Badge>
      </span>
      {!released && (
        <button
          className="shrink-0 text-xs text-slate-400 hover:text-rose-500"
          title={`释放简历（锁定人：${locker?.name ?? '—'}）`}
          onClick={() => {
            dispatch({ type: 'releaseResumes', ids: [resume.id], reason: '手动释放', toStage: 'screening', actorId: currentUser.id })
            toast.success(`已释放 ${resume.name} 的简历`)
          }}
        >
          <Unlock className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  )
}

/** 发布职位对话框 */
function CreateJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currentUser, dispatch } = useStore()
  const [region, setRegion] = useState('')
  const [school, setSchool] = useState('')
  const [level, setLevel] = useState<SchoolLevel>('初中')
  const [subject, setSubject] = useState('语文')
  const [dormitory, setDormitory] = useState(false)
  const [headcount, setHeadcount] = useState(1)
  const [note, setNote] = useState('')

  function submit() {
    if (!region.trim() || !school.trim()) {
      toast.error('请填写片区和学校名字')
      return
    }
    dispatch({
      type: 'addJob',
      actorId: currentUser.id,
      job: { region: region.trim(), school: school.trim(), level, subject, dormitory, headcount: Math.max(1, headcount), status: 'open', note: note.trim() },
    })
    toast.success(`已发布「${school.trim()} ${level}${subject}教师」`)
    onOpenChange(false)
    setRegion(''); setSchool(''); setNote(''); setHeadcount(1); setDormitory(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发布教师职位</DialogTitle>
          <DialogDescription>填写片区、学校与岗位信息，发布后即可从简历库锁定匹配候选人。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">片区 *</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="如 东湖高新区" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">学校名字 *</Label>
            <Input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="如 光谷实验中学" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">学段</Label>
            <Select value={level} onValueChange={(v) => setLevel(v as SchoolLevel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SCHOOL_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">学科</Label>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TEACHER_SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">需求人数</Label>
            <Input type="number" min={1} max={50} value={headcount} onChange={(e) => setHeadcount(Number(e.target.value) || 1)} />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Switch checked={dormitory} onCheckedChange={setDormitory} id="dorm" />
            <Label htmlFor="dorm" className="text-sm">提供宿舍</Label>
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">备注</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 需班主任经验 / 可接受应届生…" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit}>发布职位</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 从简历库匹配候选人到职位（锁定） */
function MatchResumeDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const { resumes, currentUser, dispatch } = useStore()
  const [kw, setKw] = useState('')
  const [onlySameLevel, setOnlySameLevel] = useState(true)

  const candidates = useMemo(() => {
    const keyword = kw.trim()
    return resumes
      .filter((r) => (r.stage === 'imported' || r.stage === 'screening') && !r.jobId)
      .filter((r) => !onlySameLevel || r.certStage === job.level)
      .filter((r) => !onlySameLevel || !r.certSubject || r.certSubject === job.subject || job.subject === '')
      .filter((r) => !keyword || r.name.includes(keyword) || r.university.includes(keyword) || r.major.includes(keyword))
      .sort((a, b) => b.rating - a.rating || b.experience - a.experience)
  }, [resumes, kw, onlySameLevel, job])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>匹配简历到「{job.school} · {job.level}{job.subject}」</DialogTitle>
          <DialogDescription>从筛选池中选择候选人进行锁定，锁定后简历将进入「岗位匹配」阶段，其他人不可重复锁定。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="搜索姓名 / 院校 / 专业…" value={kw} onChange={(e) => setKw(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <Switch checked={onlySameLevel} onCheckedChange={setOnlySameLevel} />只看同学段学科
          </label>
        </div>
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {candidates.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  {r.age > 0 && <span className="text-xs text-slate-400">{r.age}岁</span>}
                  <Badge variant="outline" className="text-[10px]">{r.certStage || '无'}{r.certSubject}教资</Badge>
                  {r.rating > 0 && <span className="text-xs text-amber-500">{'★'.repeat(r.rating)}</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {r.university} · {r.major}（{r.fullTime}）· {r.gradYear > 0 ? `${r.gradYear}届` : '届别未知'} · {r.experience}年经验 · {r.hometown || '籍贯未知'}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.tags.slice(0, 4).map((t) => (
                    <Badge key={t} variant="outline" className={`px-1.5 py-0 text-[10px] ${tagColor(t)}`}>{t}</Badge>
                  ))}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  dispatch({ type: 'matchJob', resumeId: r.id, jobId: job.id, actorId: currentUser.id })
                  toast.success(`已将 ${r.name} 锁定到「${job.school}」`)
                }}
              >
                <Lock className="mr-1.5 h-3.5 w-3.5" />锁定
              </Button>
            </li>
          ))}
          {candidates.length === 0 && (
            <li className="rounded-lg border border-dashed py-10 text-center text-sm text-slate-400">
              筛选池中没有符合条件的简历{onlySameLevel && '，试试关闭「只看同学段学科」'}
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
