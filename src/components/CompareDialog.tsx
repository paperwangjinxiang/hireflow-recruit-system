/** 候选人对比视图：2-4 人 side-by-side 表格对比（基本信息 + 评估结果） */

import { useMemo } from 'react'
import { useStore } from '@/lib/store'
import { STAGE_LABELS, STAGE_COLORS, type Resume } from '@/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { GitCompareArrows, Eye } from 'lucide-react'
import { evaluateResume, GRADE_COLORS, GRADE_LABELS } from '@/lib/evaluate'
import { cn } from '@/lib/utils'

interface CompareRow {
  label: string
  values: string[]
  /** 醒目强调（评估总分） */
  strong?: boolean
  /** 自定义渲染 */
  render?: (r: Resume, i: number) => React.ReactNode
}

function overallColor(score: number): string {
  if (score >= 85) return 'text-emerald-600'
  if (score >= 70) return 'text-sky-600'
  if (score >= 55) return 'text-amber-600'
  return 'text-rose-600'
}

export default function CompareDialog({
  resumes,
  open,
  onOpenChange,
  onView,
}: {
  resumes: Resume[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 打开某位候选人详情 */
  onView: (resumeId: string) => void
}) {
  const { users } = useStore()

  const evaluations = useMemo(() => resumes.map((r) => evaluateResume(r)), [resumes])

  const rows = useMemo<CompareRow[]>(() => {
    const text = (v: string | number) => String(v)
    return [
      { label: '年龄', values: resumes.map((r) => (r.age > 0 ? `${r.age} 岁` : '—')) },
      { label: '学历', values: resumes.map((r) => r.education || '—') },
      { label: '全日制', values: resumes.map((r) => r.fullTime) },
      { label: '毕业院校', values: resumes.map((r) => r.university || '—') },
      { label: '专业', values: resumes.map((r) => r.major || '—') },
      { label: '毕业年份', values: resumes.map((r) => (r.gradYear > 0 ? text(r.gradYear) : '—')) },
      {
        label: '教师资格证',
        values: resumes.map((r) =>
          r.certStage ? `${r.certStage}${r.certSubject}` : r.certQualified ? '合格证明（待认定）' : '无证',
        ),
      },
      { label: '证书数', values: resumes.map((r) => text(r.certificates.length)) },
      { label: '工作经验', values: resumes.map((r) => `${r.experience} 年`) },
      {
        label: '评估总分',
        strong: true,
        values: evaluations.map((e) => text(e.overall)),
        render: (_r, i) => (
          <span className={cn('text-lg font-bold tabular-nums', overallColor(evaluations[i].overall))}>
            {evaluations[i].overall}
          </span>
        ),
      },
      {
        label: '评估等级',
        values: evaluations.map((e) => e.grade),
        render: (_r, i) => (
          <Badge variant="outline" className={GRADE_COLORS[evaluations[i].grade]}>
            {evaluations[i].grade} · {GRADE_LABELS[evaluations[i].grade]}
          </Badge>
        ),
      },
      {
        label: '当前阶段',
        values: resumes.map((r) => STAGE_LABELS[r.stage]),
        render: (r) => (
          <Badge variant="outline" className={STAGE_COLORS[r.stage]}>{STAGE_LABELS[r.stage]}</Badge>
        ),
      },
      {
        label: '负责人',
        values: resumes.map((r) => users.find((u) => u.id === r.assigneeId)?.name ?? '未分配'),
      },
    ]
  }, [resumes, evaluations, users])

  /** 差异行：该行值不全相同 */
  const isDiff = (values: string[]) => new Set(values).size > 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-indigo-600" />
            候选人对比（{resumes.length} 人）
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-28 border-b p-2 text-left text-xs font-medium text-slate-400">对比项</th>
                {resumes.map((r) => (
                  <th key={r.id} className="border-b p-2 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{r.name}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => onView(r.id)}
                      >
                        <Eye className="mr-1 h-3 w-3" />查看
                      </Button>
                    </div>
                    <div className="mt-0.5 text-xs font-normal text-slate-400">{r.position || '—'}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const diff = isDiff(row.values)
                return (
                  <tr key={row.label} className={diff ? 'bg-amber-50/70' : ''}>
                    <td className={cn('border-b p-2 text-xs', row.strong ? 'font-semibold text-slate-600' : 'text-slate-400')}>
                      {row.label}
                    </td>
                    {resumes.map((r, i) => (
                      <td key={r.id} className={cn('border-b p-2 align-middle', row.strong && 'font-medium')}>
                        {row.render ? row.render(r, i) : <span className="text-slate-700">{row.values[i]}</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="py-2 text-xs text-slate-400">浅黄色背景行为候选人之间存在差异的字段。</p>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
