import { useMemo } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, LabelList,
} from 'recharts'
import { useStore } from '@/lib/store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const DAY = 24 * 60 * 60 * 1000

/** 仪表盘数据图表：导入趋势、职位分布、成员处理量 */
export default function DashboardCharts() {
  const { resumes, users } = useStore()

  // 近 30 天导入趋势
  const trend = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days: { date: string; count: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY)
      days.push({ date: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 })
    }
    const start = today.getTime() - 29 * DAY
    resumes.forEach((r) => {
      if (r.createdAt < start) return
      const idx = Math.floor((r.createdAt - start) / DAY)
      if (idx >= 0 && idx < 30) days[idx].count++
    })
    return days
  }, [resumes])

  // 各职位简历分布（取前 8）
  const positions = useMemo(() => {
    const map = new Map<string, number>()
    resumes.forEach((r) => map.set(r.position, (map.get(r.position) ?? 0) + 1))
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [resumes])

  // 成员处理量排行（跟进中 + 累计负责）
  const memberLoad = useMemo(() => {
    return users
      .map((u) => {
        const assigned = resumes.filter((r) => r.assigneeId === u.id)
        return {
          name: u.name,
          active: assigned.filter((r) => r.stage !== 'onboarded' && r.stage !== 'rejected' && r.stage !== 'offboarded' && r.stage !== 'blacklisted').length,
          total: assigned.length,
        }
      })
      .filter((m) => m.total > 0)
      .sort((a, b) => b.active - a.active)
  }, [resumes, users])

  const trendTotal = trend.reduce((s, d) => s + d.count, 0)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* 导入趋势 */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>近 30 天导入趋势</CardTitle>
          <CardDescription>期间共导入 {trendTotal} 份简历</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(value) => [`${value} 份`, '导入量']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#trendFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 职位分布 */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>各职位简历分布</CardTitle>
          <CardDescription>简历数最多的前 {positions.length} 个职位</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={positions} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={76}
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(value) => [`${value} 份`, '简历数']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Bar dataKey="count" fill="#818cf8" radius={[0, 4, 4, 0]} barSize={14}>
                  <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#64748b' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 成员处理量 */}
      <Card className="lg:col-span-5">
        <CardHeader>
          <CardTitle>成员处理量排行</CardTitle>
          <CardDescription>每位成员「跟进中」与「累计负责」的简历数对比</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={memberLoad} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(value, name) => [`${value} 份`, name === 'active' ? '跟进中' : '累计负责']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Bar dataKey="active" name="跟进中" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={22} />
                <Bar dataKey="total" name="累计负责" fill="#c7d2fe" radius={[4, 4, 0, 0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
