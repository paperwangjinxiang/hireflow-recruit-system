import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { Contact, FileUp, UserCheck, Clock, TrendingUp, BellRing, CalendarClock, Copy, Timer, UserX, MessageSquareWarning } from 'lucide-react'
import { format, startOfToday, endOfWeek } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useStore } from '@/lib/store'
import { computeReminders, LEVEL_STYLES, type Reminder } from '@/lib/reminders'
import { STAGE_LABELS, STAGE_ORDER, STAGE_COLORS, RESULT_LABELS, RESULT_COLORS } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import DashboardCharts from './DashboardCharts'

const REMINDER_ICONS = {
  interview: CalendarClock,
  stale: Timer,
  unassigned: UserX,
  duplicate: Copy,
  feedback: MessageSquareWarning,
} as const

export default function Dashboard() {
  const { resumes, users, interviews, currentUser } = useStore()
  const navigate = useNavigate()

  const reminders = useMemo(() => computeReminders(resumes, interviews), [resumes, interviews])

  const goReminder = (r: Reminder) => {
    const params = new URLSearchParams()
    if (r.filter?.stage) params.set('stage', r.filter.stage)
    if (r.filter?.assignee) params.set('assignee', r.filter.assignee)
    navigate(`/resumes${params.size ? `?${params.toString()}` : ''}`)
  }

  const stats = useMemo(() => {
    const byStage = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<string, number>
    resumes.forEach((r) => byStage[r.stage]++)
    const week = Date.now() - 7 * 24 * 60 * 60 * 1000
    const newThisWeek = resumes.filter((r) => r.createdAt >= week).length
    const assignedToMe = resumes.filter((r) => r.assigneeId === currentUser.id && r.stage !== 'hired' && r.stage !== 'rejected').length
    const active = resumes.filter((r) => r.stage !== 'hired' && r.stage !== 'rejected').length
    return { byStage, newThisWeek, assignedToMe, active }
  }, [resumes, currentUser.id])

  const recentActivities = useMemo(() => {
    return resumes
      .flatMap((r) => r.activities.map((a) => ({ ...a, resumeName: r.name })))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8)
  }, [resumes])

  // 本周（今天起至周日）的面试安排
  const upcomingInterviews = useMemo(() => {
    const start = startOfToday().getTime()
    const end = endOfWeek(new Date(), { weekStartsOn: 1 }).getTime()
    return interviews
      .filter((iv) => iv.time >= start && iv.time <= end)
      .sort((a, b) => a.time - b.time)
      .map((iv) => ({
        ...iv,
        resumeName: resumes.find((r) => r.id === iv.resumeId)?.name ?? '未知候选人',
        interviewerName: users.find((u) => u.id === iv.interviewerId)?.name ?? '—',
      }))
  }, [interviews, resumes, users])

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? '系统'

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">仪表盘</h1>
          <p className="text-sm text-slate-500">欢迎回来，{currentUser.name}。这里是招聘进展总览。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/import"><FileUp className="mr-2 h-4 w-4" />批量导入</Link>
          </Button>
          <Button asChild>
            <Link to="/resumes"><Contact className="mr-2 h-4 w-4" />进入简历库</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">简历总数</CardTitle>
            <Contact className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{resumes.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">本周新增</CardTitle>
            <TrendingUp className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{stats.newThisWeek}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">进行中流程</CardTitle>
            <Clock className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{stats.active}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">待我处理</CardTitle>
            <UserCheck className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-indigo-600">{stats.assignedToMe}</div></CardContent>
        </Card>
      </div>

      {/* 智能提醒 */}
      {reminders.length > 0 && (
        <Card className="border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="h-4 w-4 text-amber-600" />智能提醒
              <Badge variant="secondary" className="bg-amber-100 text-amber-700">{reminders.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reminders.map((r) => {
                const Icon = REMINDER_ICONS[r.icon]
                const style = LEVEL_STYLES[r.level]
                return (
                  <button
                    key={r.id}
                    onClick={() => goReminder(r)}
                    className="flex items-start gap-2.5 rounded-lg border border-white bg-white/70 p-3 text-left transition-all hover:border-amber-300 hover:bg-white hover:shadow-sm"
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.text}`} />
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${style.text}`}>{r.title}</p>
                      <p className="truncate text-xs text-slate-500">{r.detail}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <DashboardCharts />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>招聘漏斗</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {STAGE_ORDER.map((stage) => {
              const count = stats.byStage[stage]
              const pct = resumes.length ? Math.round((count / resumes.length) * 100) : 0
              return (
                <div key={stage} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <Badge variant="outline" className={STAGE_COLORS[stage]}>{STAGE_LABELS[stage]}</Badge>
                    <span className="text-slate-500">{count} 人 · {pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>本周面试日程</CardTitle>
              <Badge variant="secondary">{upcomingInterviews.length} 场</Badge>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {upcomingInterviews.map((iv) => (
                  <li key={iv.id} className="flex items-center gap-3 text-sm">
                    <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                      <span className="text-[10px] leading-none">{format(iv.time, 'EEE', { locale: zhCN })}</span>
                      <span className="text-sm font-bold leading-tight">{format(iv.time, 'd')}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{iv.resumeName} · {iv.round}</p>
                      <p className="truncate text-xs text-slate-400">
                        {format(iv.time, 'HH:mm')} · {iv.interviewerName} · {iv.location}
                      </p>
                    </div>
                    <Badge variant="outline" className={RESULT_COLORS[iv.result]}>{RESULT_LABELS[iv.result]}</Badge>
                  </li>
                ))}
                {upcomingInterviews.length === 0 && <p className="text-sm text-slate-400">本周暂无面试安排</p>}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>最新动态</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-4">
                {recentActivities.map((a) => (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
                    <div className="min-w-0">
                      <p className="text-slate-700">
                        <span className="font-medium">{userName(a.actorId)}</span> {a.action}
                        <span className="text-slate-400">（{a.resumeName}）</span>
                      </p>
                      <p className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleString('zh-CN')}</p>
                    </div>
                  </li>
                ))}
                {recentActivities.length === 0 && <p className="text-sm text-slate-400">暂无动态</p>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
