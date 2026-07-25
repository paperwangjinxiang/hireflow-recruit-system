import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { Interview, Resume } from '@/types'
import InterviewCard from '@/components/InterviewCard'
import InterviewEvaluationDialog from '@/components/InterviewEvaluationDialog'
import InterviewScheduleDialog from '@/components/InterviewScheduleDialog'
import { Button } from '@/components/ui/button'

/** 简历详情中的面试板块：安排面试 + 各轮面试记录（类型/时间/面试官/平均分/结论） */
export default function InterviewSection({ resume }: { resume: Resume }) {
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [evalTarget, setEvalTarget] = useState<Interview | null>(null)
  const [summaryTarget, setSummaryTarget] = useState<Interview | null>(null)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">面试安排</h3>
        <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
          <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />安排面试
        </Button>
      </div>

      <InterviewList resumeId={resume.id} onEvaluate={setEvalTarget} onSummary={setSummaryTarget} />

      <InterviewScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} resume={resume} />
      <InterviewEvaluationDialog interview={evalTarget} open={!!evalTarget} onOpenChange={(o) => !o && setEvalTarget(null)} initialTab="form" />
      <InterviewEvaluationDialog interview={summaryTarget} open={!!summaryTarget} onOpenChange={(o) => !o && setSummaryTarget(null)} initialTab="summary" />
    </div>
  )
}

function InterviewList({
  resumeId,
  onEvaluate,
  onSummary,
}: {
  resumeId: string
  onEvaluate: (iv: Interview) => void
  onSummary: (iv: Interview) => void
}) {
  const { interviews } = useStore()
  const list = interviews
    .filter((iv) => iv.resumeId === resumeId)
    .sort((a, b) => b.time - a.time)

  if (list.length === 0) {
    return <p className="text-sm text-slate-400">暂无面试安排，点击右上角「安排面试」发起试讲或结构化面试</p>
  }
  return (
    <ul className="space-y-2.5">
      {list.map((iv) => (
        <li key={iv.id}>
          <InterviewCard interview={iv} onEvaluate={onEvaluate} onSummary={onSummary} showCandidate={false} compact />
        </li>
      ))}
    </ul>
  )
}
