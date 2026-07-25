import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, RefreshCw } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, Cell,
  PieChart, Pie, Legend,
} from 'recharts'
import { useStore } from '@/lib/store'
import {
  computeAnalytics, getCachedAnalytics, setCachedAnalytics, mapLimit,
  type AnalyticsResult,
} from '@/lib/analytics'
import type { Resume } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const DAY = 24 * 60 * 60 * 1000
/** doc 解密并发上限（控速，避免打爆候选人 API） */
const DECRYPT_CONCURRENCY = 5
/** 全量统计样本上限：超过则按 updated_at 取最近 300 条活跃记录 */
const SAMPLE_CAP = 300

const TIME_RANGES = [
  { value: 'all', label: '全部', days: 0 },
  { value: '7', label: '近7天', days: 7 },
  { value: '30', label: '近30天', days: 30 },
  { value: '90', label: '近90天', days: 90 },
] as const

const FUNNEL_BAR_COLORS = ['#818cf8', '#6366f1', '#4f46e5', '#7c3aed', '#0d9488', '#059669']
const CHANNEL_PIE_COLORS = ['#6366f1', '#0ea5e9', '#f59e0b', '#10b981', '#94a3b8']

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

function days(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)} 天`
}

/** 四个板块的骨架屏 */
function AnalyticsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function Analytics() {
  const { resumes, interviews, users, candidateDetail, candidatesMode, candidatesTotal } = useStore()
  const [timeRange, setTimeRange] = useState<string>('all')
  const [result, setResult] = useState<AnalyticsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [capped, setCapped] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const requestSeq = useRef(0)

  const userNameOf = useCallback((id: string) => users.find((u) => u.id === id)?.name ?? '未知成员', [users])
  // 镜像是否就绪（api 模式启动时索引镜像未拉完前 resumes 为空）
  const mirrorReady = resumes.length > 0 || candidatesMode === 'legacy'

  useEffect(() => {
    if (!mirrorReady) return
    const seq = ++requestSeq.current
    const range = TIME_RANGES.find((t) => t.value === timeRange) ?? TIME_RANGES[0]
    const since = range.days > 0 ? Date.now() - range.days * DAY : 0

    // 时间范围按 created_at 过滤候选人集（索引镜像字段足够）
    const filtered = resumes.filter((r) => since === 0 || r.createdAt >= since)
    const isCapped = filtered.length > SAMPLE_CAP
    const targets = isCapped
      ? [...filtered].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SAMPLE_CAP)
      : filtered

    const cacheKey = `${timeRange}:${filtered.length}:${isCapped}`
    const cached = refreshTick === 0 ? getCachedAnalytics(cacheKey) : null
    if (cached) {
      setResult(cached)
      setCapped(isCapped)
      setLoading(false)
      setLoadError(null)
      return
    }

    setLoading(true)
    setLoadError(null)
    void (async () => {
      try {
        // ≤300 条自动拉全量 doc 解密计算；解密失败的记录用镜像部分记录兜底（活动记录为空，
        // deriveStageHistory 退化为 createdAt→imported + updatedAt→当前阶段）
        const docs = await mapLimit(targets, DECRYPT_CONCURRENCY, async (t): Promise<Resume> => {
          try {
            return await candidateDetail(t.id)
          } catch {
            return t
          }
        })
        if (seq !== requestSeq.current) return
        const computed = computeAnalytics(docs, interviews, userNameOf, Date.now())
        setCachedAnalytics(cacheKey, computed)
        setResult(computed)
        setCapped(isCapped)
      } catch (e) {
        if (seq !== requestSeq.current) return
        setLoadError(e instanceof Error ? e.message : '统计计算失败')
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    })()
    // resumes/interviews 不列入依赖：candidateDetail 水合会改变 resumes，避免重复拉取；
    // 数据刷新通过手动「刷新」按钮或 5 分钟缓存过期触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, refreshTick, mirrorReady])

  const funnelChartData = useMemo(
    () => (result?.funnel ?? []).map((f, i) => ({ ...f, fill: FUNNEL_BAR_COLORS[i % FUNNEL_BAR_COLORS.length] })),
    [result],
  )
  const channelPieData = useMemo(
    () => (result?.channels ?? []).map((c) => ({ name: c.channel, value: c.total })),
    [result],
  )

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BarChart3 className="h-6 w-6 text-indigo-600" />招聘分析
          </h1>
          <p className="text-sm text-slate-500">招聘漏斗、阶段停留时长、专员绩效与渠道效果（基于候选人完整档案解密计算）。</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => setRefreshTick((t) => t + 1)}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新
          </Button>
        </div>
      </div>

      {/* 统计口径提示 */}
      <div className="flex flex-wrap items-center gap-2">
        {result && !loading && (
          <Badge variant="secondary" className="bg-indigo-50 text-indigo-700">
            统计样本 {result.sampleSize} 份候选人
          </Badge>
        )}
        {capped && (
          <Badge variant="secondary" className="bg-amber-50 text-amber-700">
            <AlertTriangle className="mr-1 h-3.5 w-3.5" />
            数据量较大{candidatesTotal !== null ? `（共 ${candidatesTotal} 条）` : ''}，统计基于最近 {SAMPLE_CAP} 条活跃记录
          </Badge>
        )}
        {result && !loading && (
          <span className="text-xs text-slate-400">
            计算于 {new Date(result.computedAt).toLocaleTimeString('zh-CN')}（结果缓存 5 分钟）
          </span>
        )}
      </div>

      {loadError && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="py-4 text-sm text-rose-700">{loadError}</CardContent>
        </Card>
      )}

      {loading || !result ? (
        <AnalyticsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* A. 招聘漏斗 */}
          <Card>
            <CardHeader>
              <CardTitle>招聘漏斗</CardTitle>
              <CardDescription>「进入过」口径：进入过下一阶段即视为经过上一阶段；转化为逐级通过率</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelChartData} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      formatter={(value, _name, item) => [
                        `进入过 ${value} 人 · 当前 ${(item.payload as { current: number }).current} 人`,
                        (item.payload as { label: string }).label,
                      ]}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                    />
                    <Bar dataKey="entered" radius={[4, 4, 0, 0]} barSize={34} isAnimationActive={false}>
                      {funnelChartData.map((d) => <Cell key={d.stage} fill={d.fill} />)}
                      <LabelList dataKey="entered" position="top" style={{ fontSize: 11, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* 逐级转化率 */}
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {result.funnel.slice(1).map((f) => (
                  <Badge key={f.stage} variant="outline" className="bg-slate-50 text-slate-700">
                    {result.funnel[result.funnel.indexOf(f) - 1].label} → {f.label}{' '}
                    <span className="ml-1 font-semibold text-indigo-600">{pct(f.conversionFromPrev)}</span>
                  </Badge>
                ))}
              </div>
              {/* 当前阶段分布 */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {result.funnel.map((f) => (
                  <span key={f.stage}>当前{f.label} <span className="font-medium text-slate-700">{f.current}</span> 人</span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* B. 阶段停留时长 */}
          <Card>
            <CardHeader>
              <CardTitle>阶段停留时长</CardTitle>
              <CardDescription>各阶段平均停留天数；平均停留 &gt; 7 天标红预警</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={result.dwell} layout="vertical" margin={{ top: 0, right: 44, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category" dataKey="label" width={64}
                      tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={false}
                    />
                    <Tooltip
                      formatter={(value, _name, item) => [
                        `${Number(value).toFixed(1)} 天（样本 ${(item.payload as { samples: number }).samples} 人）`,
                        '平均停留',
                      ]}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                    />
                    <Bar dataKey="avgDays" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
                      {result.dwell.map((d) => <Cell key={d.stage} fill={d.alert ? '#e11d48' : '#818cf8'} />)}
                      <LabelList
                        dataKey="avgDays" position="right"
                        formatter={(v: number) => `${v.toFixed(1)}天`}
                        style={{ fontSize: 11, fill: '#64748b' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>阶段</TableHead>
                    <TableHead className="text-right">平均停留</TableHead>
                    <TableHead className="text-right">样本数</TableHead>
                    <TableHead className="text-right">预警</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.dwell.map((d) => (
                    <TableRow key={d.stage}>
                      <TableCell className="font-medium">{d.label}</TableCell>
                      <TableCell className={`text-right ${d.alert ? 'font-semibold text-rose-600' : ''}`}>
                        {d.avgDays.toFixed(1)} 天
                      </TableCell>
                      <TableCell className="text-right">{d.samples}</TableCell>
                      <TableCell className="text-right">
                        {d.alert
                          ? <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">滞留 &gt; 7 天</Badge>
                          : <span className="text-slate-300">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* C. 专员绩效 */}
          <Card>
            <CardHeader>
              <CardTitle>专员绩效</CardTitle>
              <CardDescription>按岗位锁定负责人（owner）统计，按入职数排序；总库未锁定简历不计入</CardDescription>
            </CardHeader>
            <CardContent>
              {result.owners.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">暂无专员锁定数据</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>专员</TableHead>
                      <TableHead className="text-right">当前锁定</TableHead>
                      <TableHead className="text-right">累计面试</TableHead>
                      <TableHead className="text-right">录用</TableHead>
                      <TableHead className="text-right">入职</TableHead>
                      <TableHead className="text-right">锁定→入职</TableHead>
                      <TableHead className="text-right">平均锁定停留</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.owners.map((o) => (
                      <TableRow key={o.ownerId}>
                        <TableCell className="font-medium">{o.ownerName}</TableCell>
                        <TableCell className="text-right">{o.locked}</TableCell>
                        <TableCell className="text-right">{o.interviews}</TableCell>
                        <TableCell className="text-right">{o.offered}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-600">{o.onboarded}</TableCell>
                        <TableCell className="text-right">{pct(o.conversion)}</TableCell>
                        <TableCell className={`text-right ${o.avgMatchDwellDays !== null && o.avgMatchDwellDays > 7 ? 'font-semibold text-rose-600' : ''}`}>
                          {days(o.avgMatchDwellDays)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* D. 渠道效果 */}
          <Card>
            <CardHeader>
              <CardTitle>渠道效果</CardTitle>
              <CardDescription>按候选人来源渠道分布与各渠道入职转化率</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={channelPieData} dataKey="value" nameKey="name"
                      innerRadius={48} outerRadius={76} paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {channelPieData.map((_, i) => <Cell key={i} fill={CHANNEL_PIE_COLORS[i % CHANNEL_PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [`${value} 人`, '候选人数']}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                    />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>渠道</TableHead>
                    <TableHead className="text-right">候选人数</TableHead>
                    <TableHead className="text-right">进入面试</TableHead>
                    <TableHead className="text-right">录用</TableHead>
                    <TableHead className="text-right">入职</TableHead>
                    <TableHead className="text-right">入职转化率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.channels.map((c) => (
                    <TableRow key={c.channel}>
                      <TableCell className="font-medium">{c.channel}</TableCell>
                      <TableCell className="text-right">{c.total}</TableCell>
                      <TableCell className="text-right">{c.reachedInterview}</TableCell>
                      <TableCell className="text-right">{c.reachedOffered}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-600">{c.onboarded}</TableCell>
                      <TableCell className="text-right">{pct(c.total > 0 ? c.onboardRate : null)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
