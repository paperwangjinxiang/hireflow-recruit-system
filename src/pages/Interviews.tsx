import { useMemo, useState } from 'react'
import { addDays, format, startOfWeek } from 'date-fns'
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import { INTERVIEW_STATUS_LABELS, type Interview, type InterviewStatus } from '@/types'
import { interviewStatusOf } from '@/lib/interview-utils'
import InterviewCard from '@/components/InterviewCard'
import InterviewEvaluationDialog from '@/components/InterviewEvaluationDialog'
import InterviewScheduleDialog from '@/components/InterviewScheduleDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const DAY = 24 * 60 * 60 * 1000
const STATUS_FILTERS: (InterviewStatus | 'all')[] = ['all', 'pending', 'completed', 'cancelled']

function sameDay(a: number, b: number) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/** 面试管理：今日/本周列表 + 周日历视图 + 结构化评价 + 反馈汇总 */
export default function Interviews() {
  const { interviews, resumes } = useStore()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<InterviewStatus | 'all'>('all')
  const [weekOffset, setWeekOffset] = useState(0)
  const [evalTarget, setEvalTarget] = useState<Interview | null>(null)
  const [summaryTarget, setSummaryTarget] = useState<Interview | null>(null)

  const now = Date.now()
  const sorted = useMemo(() => [...interviews].sort((a, b) => a.time - b.time), [interviews])

  const filtered = useMemo(
    () => sorted.filter((iv) => statusFilter === 'all' || interviewStatusOf(iv) === statusFilter),
    [sorted, statusFilter],
  )

  const todayList = filtered.filter((iv) => sameDay(iv.time, now))
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd = weekStart.getTime() + 7 * DAY
  const weekList = filtered.filter((iv) => iv.time >= weekStart.getTime() && iv.time < weekEnd && !sameDay(iv.time, now))
  const laterList = filtered.filter((iv) => iv.time >= weekEnd || iv.time < weekStart.getTime())

  const viewWeekStart = addDays(weekStart, weekOffset * 7)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(viewWeekStart, i))

  const pendingCount = interviews.filter((iv) => interviewStatusOf(iv) === 'pending').length
  const candidateName = (iv: Interview) => iv.candidateName ?? resumes.find((r) => r.id === iv.resumeId)?.name ?? '候选人'

  function Section({ title, list, empty }: { title: string; list: Interview[]; empty: string }) {
    return (
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {title}
          <Badge variant="secondary" className="text-xs">{list.length}</Badge>
        </h2>
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-slate-400">{empty}</p>
        ) : (
          <div className="space-y-2.5">
            {list.map((iv) => (
              <InterviewCard key={iv.id} interview={iv} onEvaluate={setEvalTarget} onSummary={setSummaryTarget} />
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <CalendarClock className="h-6 w-6 text-indigo-600" />面试管理
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            共 {interviews.length} 场面试 · {pendingCount} 场待面试
          </p>
        </div>
        <Button onClick={() => setScheduleOpen(true)}>
          <CalendarPlus className="mr-1.5 h-4 w-4" />安排面试
        </Button>
      </div>

      <Tabs defaultValue="list">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="list">面试列表</TabsTrigger>
            <TabsTrigger value="week">周日历</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'
                }`}
              >
                {s === 'all' ? '全部' : INTERVIEW_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        <TabsContent value="list" className="space-y-6 pt-4">
          <Section title="今日面试" list={todayList} empty="今天没有面试安排" />
          <Section title="本周其他面试" list={weekList} empty="本周暂无其他面试" />
          <Section title="其他（更早 / 更晚）" list={laterList} empty="暂无记录" />
        </TabsContent>

        <TabsContent value="week" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o - 1)}>
              <ChevronLeft className="h-4 w-4" />上一周
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">
                {format(viewWeekStart, 'MM月dd日')} — {format(addDays(viewWeekStart, 6), 'MM月dd日')}
              </span>
              {weekOffset !== 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setWeekOffset(0)}>回到本周</Button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o + 1)}>
              下一周<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((day) => {
              const dayList = sorted
                .filter((iv) => sameDay(iv.time, day.getTime()))
                .filter((iv) => statusFilter === 'all' || interviewStatusOf(iv) === statusFilter)
              const isToday = sameDay(day.getTime(), now)
              return (
                <div key={day.toISOString()} className={`min-h-40 rounded-lg border p-2 ${isToday ? 'border-indigo-300 bg-indigo-50/40' : 'bg-white'}`}>
                  <div className={`mb-2 text-center text-xs font-medium ${isToday ? 'text-indigo-700' : 'text-slate-500'}`}>
                    {format(day, 'EEE dd日')}
                    {isToday && <span className="ml-1 rounded bg-indigo-600 px-1 text-[10px] text-white">今天</span>}
                  </div>
                  <div className="space-y-1.5">
                    {dayList.map((iv) => {
                      const st = interviewStatusOf(iv)
                      return (
                        <button
                          key={iv.id}
                          type="button"
                          onClick={() => (st === 'pending' ? setEvalTarget(iv) : setSummaryTarget(iv))}
                          className={`w-full rounded border p-1.5 text-left text-[11px] leading-tight transition-colors hover:border-indigo-300 ${
                            st === 'cancelled' ? 'opacity-50' : ''
                          }`}
                          title="点击填写评价 / 查看汇总"
                        >
                          <div className="font-medium text-slate-700">{format(iv.time, 'HH:mm')} {candidateName(iv)}</div>
                          <div className="mt-0.5 flex items-center justify-between text-slate-400">
                            <span>{iv.round}</span>
                            <span>{INTERVIEW_STATUS_LABELS[st]}</span>
                          </div>
                        </button>
                      )
                    })}
                    {dayList.length === 0 && <p className="pt-4 text-center text-[11px] text-slate-300">无安排</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>

      <InterviewScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />
      <InterviewEvaluationDialog interview={evalTarget} open={!!evalTarget} onOpenChange={(o) => !o && setEvalTarget(null)} initialTab="form" />
      <InterviewEvaluationDialog interview={summaryTarget} open={!!summaryTarget} onOpenChange={(o) => !o && setSummaryTarget(null)} initialTab="summary" />
    </div>
  )
}
