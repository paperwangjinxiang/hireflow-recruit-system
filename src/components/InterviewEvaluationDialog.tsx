import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Star } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import {
  CONCLUSION_COLORS,
  CONCLUSION_LABELS,
  type EvaluationConclusion,
  type Interview,
} from '@/types'
import { dimensionsOf, evalAvg, interviewAvgScore, interviewTypeOf } from '@/lib/interview-utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

const CONCLUSIONS: EvaluationConclusion[] = ['strong', 'recommend', 'hold', 'reject']

interface Props {
  interview: Interview | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 初始展示的页签：填写评价 / 评价汇总 */
  initialTab?: 'form' | 'summary'
}

/** 教师试讲结构化评价表 + 多面试官评分汇总对比 */
export default function InterviewEvaluationDialog({ interview, open, onOpenChange, initialTab = 'form' }: Props) {
  const { users, currentUser, dispatch } = useStore()
  const [tab, setTab] = useState<'form' | 'summary'>(initialTab)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [comment, setComment] = useState('')
  const [conclusion, setConclusion] = useState<EvaluationConclusion>('recommend')

  const type = interview ? interviewTypeOf(interview) : '试讲'
  const dimensions = useMemo(() => dimensionsOf(type), [type])
  const evaluations = interview?.evaluations ?? []
  const myEval = evaluations.find((ev) => ev.interviewerId === currentUser.id)

  // 打开对话框时：已提交过则回填自己的评价，否则重置
  useEffect(() => {
    if (!open || !interview) return
    setTab(initialTab)
    const mine = interview.evaluations?.find((ev) => ev.interviewerId === currentUser.id)
    if (mine) {
      setScores({ ...mine.scores })
      setComment(mine.comment)
      setConclusion(mine.conclusion)
    } else {
      setScores({})
      setComment('')
      setConclusion('recommend')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, interview?.id])

  const totalAvg = useMemo(() => {
    const vals = dimensions.map((d) => scores[d] ?? 0)
    if (vals.some((v) => v === 0)) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }, [scores, dimensions])

  const interviewAvg = interview ? interviewAvgScore(interview) : null
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '—'
  const userColor = (id: string) => users.find((u) => u.id === id)?.color ?? '#94a3b8'

  if (!interview) return null

  function submit() {
    if (!interview) return
    const missing = dimensions.filter((d) => !scores[d])
    if (missing.length > 0) {
      toast.error(`请完成全部维度评分：${missing.join('、')}`)
      return
    }
    dispatch({
      type: 'submitEvaluation',
      id: interview.id,
      actorId: currentUser.id,
      evaluation: { interviewerId: currentUser.id, scores, comment: comment.trim(), conclusion },
    })
    toast.success(myEval ? '评价已更新' : '评价已提交，面试标记为已完成')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-indigo-600" />
            {interview.candidateName ?? '候选人'} · {type}评价
            <span className="text-sm font-normal text-slate-400">
              {new Date(interview.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'form' | 'summary')}>
          <TabsList>
            <TabsTrigger value="form">{myEval ? '修改我的评价' : '填写评价'}</TabsTrigger>
            <TabsTrigger value="summary">评价汇总（{evaluations.length}）</TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="space-y-4 pt-2">
            <div className="space-y-3">
              {dimensions.map((dim) => (
                <div key={dim} className="flex items-center justify-between gap-3">
                  <Label className="w-32 shrink-0 text-sm">{dim}</Label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setScores((prev) => ({ ...prev, [dim]: n }))}
                        className="p-0.5 transition-transform hover:scale-110"
                        title={`${n} 分`}
                      >
                        <Star
                          className={`h-5 w-5 ${
                            (scores[dim] ?? 0) >= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-1.5 w-8 text-sm text-slate-500">{scores[dim] ? `${scores[dim]}分` : '—'}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-2 text-sm">
              <span className="text-indigo-700">加权总分（各维度等权平均）</span>
              <span className="font-semibold text-indigo-700">{totalAvg !== null ? `${totalAvg.toFixed(1)} 分` : '完成全部维度后自动计算'}</span>
            </div>

            <div className="space-y-1.5">
              <Label>总评</Label>
              <Textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="整体表现、亮点与不足、是否建议进入下一环节……"
              />
            </div>

            <div className="space-y-1.5">
              <Label>结论</Label>
              <div className="flex gap-2">
                {CONCLUSIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setConclusion(c)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      conclusion === c ? `${CONCLUSION_COLORS[c]} font-medium ring-1 ring-current` : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {CONCLUSION_LABELS[c]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">
                以 <span className="font-medium text-slate-500">{currentUser.name}</span> 身份提交；同一面试官再次提交将覆盖旧评价
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
                <Button onClick={submit}>{myEval ? '更新评价' : '提交评价'}</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="summary" className="space-y-4 pt-2">
            {evaluations.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">暂无评价，请先在「填写评价」页签提交</p>
            ) : (
              <>
                <div className="overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">维度</TableHead>
                        {evaluations.map((ev) => (
                          <TableHead key={ev.interviewerId} className="text-center">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: userColor(ev.interviewerId) }} />
                              {userName(ev.interviewerId)}
                            </span>
                          </TableHead>
                        ))}
                        {evaluations.length > 1 && <TableHead className="text-center font-semibold">平均</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dimensions.map((dim) => (
                        <TableRow key={dim}>
                          <TableCell className="text-sm">{dim}</TableCell>
                          {evaluations.map((ev) => (
                            <TableCell key={ev.interviewerId} className="text-center text-sm">
                              {ev.scores[dim] ?? '—'}
                            </TableCell>
                          ))}
                          {evaluations.length > 1 && (
                            <TableCell className="text-center text-sm font-medium">
                              {(evaluations.reduce((s, ev) => s + (ev.scores[dim] ?? 0), 0) / evaluations.length).toFixed(1)}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                      <TableRow className="bg-slate-50">
                        <TableCell className="text-sm font-medium">加权总分</TableCell>
                        {evaluations.map((ev) => (
                          <TableCell key={ev.interviewerId} className="text-center text-sm font-semibold text-indigo-700">
                            {evalAvg(ev).toFixed(1)}
                          </TableCell>
                        ))}
                        {evaluations.length > 1 && (
                          <TableCell className="text-center text-sm font-semibold text-indigo-700">
                            {interviewAvg !== null ? interviewAvg.toFixed(1) : '—'}
                          </TableCell>
                        )}
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-sm font-medium">结论</TableCell>
                        {evaluations.map((ev) => (
                          <TableCell key={ev.interviewerId} className="text-center">
                            <Badge variant="outline" className={CONCLUSION_COLORS[ev.conclusion]}>
                              {CONCLUSION_LABELS[ev.conclusion]}
                            </Badge>
                          </TableCell>
                        ))}
                        {evaluations.length > 1 && <TableCell />}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <ul className="space-y-2">
                  {evaluations.map((ev) => (
                    <li key={ev.interviewerId} className="flex gap-2.5 rounded-lg border p-3">
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarFallback style={{ backgroundColor: userColor(ev.interviewerId), color: '#fff' }}>
                          {userName(ev.interviewerId).slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{userName(ev.interviewerId)}</span>
                          <span className="text-xs text-slate-400">
                            {new Date(ev.submittedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{ev.comment || '（未填写总评）'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
