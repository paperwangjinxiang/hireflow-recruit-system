import { useState } from 'react'
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { isCustomSyncUrl } from '@/lib/sync'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** 侧边栏云端同步状态指示器：状态点（绿=已同步/黄=同步中/红=失败）+ 最后成功时间，失败时点击展开重试 */
export default function SyncIndicator() {
  const { syncStatus, lastSyncAt, syncNow, syncUrl, setCustomSyncUrl } = useStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [retrying, setRetrying] = useState(false)

  const lastTimeText = lastSyncAt
    ? new Date(lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : null

  const statusConfig = {
    idle: { dot: 'bg-slate-300', color: 'text-slate-400', text: '待同步' },
    syncing: { dot: 'bg-amber-400 animate-pulse', color: 'text-amber-600', text: '同步中…' },
    ok: {
      dot: 'bg-emerald-500',
      color: 'text-emerald-600',
      text: lastTimeText ? `已于 ${lastTimeText} 同步` : '云端已同步',
    },
    error: { dot: 'bg-rose-500', color: 'text-rose-600', text: '同步失败，点击重试' },
  }[syncStatus]

  async function handleSyncNow() {
    setRetrying(true)
    try {
      const ok = await syncNow()
      if (ok) toast.success('同步完成')
      else toast.error('同步失败，云端存储暂时不可用，本地数据已保留，可稍后重试')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-slate-100"
        title={
          syncStatus === 'error'
            ? '云端同步失败，本地数据已安全保留，点击展开重试'
            : syncStatus === 'ok' && lastTimeText
              ? `已于 ${lastTimeText} 同步`
              : undefined
        }
      >
        {syncStatus === 'syncing' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
        ) : (
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusConfig.dot}`} />
        )}
        <span className={`truncate ${statusConfig.color}`}>{statusConfig.text}</span>
        {syncStatus === 'error' && <RefreshCw className="ml-auto h-3 w-3 shrink-0 text-rose-400" />}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
            <span className="text-sm font-medium">
              {{ idle: '待同步', syncing: '同步中…', ok: '云端已同步', error: '同步失败' }[syncStatus]}
            </span>
            {lastTimeText && (
              <span className="text-xs text-slate-400">最近成功：{lastTimeText}</span>
            )}
          </div>
          {syncStatus === 'error' && (
            <div className="space-y-2 rounded-lg bg-rose-50 p-2.5">
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-rose-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                云端公共存储偶发限流/超时。本地修改已安全保留在本机，不会丢失，恢复后会自动补传。
              </p>
              <Button size="sm" className="h-7 w-full text-xs" disabled={retrying} onClick={handleSyncNow}>
                {retrying ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                重试同步
              </Button>
            </div>
          )}
          <p className="text-xs leading-relaxed text-slate-500">
            简历库实时同步到云端，团队成员打开同一网址即可共享数据。本地保留离线缓存，断网也能使用。
          </p>
          <div className="rounded bg-slate-50 p-2 text-[11px] text-slate-400 break-all">
            同步端点：{syncUrl}
            {isCustomSyncUrl() && <span className="ml-1 text-indigo-500">（自定义）</span>}
          </div>
          {editing ? (
            <div className="space-y-2">
              <Label className="text-xs">自定义同步端点（支持 GET / PUT JSON 的存储）</Label>
              <Input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://..."
                className="h-8 text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setCustomSyncUrl(urlDraft)
                    setEditing(false)
                    toast.success('同步端点已更新')
                  }}
                >
                  保存
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setCustomSyncUrl('')
                    setEditing(false)
                    toast.success('已恢复默认端点')
                  }}
                >
                  恢复默认
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {syncStatus !== 'error' && (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={retrying} onClick={handleSyncNow}>
                  {retrying ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  立即同步
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setUrlDraft(syncUrl)
                  setEditing(true)
                }}
              >
                更换端点
              </Button>
            </div>
          )}
          {syncStatus === 'ok' && (
            <p className="flex items-center gap-1 text-[11px] text-emerald-600">
              <CheckCircle2 className="h-3 w-3" />团队共享数据库连接正常
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
