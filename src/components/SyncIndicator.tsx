import { useState } from 'react'
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, Eye, EyeOff, KeyRound, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { getSyncPassphrase, isCustomSyncUrl, setSyncPassphrase } from '@/lib/sync'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** 侧边栏云端同步状态指示器：状态点（绿=已同步/黄=同步中/红=失败）+ 最后成功时间，失败时点击展开重试 */
export default function SyncIndicator() {
  const { syncStatus, lastSyncAt, syncNow, syncUrl, setCustomSyncUrl, syncLocked, submitSyncPassphrase, forcePush, currentUser } = useStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [retrying, setRetrying] = useState(false)
  // 团队同步口令相关本地状态
  const [passDraft, setPassDraft] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [passBusy, setPassBusy] = useState(false)

  const isAdmin = currentUser.role === 'admin'
  const savedPassphrase = getSyncPassphrase()

  const lastTimeText = lastSyncAt
    ? new Date(lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : null

  const statusConfig = syncLocked
    ? { dot: 'bg-amber-400 animate-pulse', color: 'text-amber-600', text: '需要团队同步口令' }
    : {
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

  /** 输入口令解锁云端加密数据 */
  async function handleUnlock() {
    if (!passDraft.trim()) {
      toast.error('请输入团队同步口令')
      return
    }
    setPassBusy(true)
    try {
      await submitSyncPassphrase(passDraft.trim())
      // submitSyncPassphrase 内部会重试拉取；若口令错误会重新进入 syncLocked
      setPassDraft('')
      toast.success('已保存口令并重试同步')
    } finally {
      setPassBusy(false)
    }
  }

  /** 管理员设置/更换团队同步口令（更换后触发一次重新加密推送） */
  async function handleSavePassphrase() {
    const p = passDraft.trim()
    if (!p) {
      toast.error('口令不能为空（如需停用加密请使用「停用加密」）')
      return
    }
    setPassBusy(true)
    try {
      const isChange = !!savedPassphrase && savedPassphrase !== p
      setSyncPassphrase(p)
      await forcePush() // 用新口令重新加密推送
      setPassDraft('')
      toast.success(isChange ? '同步口令已更换，云端数据已用新口令重新加密' : '同步口令已设置，云端数据已加密')
    } finally {
      setPassBusy(false)
    }
  }

  /** 停用加密：清除本机口令并明文重推（需要明确确认） */
  async function handleDisableEncryption() {
    setPassBusy(true)
    try {
      setSyncPassphrase('')
      await forcePush()
      toast.success('已停用云端加密并重新推送明文数据')
    } finally {
      setPassBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs hover:bg-slate-100"
        title={
          syncLocked
            ? '云端数据已加密，请输入团队同步口令'
            : syncStatus === 'error'
              ? '云端同步失败，本地数据已安全保留，点击展开重试'
              : syncStatus === 'ok' && lastTimeText
                ? `已于 ${lastTimeText} 同步`
                : undefined
        }
      >
        {syncStatus === 'syncing' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
        ) : syncLocked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        ) : (
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusConfig.dot}`} />
        )}
        <span className={`truncate ${statusConfig.color}`}>{statusConfig.text}</span>
        {syncStatus === 'error' && !syncLocked && <RefreshCw className="ml-auto h-3 w-3 shrink-0 text-rose-400" />}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
            <span className="text-sm font-medium">
              {syncLocked ? '需要团队同步口令' : { idle: '待同步', syncing: '同步中…', ok: '云端已同步', error: '同步失败' }[syncStatus]}
            </span>
            {lastTimeText && !syncLocked && (
              <span className="text-xs text-slate-400">最近成功：{lastTimeText}</span>
            )}
          </div>

          {/* 云端数据已加密但本机无口令/口令不匹配 */}
          {syncLocked && (
            <div className="space-y-2 rounded-lg bg-amber-50 p-2.5">
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-700">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                云端数据已使用团队同步口令加密。本机尚未输入口令或口令不匹配，数据暂未应用。请向管理员索取口令。
              </p>
              <Input
                type="password"
                value={passDraft}
                onChange={(e) => setPassDraft(e.target.value)}
                placeholder="请输入团队同步口令"
                className="h-8 bg-white text-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              />
              <Button size="sm" className="h-7 w-full text-xs" disabled={passBusy} onClick={handleUnlock}>
                {passBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <KeyRound className="mr-1 h-3 w-3" />}
                解锁并重试同步
              </Button>
            </div>
          )}

          {syncStatus === 'error' && !syncLocked && (
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

          {/* 团队同步口令管理（仅管理员；自定义端点不加密，无需展示） */}
          {!isCustomSyncUrl() && isAdmin && !syncLocked && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <KeyRound className="h-3 w-3" />团队同步口令（云端数据加密）
              </p>
              {savedPassphrase ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      readOnly
                      type={showPass ? 'text' : 'password'}
                      value={savedPassphrase}
                      className="h-8 bg-slate-50 text-xs"
                    />
                    <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" onClick={() => setShowPass((v) => !v)}>
                      {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    云端数据已加密。可将此口令分发给同事（口令仅保存在各成员本机，不会上传）。
                  </p>
                  <Input
                    value={passDraft}
                    onChange={(e) => setPassDraft(e.target.value)}
                    placeholder="输入新口令以更换"
                    className="h-8 text-xs"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs" disabled={passBusy || !passDraft.trim()} onClick={handleSavePassphrase}>
                      更换口令
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-600" disabled={passBusy} onClick={handleDisableEncryption}>
                      停用加密
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="flex items-start gap-1 text-[11px] leading-relaxed text-amber-600">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    尚未设置同步口令，云端数据当前为明文存储（含成员账号与简历信息），建议尽快设置。
                  </p>
                  <Input
                    value={passDraft}
                    onChange={(e) => setPassDraft(e.target.value)}
                    placeholder="设置团队同步口令"
                    className="h-8 text-xs"
                  />
                  <Button size="sm" className="h-7 w-full text-xs" disabled={passBusy || !passDraft.trim()} onClick={handleSavePassphrase}>
                    {passBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <KeyRound className="mr-1 h-3 w-3" />}
                    设置口令并加密云端数据
                  </Button>
                </div>
              )}
            </div>
          )}
          {/* 非管理员且未设置口令时的只读提示 */}
          {!isCustomSyncUrl() && !isAdmin && !savedPassphrase && !syncLocked && (
            <p className="flex items-start gap-1 text-[11px] leading-relaxed text-slate-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              云端数据当前为明文存储，可提醒管理员在同步设置中配置团队同步口令。
            </p>
          )}

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
          {syncStatus === 'ok' && !syncLocked && (
            <p className="flex items-center gap-1 text-[11px] text-emerald-600">
              <CheckCircle2 className="h-3 w-3" />团队共享数据库连接正常
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
