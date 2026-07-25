import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import {
  INTERVIEW_TYPES,
  STAGE_LABELS,
  type InterviewType,
  type Resume,
} from '@/types'
import { findConflicts, interviewerIdsOf } from '@/lib/interview-utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 从候选人详情进入时预置候选人；不传则在对话框内选择 */
  resume?: Resume
}

/** 安排面试对话框：类型 / 时间 / 地点 / 多面试官 / 关联岗位 / 备注，含 1 小时冲突黄色警告 */
export default function InterviewScheduleDialog({ open, onOpenChange, resume }: Props) {
  const { users, resumes, interviews, jobs, currentUser, dispatch } = useStore()

  const eligible = useMemo(
    () => users.filter((u) => u.status === 'active' && (u.role === 'interviewer' || u.role === 'hr' || u.role === 'admin')),
    [users],
  )
  const candidates = useMemo(
    () =>
      resumes.filter((r) =>
        ['imported', 'screening', 'matched', 'interview'].includes(r.stage),
      ),
    [resumes],
  )

  const [resumeId, setResumeId] = useState('')
  const [type, setType] = useState<InterviewType>('试讲')
  const [time, setTime] = useState('')
  const [location, setLocation] = useState('')
  const [interviewerIds, setInterviewerIds] = useState<string[]>([])
  const [jobId, setJobId] = useState<string>('none')
  const [note, setNote] = useState('')

  const targetResume = resume ?? resumes.find((r) => r.id === resumeId)
  // 打开对话框 / 切换候选人时，关联岗位默认带出候选人锁定岗位
  useEffect(() => {
    if (open) setJobId(targetResume?.jobId ?? 'none')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetResume?.jobId])

  const conflicts = useMemo(
    () => findConflicts(interviews, time ? new Date(time).getTime() : 0, interviewerIds),
    [interviews, time, interviewerIds],
  )

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'
  const resumeName = (id: string) =>
    resumes.find((r) => r.id === id)?.name ?? interviews.find((x) => x.resumeId === id)?.candidateName ?? '候选人'

  function reset() {
    setResumeId('')
    setType('试讲')
    setTime('')
    setLocation('')
    setInterviewerIds([])
    setJobId('none')
    setNote('')
  }

  function toggleInterviewer(id: string) {
    setInterviewerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function submit() {
    if (!targetResume) {
      toast.error('请选择候选人')
      return
    }
    if (!time) {
      toast.error('请选择面试时间')
      return
    }
    if (interviewerIds.length === 0) {
      toast.error('请至少选择一位面试官')
      return
    }
    const ts = new Date(time).getTime()
    dispatch({
      type: 'addInterview',
      actorId: currentUser.id,
      interview: {
        resumeId: targetResume.id,
        round: type,
        type,
        time: ts,
        interviewerId: interviewerIds[0],
        interviewerIds,
        location: location.trim() || '待定',
        jobId: jobId === 'none' ? null : jobId,
        candidateName: targetResume.name,
        note: note.trim(),
        status: 'pending',
        createdBy: currentUser.id,
        result: 'pending',
        feedback: '',
      },
    })
    if (conflicts.length > 0) {
      toast.warning('已安排，但存在面试官时间冲突，请留意调整')
    } else {
      toast.success(`已为 ${targetResume.name} 安排${type}`)
    }
    // 导入/筛选/匹配阶段的候选人自动流转到面试阶段
    if (['imported', 'screening', 'matched'].includes(targetResume.stage)) {
      dispatch({ type: 'updateStage', ids: [targetResume.id], stage: 'interview', actorId: currentUser.id })
    }
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-indigo-600" />安排面试
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          {!resume && (
            <div className="space-y-1.5">
              <Label>候选人</Label>
              <Select value={resumeId} onValueChange={setResumeId}>
                <SelectTrigger><SelectValue placeholder="选择候选人" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}（{STAGE_LABELS[r.stage]}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {resume && (
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
              为 <span className="font-medium">{resume.name}</span> 安排面试
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>面试类型</Label>
              <Select value={type} onValueChange={(v) => setType(v as InterviewType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVIEW_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>日期时间</Label>
              <Input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>地点 / 线上链接</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="学校 3F 录播教室 / 腾讯会议号 / 会议链接" />
          </div>

          <div className="space-y-1.5">
            <Label>面试官（可多选，已选 {interviewerIds.length} 人）</Label>
            <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-auto rounded-lg border p-2.5">
              {eligible.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                  <Checkbox checked={interviewerIds.includes(u.id)} onCheckedChange={() => toggleInterviewer(u.id)} />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: u.color }} />
                  {u.name}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>关联岗位</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不关联</SelectItem>
                {jobs.filter((j) => j.status === 'open' || j.id === targetResume?.jobId).map((j) => (
                  <SelectItem key={j.id} value={j.id}>{j.school}·{j.level}{j.subject}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>备注</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="试讲课题目、需携带材料、注意事项……" />
          </div>

          {conflicts.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />时间冲突提示：以下面试官在所选时间 1 小时内已有面试
              </p>
              <ul className="ml-5 list-disc space-y-0.5">
                {conflicts.map((iv) => (
                  <li key={iv.id}>
                    {interviewerIdsOf(iv).filter((id) => interviewerIds.includes(id)).map(userName).join('、')}
                    · {new Date(iv.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    · {iv.round}（{resumeName(iv.resumeId)}）
                  </li>
                ))}
              </ul>
              <p className="text-amber-600">仅提示，不强制阻断；确认无误可继续安排。</p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={submit}>确认安排</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
