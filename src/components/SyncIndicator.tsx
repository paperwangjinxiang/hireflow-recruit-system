import { useState } from 'react'
import { Cloud, CloudOff, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { isCustomSyncUrl } from '@/lib/sync'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** 侧边栏云端同步状态指示器 */
export default function SyncIndicator() {
  const { syncStatus, lastSyncAt, syncNow, syncUrl, setCustomSyncUrl } = useStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')

  const statusConfig = {
    idle: { text: '待同步', color: 'text-slate-400', dot: 'bg-slate-300' },
    syncing: { text: '同步中…', color: 'text-indigo-600', dot: 'bg-indigo-400 animate-pulse' },
    ok: { text: '云端已同步', color: 'text-emerald-600', dot: 'bg-emerald-500' },
    error: { text: '同步失败', color: 'text-rose-600', dot: 'bg-rose-500' },
  }[syncStatus]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-slate-100">
        {syncStatus === 'syncing' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
        ) : syncStatus === 'error' ? (
          <CloudOff className="h-3.5 w-3.5 text-rose-500" />
        ) : (
          <Cloud className="h-3.5 w-3.5 text-emerald-500" />
        )}
        <span className={statusConfig.color}>{statusConfig.text}</span>
        {lastSyncAt && (
          <span className="ml-auto text-slate-400">
            {new Date(lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
            <span className="text-sm font-medium">{statusConfig.text}</span>
            {lastSyncAt && (
              <span className="text-xs text-slate-400">
                最近：{new Date(lastSyncAt).toLocaleTimeString('zh-CN')}
              </span>
            )}
          </div>
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
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={async () => {
                  await syncNow()
                  toast.success('同步完成')
                }}
              >
                <RefreshCw className="mr-1 h-3 w-3" />立即同步
              </Button>
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
