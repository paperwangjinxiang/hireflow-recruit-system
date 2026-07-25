import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, QrCode } from 'lucide-react'
import { toast } from 'sonner'
import { buildApplyUrl } from '@/lib/apply-url'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** 投递二维码面板：实时生成二维码大图 + 下载 PNG + 复制链接 */
export function ApplyQrPanel({ jobId, jobName }: { jobId?: string; jobName?: string }) {
  const [dataUrl, setDataUrl] = useState('')
  const url = buildApplyUrl(jobId ? { id: jobId, name: jobName ?? '' } : undefined)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, { width: 480, margin: 2, errorCorrectionLevel: 'M' })
      .then((d) => {
        if (!cancelled) setDataUrl(d)
      })
      .catch(() => {
        if (!cancelled) toast.error('二维码生成失败')
      })
    return () => {
      cancelled = true
    }
  }, [url])

  const downloadPng = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `投递二维码${jobName ? '-' + jobName : ''}.png`
    a.click()
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('投递链接已复制')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {jobName && (
        <div className="rounded-full bg-indigo-100 px-4 py-1 text-sm font-medium text-indigo-700">
          投递职位：{jobName}
        </div>
      )}
      {dataUrl ? (
        <img src={dataUrl} alt="投递二维码" className="h-64 w-64 rounded-lg border" />
      ) : (
        <div className="flex h-64 w-64 items-center justify-center rounded-lg border bg-slate-50 text-slate-400">
          <QrCode className="h-8 w-8 animate-pulse" />
        </div>
      )}
      <p className="max-w-full break-all text-center text-xs text-slate-400">{url}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={downloadPng} disabled={!dataUrl}>
          <Download className="mr-1.5 h-3.5 w-3.5" />下载 PNG
        </Button>
        <Button size="sm" variant="outline" onClick={copyLink}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />复制链接
        </Button>
      </div>
    </div>
  )
}

/** 职位专属投递二维码对话框（职位页卡片「投递二维码」按钮弹出） */
export function ApplyQrDialog({
  open,
  onOpenChange,
  jobId,
  jobName,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  jobId: string
  jobName: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>职位投递二维码</DialogTitle>
          <DialogDescription>候选人扫码后直达该职位的在线投递页，打印张贴或转发均可。</DialogDescription>
        </DialogHeader>
        <ApplyQrPanel jobId={jobId} jobName={jobName} />
      </DialogContent>
    </Dialog>
  )
}
