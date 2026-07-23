import { useState } from 'react'
import { format } from 'date-fns'
import { CalendarPlus, MapPin, Trash2, Video } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { INTERVIEW_ROUNDS, RESULT_LABELS, RESULT_COLORS, type Resume } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** 简历详情中的面试安排板块 */
export default function InterviewSection({ resume }: { resume: Resume }) {
  const { users, interviews, currentUser, dispatch } = useStore()
  const [showForm, setShowForm] = useState(false)
  const [time, setTime] = useState('')
  const [round, setRound] = useState('一面')
  const [interviewerId, setInterviewerId] = useState(users.find((u) => u.role === 'interviewer')?.id ?? users[0].id)
  const [location, setLocation] = useState('')
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [markResult, setMarkResult] = useState<'pass' | 'fail'>('pass')
  const [feedback, setFeedback] = useState('')

  const list = interviews
    .filter((iv) => iv.resumeId === resume.id)
    .sort((a, b) => b.time - a.time)

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'

  function schedule() {
    if (!time) {
      toast.error('请选择面试时间')
      return
    }
    dispatch({
      type: 'addInterview',
      actorId: currentUser.id,
      interview: {
        resumeId: resume.id,
        round,
        time: new Date(time).getTime(),
        interviewerId,
        location: location.trim() || '待定',
        result: 'pending',
        feedback: '',
      },
    })
    toast.success(`已为 ${resume.name} 安排${round}`)
    setShowForm(false)
    setTime('')
    setLocation('')
    // 自动把新简历/筛选中流转到面试中
    if (resume.stage === 'new' || resume.stage === 'screening') {
      dispatch({ type: 'updateStage', ids: [resume.id], stage: 'interview', actorId: currentUser.id })
    }
  }

  function submitResult() {
    if (!markingId) return
    dispatch({ type: 'updateInterview', id: markingId, patch: { result: markResult, feedback: feedback.trim() }, actorId: currentUser.id })
    toast.success('面试结果已记录')
    setMarkingId(null)
    setFeedback('')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">面试安排</h3>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
          <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />安排面试
        </Button>
      </div>

      {showForm && (
        <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">时间</Label>
              <Input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">轮次</Label>
              <Select value={round} onValueChange={setRound}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVIEW_ROUNDS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">面试官</Label>
              <Select value={interviewerId} onValueChange={setInterviewerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">地点 / 会议链接</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="公司 3F 会议室 / 腾讯会议号" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={schedule}>确认安排</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}

      {list.length === 0 && !showForm && (
        <p className="text-sm text-slate-400">暂无面试安排</p>
      )}

      <ul className="space-y-2.5">
        {list.map((iv) => (
          <li key={iv.id} className="rounded-lg border bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">{iv.round}</Badge>
                <span className="font-medium">{format(iv.time, 'MM月dd日 HH:mm')}</span>
                <span className="text-slate-400">· {userName(iv.interviewerId)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className={RESULT_COLORS[iv.result]}>{RESULT_LABELS[iv.result]}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    dispatch({ type: 'deleteInterview', id: iv.id })
                    toast.success('已删除该面试安排')
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                </Button>
              </div>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
              {iv.location.includes('会议') || iv.location.includes('http') ? <Video className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
              {iv.location}
            </p>
            {iv.feedback && (
              <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">{iv.feedback}</p>
            )}
            {iv.result === 'pending' && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-600" onClick={() => { setMarkingId(iv.id); setMarkResult('pass'); setFeedback('') }}>
                  标记通过
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" onClick={() => { setMarkingId(iv.id); setMarkResult('fail'); setFeedback('') }}>
                  标记未通过
                </Button>
              </div>
            )}
            {markingId === iv.id && (
              <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2.5">
                <Textarea
                  rows={2}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="面试反馈（可选）：表现评价、待改进点……"
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={submitResult}>保存结果</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMarkingId(null)}>取消</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
