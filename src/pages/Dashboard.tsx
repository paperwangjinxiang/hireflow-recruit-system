import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Contact, FileUp, UserCheck, Clock, TrendingUp, BellRing, CalendarClock, Copy, Timer, UserX, MessageSquareWarning, Lock, Filter, RefreshCw } from 'lucide-react'
import { format, startOfToday, endOfWeek } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useStore } from '@/lib/store'
import { computeReminders, LEVEL_STYLES, type Reminder } from '@/lib/reminders'
import { STAGE_LABELS, STAGE_COLORS, RESULT_LABELS, RESULT_COLORS, FUNNEL_STAGES, TERMINAL_STAGES, TEACHER_SUBJECTS } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardCharts from './DashboardCharts'

const DAY = 24 * 60 * 60 * 1000
const TIME_RANGES = [
  { value: '7', label: '近7天' },
  { value: '30', label: '近30天' },
  { value: '90', label: '近90天' },
  { value: 'all', label: '全部时间' },
] as const

const REMINDER_ICONS = {
  interview: CalendarClock,
  stale: Timer,
  unassigned: UserX,
  duplicate: Copy,
  feedback: MessageSquareWarning,
  lock: Lock,
} as const

export default function Dashboard() {
  const { resumes, users, interviews, jobs, currentUser } = useStore()
  const navigate = useNavigate()

  // ---- 筛选条 ----
  const [timeRange, setTimeRange] = useState<string>('all')
  const [regionFilter, setRegionFilter] = useState<string>('all')
  const [schoolFilter, setSchoolFilter] = useState<string>('all')
  const [subjectFilter, setSubjectFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')

  const regions = useMemo(() => [...new Set(jobs.map((j) => j.region).filter(Boolean))].sort(), [jobs])
  const schools = useMemo(() => [...new Set(jobs.map((j) => j.school).filter(Boolean))].sort(), [jobs])

  /** 筛选后的简历子集：时间按 createdAt；片区/学校/学科按锁定岗位匹配（未锁定简历在这三项被选时排除）；负责人按 assigneeId */
  const [now] = useState(() => Date.now())
  const filteredResumes = useMemo(() => {
    const since = timeRange === 'all' ? 0 : now - Number(timeRange) * DAY
    const jobById = new Map(jobs.map((j) => [j.id, j]))
    return resumes.filter((r) => {
      if (since > 0 && r.createdAt < since) return false
      const needJob = regionFilter !== 'all' || schoolFilter !== 'all' || subjectFilter !== 'all'
      if (needJob) {
        const job = r.jobId ? jobById.get(r.jobId) : undefined
        if (!job) return false
        if (regionFilter !== 'all' && job.region !== regionFilter) return false
        if (schoolFilter !== 'all' && job.school !== schoolFilter) return false
        if (subjectFilter !== 'all' && job.subject !== subjectFilter) return false
      }
      if (assigneeFilter !== 'all' && r.assigneeId !== assigneeFilter) return false
      return true
    })
  }, [resumes, jobs, timeRange, regionFilter, schoolFilter, subjectFilter, assigneeFilter, now])

  const filterActive = timeRange !== 'all' || regionFilter !== 'all' || schoolFilter !== 'all' || subjectFilter !== 'all' || assigneeFilter !== 'all'
  const resetFilters = () => {
    setTimeRange('all'); setRegionFilter('all'); setSchoolFilter('all'); setSubjectFilter('all'); setAssigneeFilter('all')
  }

  const reminders = useMemo(() => computeReminders(resumes, interviews), [resumes, interviews])

  const goReminder = (r: Reminder) => {
    const params = new URLSearchParams()
    if (r.filter?.stage) params.set('stage', r.filter.stage)
    if (r.filter?.assignee) params.set('assignee', r.filter.assignee)
    navigate(`/resumes${params.size ? `?${params.toString()}` : ''}`)
  }

  const stats = useMemo(() => {
    const byStage = Object.fromEntries([...FUNNEL_STAGES, ...TERMINAL_STAGES].map((s) => [s, 0])) as Record<string, number>
    filteredResumes.forEach((r) => { byStage[r.stage] = (byStage[r.stage] ?? 0) + 1 })
    const week = Date.now() - 7 * 24 * 60 * 60 * 1000
    const newThisWeek = filteredResumes.filter((r) => r.createdAt >= week).length
    const isActive = (s: string) => !TERMINAL_STAGES.includes(s as (typeof TERMINAL_STAGES)[number])
    const assignedToMe = filteredResumes.filter((r) => r.assigneeId === currentUser.id && isActive(r.stage)).length
    const active = filteredResumes.filter((r) => isActive(r.stage)).length
    return { byStage, newThisWeek, assignedToMe, active }
  }, [filteredResumes, currentUser.id])

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

      {/* 筛选条：作用于统计卡片与图表 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-500"><Filter className="h-4 w-4" />筛选</span>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="片区" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部片区</SelectItem>
              {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={schoolFilter} onValueChange={setSchoolFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="学校" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部学校</SelectItem>
              {schools.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="学科" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部学科</SelectItem>
              {TEACHER_SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="负责人" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部负责人</SelectItem>
              {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {filterActive && (
            <>
              <Badge variant="secondary" className="bg-indigo-50 text-indigo-700">命中 {filteredResumes.length} 份</Badge>
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />重置
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">简历总数</CardTitle>
            <Contact className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{filteredResumes.length}</div></CardContent>
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

      <DashboardCharts resumes={filteredResumes} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>招聘漏斗</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {FUNNEL_STAGES.map((stage) => {
              const count = stats.byStage[stage]
              const pct = filteredResumes.length ? Math.round((count / filteredResumes.length) * 100) : 0
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
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {TERMINAL_STAGES.map((stage) => (
                <Badge key={stage} variant="outline" className={STAGE_COLORS[stage]}>
                  {STAGE_LABELS[stage]} {stats.byStage[stage]}
                </Badge>
              ))}
            </div>
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
