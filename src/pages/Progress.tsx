import { useMemo } from 'react'
import { Link } from 'react-router'
import { ClipboardList, Lock, CalendarCheck, BadgeCheck, UserCheck, School, Activity as ActivityIcon } from 'lucide-react'
import { useStore } from '@/lib/store'
import { STAGE_LABELS, STAGE_COLORS, RESULT_LABELS, RESULT_COLORS, type Interview, type Resume } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'

/** 简历面试录用情况：按专员统计转化、按职位统计到岗进度、最新动态 */
export default function ProgressPage() {
  const { resumes, users, jobs, interviews } = useStore()

  /** 每位招聘专员的锁定 → 面试 → 录用 → 入职 转化统计 */
  const recruiterStats = useMemo(() => {
    return users.map((u) => {
      const mine = resumes.filter((r) => r.lockedBy === u.id && r.jobId)
      const locked = mine.filter((r) => r.stage === 'matched').length
      const interviewing = mine.filter((r) => r.stage === 'interview').length
      const offered = mine.filter((r) => r.stage === 'offered').length
      const onboarded = mine.filter((r) => r.stage === 'onboarded').length
      const myInterviews = interviews.filter((iv) => iv.interviewerId === u.id && iv.result !== 'pending')
      const passed = myInterviews.filter((iv) => iv.result === 'pass').length
      const failed = myInterviews.filter((iv) => iv.result === 'fail').length
      const declined = myInterviews.filter((iv) => iv.result === 'declined').length
      const passRate = myInterviews.length > 0 ? Math.round((passed / myInterviews.length) * 100) : null
      return { user: u, active: mine.length, locked, interviewing, offered, onboarded, passed, failed, declined, passRate }
    }).filter((s) => s.active > 0 || s.passed + s.failed + s.declined > 0)
  }, [resumes, users, interviews])

  /** 职位到岗进度：已入职 + 录用待入职 vs 需求人数 */
  const jobStats = useMemo(() => {
    return jobs.map((j) => {
      const linked = resumes.filter((r) => r.jobId === j.id)
      const interviewing = linked.filter((r) => r.stage === 'interview').length
      const offered = linked.filter((r) => r.stage === 'offered').length
      const onboarded = linked.filter((r) => r.stage === 'onboarded').length
      const matched = linked.filter((r) => r.stage === 'matched').length
      const filled = onboarded + offered
      const pct = j.headcount > 0 ? Math.min(100, Math.round((filled / j.headcount) * 100)) : 0
      return { job: j, matched, interviewing, offered, onboarded, filled, pct }
    })
  }, [jobs, resumes])

  /** 全库汇总卡片 */
  const totals = useMemo(() => {
    const locked = resumes.filter((r) => r.jobId).length
    const interviewing = resumes.filter((r) => r.stage === 'interview').length
    const offered = resumes.filter((r) => r.stage === 'offered').length
    const onboarded = resumes.filter((r) => r.stage === 'onboarded').length
    const done = interviews.filter((iv) => iv.result !== 'pending')
    const passed = done.filter((iv) => iv.result === 'pass').length
    const passRate = done.length > 0 ? Math.round((passed / done.length) * 100) : null
    return { locked, interviewing, offered, onboarded, passRate }
  }, [resumes, interviews])

  /** 最新简历动态（匹配/面试/录用/释放/入职相关），全库按时间倒序 */
  const feed = useMemo(() => {
    const KEYWORDS = ['锁定', '面试', '录用', '释放', '入职', '离职', '黑名单']
    const items: { id: string; resume: Resume; actorId: string; action: string; createdAt: number }[] = []
    for (const r of resumes) {
      for (const a of r.activities) {
        if (KEYWORDS.some((k) => a.action.includes(k))) {
          items.push({ id: `${r.id}-${a.id}`, resume: r, actorId: a.actorId, action: a.action, createdAt: a.createdAt })
        }
      }
    }
    return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
  }, [resumes])

  const upcoming = useMemo(
    () => interviews
      .filter((iv) => iv.result === 'pending' && iv.time > Date.now())
      .sort((a, b) => a.time - b.time)
      .slice(0, 6),
    [interviews],
  )

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ClipboardList className="h-6 w-6 text-indigo-600" />招聘进展
        </h1>
        <p className="text-sm text-slate-500">实时汇总各专员的简历锁定、面试与录用情况，以及各职位的到岗进度。</p>
      </div>

      {/* 全库汇总 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard icon={<Lock className="h-4 w-4 text-cyan-600" />} label="锁定中" value={totals.locked} />
        <StatCard icon={<CalendarCheck className="h-4 w-4 text-violet-600" />} label="面试中" value={totals.interviewing} />
        <StatCard icon={<BadgeCheck className="h-4 w-4 text-teal-600" />} label="录用待入职" value={totals.offered} />
        <StatCard icon={<UserCheck className="h-4 w-4 text-emerald-600" />} label="已入职" value={totals.onboarded} />
        <StatCard
          icon={<ActivityIcon className="h-4 w-4 text-amber-600" />}
          label="面试通过率"
          value={totals.passRate === null ? '—' : `${totals.passRate}%`}
        />
      </div>

      {/* 专员转化表 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">各招聘专员 · 简历面试录用情况</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>专员</TableHead>
                <TableHead className="text-center">锁定中</TableHead>
                <TableHead className="text-center">面试中</TableHead>
                <TableHead className="text-center">录用</TableHead>
                <TableHead className="text-center">已入职</TableHead>
                <TableHead className="text-center">面试通过</TableHead>
                <TableHead className="text-center">未通过(已释放)</TableHead>
                <TableHead className="text-center">候选人放弃</TableHead>
                <TableHead className="text-center">通过率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recruiterStats.map((s) => (
                <TableRow key={s.user.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback style={{ backgroundColor: s.user.color, color: '#fff', fontSize: 12 }}>{s.user.name.slice(0, 1)}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{s.user.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-center">{s.locked}</TableCell>
                  <TableCell className="text-center">{s.interviewing}</TableCell>
                  <TableCell className="text-center">{s.offered}</TableCell>
                  <TableCell className="text-center font-medium text-emerald-700">{s.onboarded}</TableCell>
                  <TableCell className="text-center text-teal-700">{s.passed}</TableCell>
                  <TableCell className="text-center text-rose-600">{s.failed}</TableCell>
                  <TableCell className="text-center text-slate-500">{s.declined}</TableCell>
                  <TableCell className="text-center">
                    {s.passRate === null ? <span className="text-slate-300">—</span> : (
                      <Badge variant="outline" className={s.passRate >= 60 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : s.passRate >= 40 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-rose-50 text-rose-700 border-rose-200'}>
                        {s.passRate}%
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {recruiterStats.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-slate-400">
                    还没有专员锁定简历，去<Link to="/jobs" className="text-indigo-600 hover:underline">职位发布</Link>页匹配候选人
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 职位到岗进度 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><School className="h-4 w-4 text-indigo-500" />职位到岗进度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobStats.map((s) => (
              <div key={s.job.id} className={s.job.status === 'closed' ? 'opacity-50' : ''}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{s.job.school} · {s.job.level}{s.job.subject}</span>
                  <span className="text-xs text-slate-500">
                    已到岗/待入职 <span className="font-semibold text-emerald-700">{s.filled}</span> / 需求 {s.job.headcount} 人
                    {s.interviewing > 0 && ` · 面试中 ${s.interviewing}`}
                    {s.matched > 0 && ` · 待安排 ${s.matched}`}
                  </span>
                </div>
                <Progress value={s.pct} className="h-2" />
              </div>
            ))}
            {jobStats.length === 0 && <p className="py-8 text-center text-sm text-slate-400">暂无职位</p>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* 待进行面试 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-4 w-4 text-violet-500" />即将进行的面试</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcoming.map((iv) => (
                <UpcomingRow key={iv.id} interview={iv} />
              ))}
              {upcoming.length === 0 && <p className="py-6 text-center text-sm text-slate-400">暂无待进行的面试安排</p>}
            </CardContent>
          </Card>

          {/* 最新动态 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><ActivityIcon className="h-4 w-4 text-amber-500" />最新简历动态</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {feed.map((f) => (
                  <FeedRow key={f.id} item={f} />
                ))}
                {feed.length === 0 && <p className="py-6 text-center text-sm text-slate-400">暂无动态</p>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50">{icon}</div>
        <div>
          <div className="text-xl font-bold leading-tight">{value}</div>
          <div className="text-xs text-slate-500">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function UpcomingRow({ interview }: { interview: Interview }) {
  const { resumes, users } = useStore()
  const resume = resumes.find((r) => r.id === interview.resumeId)
  const interviewer = users.find((u) => u.id === interview.interviewerId)
  return (
    <div className="flex items-center justify-between rounded-md bg-violet-50/60 px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        <span className="font-medium">{resume?.name ?? '已删除简历'}</span>
        <Badge variant="outline" className={RESULT_COLORS[interview.result]}>{interview.round} · {RESULT_LABELS[interview.result]}</Badge>
      </span>
      <span className="text-xs text-slate-500">
        {new Date(interview.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        {interviewer && ` · ${interviewer.name}`}
      </span>
    </div>
  )
}

function FeedRow({ item }: { item: { resume: Resume; actorId: string; action: string; createdAt: number } }) {
  const { users } = useStore()
  const actor = users.find((u) => u.id === item.actorId)
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarFallback style={{ backgroundColor: actor?.color ?? '#94a3b8', color: '#fff', fontSize: 11 }}>{actor?.name.slice(0, 1) ?? '?'}</AvatarFallback>
        </Avatar>
        <span className="shrink-0 font-medium">{item.resume.name}</span>
        <Badge variant="outline" className={`shrink-0 text-[10px] ${STAGE_COLORS[item.resume.stage]}`}>{STAGE_LABELS[item.resume.stage]}</Badge>
        <span className="truncate text-xs text-slate-500">{item.action}</span>
      </span>
      <span className="shrink-0 text-xs text-slate-400">
        {new Date(item.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
    </li>
  )
}
