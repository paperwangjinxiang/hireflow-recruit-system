import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Bell, CalendarClock, Timer, UserX, Copy, MessageSquareWarning, Lock,
  Inbox, UserCheck, CheckCheck, ChevronRight,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { computeReminders, LEVEL_STYLES, type Reminder, type ReminderLevel } from '@/lib/reminders'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import type { LucideIcon } from 'lucide-react'

/** 顶栏提醒中心：铃铛 + 未读徽章 + 下拉面板。提醒基于现有简历/面试/投递箱本地状态实时计算 */

/** 已读提醒 id 列表（localStorage） */
const READ_KEY = 'hireflow-reminders-read'
/** 投递箱上次拉取状态（由批量导入页拉取后写入） */
const APPLYBOX_LAST_KEY = 'hireflow-applybox-last'

interface ApplyBoxLast {
  at: number
  pending: number
}

function loadReadIds(): string[] {
  try {
    const raw = localStorage.getItem(READ_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function loadApplyBoxLast(): ApplyBoxLast | null {
  try {
    const raw = localStorage.getItem(APPLYBOX_LAST_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (typeof obj?.at === 'number' && typeof obj?.pending === 'number') return obj as ApplyBoxLast
    return null
  } catch {
    return null
  }
}

/** 面板条目：在 reminders.ts 引擎基础上扩展「待入库投递 / 待审批事项」两类 */
interface ReminderItem {
  id: string
  level: ReminderLevel
  icon: LucideIcon
  title: string
  detail: string
  /** 点击跳转路径 */
  to: string
}

const BASE_ICONS: Record<Reminder['icon'], LucideIcon> = {
  interview: CalendarClock,
  stale: Timer,
  unassigned: UserX,
  duplicate: Copy,
  feedback: MessageSquareWarning,
  lock: Lock,
}

/** 基础提醒（reminders.ts）的跳转路径：与仪表盘智能提醒口径一致 */
function baseReminderTo(r: Reminder): string {
  const params = new URLSearchParams()
  if (r.filter?.stage) params.set('stage', r.filter.stage)
  if (r.filter?.assignee) params.set('assignee', r.filter.assignee)
  return `/resumes${params.size ? `?${params.toString()}` : ''}`
}

export default function ReminderCenter() {
  const { resumes, interviews, users, currentUser } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [readIds, setReadIds] = useState<string[]>(loadReadIds)

  const items = useMemo<ReminderItem[]>(() => {
    const list: ReminderItem[] = computeReminders(resumes, interviews).map((r) => ({
      id: r.id,
      level: r.level,
      icon: BASE_ICONS[r.icon],
      title: r.title,
      detail: r.detail,
      to: baseReminderTo(r),
    }))

    // 待入库投递：仅读 localStorage 中上次拉取状态，无该状态则跳过（不打网络请求）
    const box = loadApplyBoxLast()
    if (box && box.pending > 0) {
      list.push({
        id: 'applybox-pending',
        level: 'warn',
        icon: Inbox,
        title: `在线投递箱有 ${box.pending} 份待处理投递`,
        detail: `上次拉取于 ${new Date(box.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}，请到批量导入页处理`,
        to: '/import',
      })
    }

    // 待审批事项：新注册成员待审批（仅管理员可见）
    if (currentUser.role === 'admin') {
      const pendingUsers = users.filter((u) => u.status === 'pending')
      if (pendingUsers.length > 0) {
        list.push({
          id: 'team-pending',
          level: 'warn',
          icon: UserCheck,
          title: `${pendingUsers.length} 位新成员待审批`,
          detail: pendingUsers.slice(0, 3).map((u) => u.name).join('、') + (pendingUsers.length > 3 ? ' 等' : ''),
          to: '/team',
        })
      }
    }

    const order: Record<ReminderLevel, number> = { urgent: 0, warn: 1, info: 2 }
    return list.sort((a, b) => order[a.level] - order[b.level])
    // open 变化时重算：让「全部标为已读」后新计算口径与最新 localStorage 一致
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumes, interviews, users, currentUser.role, open])

  const unread = items.filter((i) => !readIds.includes(i.id))

  function persistRead(ids: string[]) {
    setReadIds(ids)
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(ids))
    } catch {
      // ignore
    }
  }

  function handleClick(item: ReminderItem) {
    if (!readIds.includes(item.id)) persistRead([...readIds, item.id])
    setOpen(false)
    navigate(item.to)
  }

  function markAllRead() {
    persistRead([...new Set([...readIds, ...items.map((i) => i.id)])])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative h-9 w-9 p-0" title="提醒中心">
          <Bell className="h-4 w-4 text-slate-600" />
          {unread.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unread.length > 99 ? '99+' : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">提醒中心</span>
          {unread.length > 0 && (
            <span className="text-xs text-slate-400">{unread.length} 条未读</span>
          )}
        </div>
        <div className="max-h-96 overflow-auto">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">一切正常，暂无提醒</p>
          ) : (
            items.map((item) => {
              const style = LEVEL_STYLES[item.level]
              const isRead = readIds.includes(item.id)
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={`flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                    isRead ? 'opacity-55' : ''
                  }`}
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${isRead ? 'bg-slate-200' : style.dot}`} />
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isRead ? 'text-slate-400' : style.text}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-medium ${isRead ? 'text-slate-500' : style.text}`}>{item.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">{item.detail}</span>
                  </span>
                  <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300" />
                </button>
              )
            })
          )}
        </div>
        <div className="border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full text-xs text-slate-500"
            disabled={unread.length === 0}
            onClick={markAllRead}
          >
            <CheckCheck className="mr-1.5 h-3.5 w-3.5" />全部标为已读
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
