import { AlertTriangle, CheckCircle2, ClipboardCheck, MapPin, Table2, Trash2, Undo2, Video, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import {
  CONCLUSION_COLORS,
  CONCLUSION_LABELS,
  INTERVIEW_STATUS_COLORS,
  INTERVIEW_STATUS_LABELS,
  RESULT_COLORS,
  RESULT_LABELS,
  type Interview,
} from '@/types'
import { hasConflict, interviewAvgScore, interviewConclusion, interviewerIdsOf, interviewStatusOf, interviewTypeOf } from '@/lib/interview-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Props {
  interview: Interview
  /** 点击「填写评价」 */
  onEvaluate: (iv: Interview) => void
  /** 点击「查看汇总」 */
  onSummary: (iv: Interview) => void
  /** 是否显示候选人姓名（候选人详情页内可隐藏） */
  showCandidate?: boolean
  /** 紧凑模式（候选人详情页） */
  compact?: boolean
}

/** 面试卡片：类型/时间/地点/面试官色点/状态/平均分/结论徽章 + 评价与流转操作 */
export default function InterviewCard({ interview: iv, onEvaluate, onSummary, showCandidate = true, compact = false }: Props) {
  const { users, interviews, resumes, currentUser, dispatch } = useStore()

  const type = interviewTypeOf(iv)
  const status = interviewStatusOf(iv)
  const interviewerIds = interviewerIdsOf(iv)
  const avg = interviewAvgScore(iv)
  const conclusion = interviewConclusion(iv)
  const conflict = hasConflict(iv, interviews)
  const candidateName = iv.candidateName ?? resumes.find((r) => r.id === iv.resumeId)?.name ?? '候选人'
  const isOnline = iv.location.includes('会议') || iv.location.includes('http')

  const canEvaluate =
    status === 'pending' &&
    (currentUser.role !== 'interviewer' || interviewerIds.includes(currentUser.id))
  const canDecide = status === 'completed' && iv.result === 'pending' && (currentUser.role === 'hr' || currentUser.role === 'admin')

  function decide(result: 'pass' | 'fail') {
    dispatch({ type: 'updateInterview', id: iv.id, patch: { result }, actorId: currentUser.id })
    toast.success(result === 'pass' ? `已标记通过，${candidateName} 进入录用` : `已标记不通过，${candidateName} 已释放锁定回总库`)
  }

  return (
    <div className={`rounded-lg border bg-white ${compact ? 'p-3' : 'p-4'} ${status === 'cancelled' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary" className={type === '试讲' ? 'bg-violet-100 text-violet-700' : ''}>{type}</Badge>
          {showCandidate && <span className="font-medium">{candidateName}</span>}
          <span className="text-slate-600">{format(iv.time, 'MM月dd日 HH:mm')}</span>
          <Badge variant="outline" className={INTERVIEW_STATUS_COLORS[status]}>{INTERVIEW_STATUS_LABELS[status]}</Badge>
          {iv.result !== 'pending' && (
            <Badge variant="outline" className={RESULT_COLORS[iv.result]}>{RESULT_LABELS[iv.result]}</Badge>
          )}
          {conflict && (
            <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
              <AlertTriangle className="h-3 w-3" />时间冲突
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {avg !== null && (
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">平均 {avg.toFixed(1)} 分</Badge>
          )}
          {conclusion && (
            <Badge variant="outline" className={CONCLUSION_COLORS[conclusion]}>{CONCLUSION_LABELS[conclusion]}</Badge>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          {isOnline ? <Video className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
          {iv.location}
        </span>
        <span className="flex items-center gap-1.5">
          {interviewerIds.map((id) => {
            const u = users.find((x) => x.id === id)
            return (
              <span key={id} className="inline-flex items-center gap-1" title={u?.name ?? '—'}>
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ backgroundColor: u?.color ?? '#94a3b8' }}
                >
                  {(u?.name ?? '?').slice(0, 1)}
                </span>
                {u?.name ?? '—'}
              </span>
            )
          })}
        </span>
        {iv.note && <span className="text-slate-400">备注：{iv.note}</span>}
      </div>

      {iv.feedback && status !== 'cancelled' && (
        <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">{iv.feedback}</p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        {canEvaluate && (
          <Button size="sm" variant="outline" className="h-7 text-xs text-indigo-600" onClick={() => onEvaluate(iv)}>
            <ClipboardCheck className="mr-1 h-3.5 w-3.5" />填写评价
          </Button>
        )}
        {(iv.evaluations?.length ?? 0) > 0 && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onSummary(iv)}>
            <Table2 className="mr-1 h-3.5 w-3.5" />评价汇总（{iv.evaluations!.length}）
          </Button>
        )}
        {canDecide && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-600" onClick={() => decide('pass')}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />通过→录用
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" onClick={() => decide('fail')}>
              <XCircle className="mr-1 h-3.5 w-3.5" />不通过→释放锁定
            </Button>
          </>
        )}
        {status === 'pending' && (
          <>
            <Button
              size="sm" variant="ghost" className="h-7 text-xs text-slate-500"
              onClick={() => {
                dispatch({ type: 'updateInterview', id: iv.id, patch: { status: 'cancelled' }, actorId: currentUser.id })
                toast.success('面试已取消')
              }}
            >
              <Undo2 className="mr-1 h-3.5 w-3.5" />取消面试
            </Button>
            {(currentUser.role === 'hr' || currentUser.role === 'admin') && (
              <Button
                size="sm" variant="ghost" className="h-7 text-xs text-slate-400 hover:text-rose-600"
                onClick={() => {
                  dispatch({ type: 'deleteInterview', id: iv.id })
                  toast.success('已删除该面试安排')
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
