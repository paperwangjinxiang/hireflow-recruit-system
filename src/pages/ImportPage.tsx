import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileUp, Download, ClipboardPaste, CheckCircle2, AlertTriangle, Sparkles, Inbox, KeyRound, QrCode, Trash2, PackageOpen, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStore, filterDuplicateResumes, type ImportableResume } from '@/lib/store'
import { CSV_TEMPLATE, parseResumesFromCSV, type ParsedResume } from '@/lib/csv'
import { decryptApplication, fetchApplications, removeApplications, validateApplyPrivateKey, type ApplyBoxItem } from '@/lib/applybox'
import { parseResumeText } from '@/lib/parser'
import { CERT_STAGES, type CertStage, type FullTime } from '@/types'
import { ApplyQrPanel } from '@/components/ApplyQrCode'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const SAMPLE_CSV = `姓名,电话,邮箱,应聘岗位,年龄,教资学段,教资科目,毕业院校,是否全日制,专业,毕业年份,籍贯,学历,工作年限,技能,来源
孙志远,13611112222,sunzy@example.com,高中语文教师,32,高中,语文,华中师范大学,全日制,汉语言文学,2015,湖北武汉,硕士,9,教学设计;作文指导;班主任工作,万行教师人才网
林晓梅,13733334444,linxm@example.com,初中数学教师,27,初中,数学,北京师范大学,全日制,数学与应用数学,2020,河南郑州,本科,4,教学设计;分层教学,内推
黄国强,13855556666,huanggq@example.com,小学英语教师,25,小学,英语,华东师范大学,全日制,英语（师范）,2022,江苏南京,本科,2,口语训练;家校沟通,校招双选会`

/** 投递表单解密后的明文结构（与投递页 Apply.tsx 提交的结构一致） */
interface ApplyPayload {
  name: string
  phone: string
  email: string
  idCard: string
  certStage: string // 幼儿园/小学/初中/高中/持合格证明/暂无
  certSubject: string
  education: string
  fullTime: string // 全日制/非全日制/不确定
  university: string
  major: string
  gradYear: number
  hometown: string
  experience: number
  region: string // 意向片区
  rawText: string
}

/** 投递箱条目 + 解密结果（payload 为 null 表示解密失败） */
interface DecryptedApply {
  item: ApplyBoxItem
  payload: ApplyPayload | null
  error: string | null
}

/** 手机号脱敏：中间 4 位替换为 **** */
function maskPhone(phone: string): string {
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

/**
 * 投递明文 → 可入库简历：表单字段直接映射；
 * 若粘贴了简历原文，用本地解析引擎补全空缺字段（表单已填字段优先，不覆盖）。
 */
function payloadToResume(payload: ApplyPayload, meta: { jobName: string; submittedAt: number }): ImportableResume {
  const certStage = (CERT_STAGES as string[]).includes(payload.certStage) ? (payload.certStage as CertStage) : ''
  const fullTime: FullTime = payload.fullTime === '全日制' || payload.fullTime === '非全日制' ? payload.fullTime : '未知'
  const resume: ImportableResume = {
    id: `r-apply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: payload.name || '',
    phone: payload.phone || '',
    email: payload.email || '',
    position: meta.jobName || '在线投递',
    education: payload.education || '',
    experience: payload.experience || 0,
    skills: [],
    source: '在线投递',
    stage: 'imported',
    assigneeId: null,
    university: payload.university || '',
    major: payload.major || '',
    gradYear: payload.gradYear || 0,
    hometown: payload.hometown || '',
    fullTime,
    certStage,
    certSubject: payload.certSubject || '',
    // 表单选「持合格证明」表示有合格证明但尚未取得教师资格证
    certQualified: payload.certStage === '持合格证明',
    idCard: payload.idCard || '',
    rawText: (payload.rawText || '').slice(0, 20000),
    initialNote:
      `在线投递于 ${new Date(meta.submittedAt).toLocaleString('zh-CN')}` +
      `${meta.jobName ? `，意向职位：${meta.jobName}` : ''}` +
      `${payload.region ? `，意向片区：${payload.region}` : ''}`,
  }
  // 简历原文解析补全：仅填充空缺字段，表单已填内容一律优先
  if (resume.rawText) {
    const parsed = parseResumeText(resume.rawText, `${resume.name || '在线投递'}.txt`)
    if (!resume.name && parsed.name) resume.name = parsed.name
    if (!resume.email && parsed.email) resume.email = parsed.email
    if (!resume.education && parsed.education) resume.education = parsed.education
    if (!resume.experience && parsed.experience) resume.experience = parsed.experience
    if (resume.skills.length === 0 && parsed.skills.length > 0) resume.skills = parsed.skills
    if (!resume.university && parsed.university) resume.university = parsed.university
    if (!resume.major && parsed.major) resume.major = parsed.major
    if (!resume.gradYear && parsed.gradYear) resume.gradYear = parsed.gradYear
    if (!resume.hometown && parsed.hometown) resume.hometown = parsed.hometown
    if (resume.fullTime === '未知' && parsed.fullTime !== '未知') resume.fullTime = parsed.fullTime
    if (!resume.certStage && parsed.certStage) resume.certStage = parsed.certStage
    if (!resume.certSubject && parsed.certSubject) resume.certSubject = parsed.certSubject
    if (!resume.certQualified && parsed.certQualified) resume.certQualified = parsed.certQualified
    if (!resume.idCard && parsed.idCard) resume.idCard = parsed.idCard
    if (!resume.age && parsed.age) resume.age = parsed.age
  }
  return resume
}

export default function ImportPage() {
  const { resumes, jobs, currentUser, applyPrivateKey, dispatch } = useStore()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pasted, setPasted] = useState('')
  const [parsed, setParsed] = useState<ParsedResume[] | null>(null)
  const [fileName, setFileName] = useState('')

  // ---- 在线投递箱 ----
  const [applyItems, setApplyItems] = useState<DecryptedApply[] | null>(null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [keyEditing, setKeyEditing] = useState(false)
  const isAdmin = currentUser.role === 'admin'

  // ---- 投递二维码 ----
  const GENERAL_QR = '__general__'
  const [qrJobId, setQrJobId] = useState(GENERAL_QR)
  const qrJob = jobs.find((j) => j.id === qrJobId)
  const qrJobName = qrJob ? `${qrJob.school} ${qrJob.level}${qrJob.subject}教师` : ''

  /** 保存/更换投递私钥（仅管理员；存主库并随主库 AES 加密同步） */
  const savePrivateKey = async () => {
    const key = keyInput.trim()
    if (!key) {
      toast.error('请粘贴投递私钥（PKCS8 Base64）')
      return
    }
    if (!(await validateApplyPrivateKey(key))) {
      toast.error('私钥格式不正确，请确认是 PKCS8 Base64 编码的 RSA 私钥')
      return
    }
    dispatch({ type: 'setApplyPrivateKey', privateKey: key })
    setKeyInput('')
    setKeyEditing(false)
    toast.success('投递私钥已保存，将随主库加密同步给团队成员')
  }

  /** 拉取投递箱并逐条解密；解密失败的条目标记「密文损坏/密钥不符」保留在列表中 */
  const fetchBox = async () => {
    if (!applyPrivateKey) return
    setApplyLoading(true)
    try {
      const items = await fetchApplications()
      const results: DecryptedApply[] = []
      for (const item of items) {
        try {
          const payload = (await decryptApplication(item.payload, applyPrivateKey)) as ApplyPayload
          results.push({ item, payload, error: null })
        } catch {
          results.push({ item, payload: null, error: '密文损坏/密钥不符' })
        }
      }
      setApplyItems(results)
      if (results.length === 0) toast.success('投递箱暂无新投递')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拉取投递失败，请稍后重试')
    } finally {
      setApplyLoading(false)
    }
  }

  /** 单条入库：手机号查重 → 入库 → 从投递箱移除 */
  const importOne = async (d: DecryptedApply) => {
    if (!d.payload || applyBusy) return
    if (d.payload.phone && resumes.some((r) => r.phone === d.payload!.phone)) {
      toast.error(`${d.payload.name} 与库中简历手机号重复，已跳过该条`)
      return
    }
    setApplyBusy(true)
    try {
      const resume = payloadToResume(d.payload, { jobName: d.item.jobName, submittedAt: d.item.submittedAt })
      dispatch({ type: 'importResumes', resumes: [resume], actorId: currentUser.id })
      try {
        await removeApplications([d.item.id])
        setApplyItems((list) => list?.filter((x) => x.item.id !== d.item.id) ?? null)
      } catch {
        toast.warning('已入库，但从投递箱移除失败；下次拉取若重复出现，手机号查重会自动跳过')
      }
      toast.success(`已将 ${d.payload.name} 入库为正式简历`)
    } finally {
      setApplyBusy(false)
    }
  }

  /** 全部入库：手机号查重（含批次内去重）→ 批量入库 → 从投递箱移除已处理条目 */
  const importAll = async () => {
    if (applyBusy) return
    const valid = (applyItems ?? []).filter((d) => d.payload)
    if (valid.length === 0) return
    const existingPhones = new Set(resumes.map((r) => r.phone).filter(Boolean))
    const seen = new Set<string>()
    const toImport: { d: DecryptedApply; resume: ImportableResume }[] = []
    let dup = 0
    for (const d of valid) {
      const phone = d.payload!.phone
      if (phone && (existingPhones.has(phone) || seen.has(phone))) {
        dup++
        continue
      }
      if (phone) seen.add(phone)
      toImport.push({ d, resume: payloadToResume(d.payload!, { jobName: d.item.jobName, submittedAt: d.item.submittedAt }) })
    }
    if (toImport.length === 0) {
      toast.error('全部为重复简历（手机号已存在），未导入')
      return
    }
    setApplyBusy(true)
    try {
      dispatch({ type: 'importResumes', resumes: toImport.map((t) => t.resume), actorId: currentUser.id })
      const doneIds = toImport.map((t) => t.d.item.id)
      try {
        await removeApplications(doneIds)
        setApplyItems((list) => list?.filter((x) => !doneIds.includes(x.item.id)) ?? null)
      } catch {
        toast.warning('已入库，但从投递箱移除失败；下次拉取若重复出现，手机号查重会自动跳过')
      }
      toast.success(`成功入库 ${toImport.length} 份在线投递${dup > 0 ? `，跳过 ${dup} 份手机号重复` : ''}`)
    } finally {
      setApplyBusy(false)
    }
  }

  /** 删除单条投递（垃圾/无效） */
  const removeOne = async (d: DecryptedApply) => {
    if (applyBusy) return
    setApplyBusy(true)
    try {
      await removeApplications([d.item.id])
      setApplyItems((list) => list?.filter((x) => x.item.id !== d.item.id) ?? null)
      toast.success('已删除该投递')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败，请稍后重试')
    } finally {
      setApplyBusy(false)
    }
  }

  const valid = parsed?.filter((p) => p.errors.length === 0) ?? []
  const invalid = parsed?.filter((p) => p.errors.length > 0) ?? []

  const handleFile = (file: File) => {
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const result = parseResumesFromCSV(String(reader.result ?? ''))
      if (result.length === 0) {
        toast.error('未解析到任何简历，请检查文件内容与表头')
        setParsed(null)
      } else {
        setParsed(result)
        toast.success(`解析完成：${result.length} 条记录`)
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleParsePasted = () => {
    if (!pasted.trim()) {
      toast.error('请先粘贴 CSV 内容')
      return
    }
    const result = parseResumesFromCSV(pasted)
    if (result.length === 0) {
      toast.error('未解析到任何简历，请检查内容与表头')
      setParsed(null)
    } else {
      setFileName('粘贴内容')
      setParsed(result)
      toast.success(`解析完成：${result.length} 条记录`)
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '简历导入模板.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImport = () => {
    if (valid.length === 0) return
    const { unique, skipped } = filterDuplicateResumes(valid.map((v) => v.data), resumes)
    if (unique.length === 0) {
      toast.error('全部为重复简历（手机号/邮箱已存在），未导入')
      return
    }
    dispatch({ type: 'importResumes', resumes: unique, actorId: currentUser.id })
    toast.success(`成功导入 ${unique.length} 份简历${skipped > 0 ? `，跳过 ${skipped} 份重复` : ''}`)
    navigate('/resumes')
  }

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">批量导入简历</h1>
        <p className="text-sm text-slate-500">支持 CSV 文件上传或直接粘贴表格内容，导入前可预览校验。</p>
      </div>

      <Tabs defaultValue="file">
        <TabsList>
          <TabsTrigger value="file"><FileUp className="mr-2 h-4 w-4" />上传 CSV 文件</TabsTrigger>
          <TabsTrigger value="paste"><ClipboardPaste className="mr-2 h-4 w-4" />粘贴内容</TabsTrigger>
        </TabsList>

        <TabsContent value="file">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">选择文件</CardTitle>
              <CardDescription>
                表头需包含：姓名、电话、邮箱、职位、学历、工作年限、技能（多个用 ; 分隔）、来源。
                <Button variant="link" className="h-auto px-1" onClick={downloadTemplate}>
                  <Download className="mr-1 h-3.5 w-3.5" />下载模板
                </Button>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-12 text-slate-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50/50"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const f = e.dataTransfer.files?.[0]
                  if (f) handleFile(f)
                }}
              >
                <FileUp className="h-8 w-8 text-slate-400" />
                <p className="text-sm">点击选择或拖拽 CSV 文件到此处</p>
                {fileName && <Badge variant="secondary">{fileName}</Badge>}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                  e.target.value = ''
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paste">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">粘贴 CSV 内容</CardTitle>
              <CardDescription>从 Excel 导出的 CSV 文本可以直接粘贴到这里。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={10} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={CSV_TEMPLATE} className="font-mono text-xs" />
              <div className="flex gap-2">
                <Button onClick={handleParsePasted}>解析预览</Button>
                <Button variant="outline" onClick={() => setPasted(SAMPLE_CSV)}>
                  <Sparkles className="mr-2 h-4 w-4" />填入示例数据
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {parsed && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-base">
              导入预览
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{valid.length} 条可导入
              </Badge>
              {invalid.length > 0 && (
                <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">
                  <AlertTriangle className="mr-1 h-3.5 w-3.5" />{invalid.length} 条有问题
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-96 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">状态</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>电话</TableHead>
                    <TableHead>职位</TableHead>
                    <TableHead>学历</TableHead>
                    <TableHead>年限</TableHead>
                    <TableHead>技能</TableHead>
                    <TableHead>来源</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.map((p, i) => (
                    <TableRow key={i} className={p.errors.length ? 'bg-rose-50' : ''}>
                      <TableCell>
                        {p.errors.length ? (
                          <span title={p.errors.join('\n')}><AlertTriangle className="h-4 w-4 text-rose-500" /></span>
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        )}
                      </TableCell>
                      <TableCell>
                        {p.data.name || <span className="text-rose-500">（空）</span>}
                        {p.errors.length > 0 && <div className="text-xs text-rose-500">{p.errors.join('；')}</div>}
                      </TableCell>
                      <TableCell>{p.data.phone}</TableCell>
                      <TableCell>{p.data.position}</TableCell>
                      <TableCell>{p.data.education}</TableCell>
                      <TableCell>{p.data.experience}</TableCell>
                      <TableCell className="max-w-40 truncate">{p.data.skills.join('、')}</TableCell>
                      <TableCell>{p.data.source}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex gap-2">
              <Button onClick={doImport} disabled={valid.length === 0}>
                确认导入 {valid.length} 份简历
              </Button>
              <Button variant="outline" onClick={() => setParsed(null)}>取消</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- 在线投递箱：候选人扫码投递 → 私钥解密 → 一键入库 ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-5 w-5 text-indigo-600" />在线投递箱
          </CardTitle>
          <CardDescription>
            候选人通过投递二维码提交的简历在此拉取，解密后可直接入库。投递内容全程加密存储，仅持有私钥的团队可查看。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 私钥管理：未配置时管理员粘贴；已配置则脱敏展示 */}
          {!applyPrivateKey ? (
            isAdmin ? (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <Label className="flex items-center gap-1.5 text-sm text-amber-800">
                  <KeyRound className="h-4 w-4" />粘贴投递私钥（PKCS8 Base64）
                </Label>
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="粘贴 RSA 私钥的 PKCS8 Base64 内容，保存后随主库加密同步给团队成员"
                />
                <Button size="sm" onClick={savePrivateKey}>保存私钥</Button>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                等待管理员配置投递私钥
              </div>
            )
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
              <KeyRound className="h-4 w-4" />
              投递私钥已配置 ●●●（存于主库，随主库加密同步）
              {isAdmin && (
                <Button size="sm" variant="ghost" className="h-7 text-emerald-700" onClick={() => setKeyEditing((v) => !v)}>
                  更换
                </Button>
              )}
            </div>
          )}
          {applyPrivateKey && isAdmin && keyEditing && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-4">
              <Label className="text-sm">粘贴新的投递私钥（PKCS8 Base64）</Label>
              <Textarea
                rows={3}
                className="font-mono text-xs"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={savePrivateKey}>保存</Button>
                <Button size="sm" variant="ghost" onClick={() => { setKeyEditing(false); setKeyInput('') }}>取消</Button>
              </div>
            </div>
          )}

          {applyPrivateKey && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={fetchBox} disabled={applyLoading}>
                  {applyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Inbox className="mr-2 h-4 w-4" />}
                  拉取投递
                </Button>
                {applyItems && applyItems.some((d) => d.payload) && (
                  <Button onClick={importAll} disabled={applyBusy}>
                    <PackageOpen className="mr-2 h-4 w-4" />
                    全部入库（{applyItems.filter((d) => d.payload).length} 条）
                  </Button>
                )}
              </div>

              {applyItems && applyItems.length > 0 && (
                <div className="max-h-96 overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>姓名</TableHead>
                        <TableHead>手机号</TableHead>
                        <TableHead>教资</TableHead>
                        <TableHead>学历 / 院校</TableHead>
                        <TableHead>意向职位</TableHead>
                        <TableHead>投递时间</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {applyItems.map((d) => (
                        <TableRow key={d.item.id} className={d.payload ? '' : 'bg-rose-50'}>
                          {d.payload ? (
                            <>
                              <TableCell className="font-medium">{d.payload.name}</TableCell>
                              <TableCell>{maskPhone(d.payload.phone)}</TableCell>
                              <TableCell>
                                {d.payload.certStage}{d.payload.certSubject && `·${d.payload.certSubject}`}
                                {d.payload.certStage === '持合格证明' && '（合格证明）'}
                              </TableCell>
                              <TableCell>
                                {d.payload.education || '—'}{d.payload.university && ` / ${d.payload.university}`}
                              </TableCell>
                              <TableCell>{d.item.jobName || '通用投递'}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-slate-500">
                                {new Date(d.item.submittedAt).toLocaleString('zh-CN')}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="outline" disabled={applyBusy} onClick={() => importOne(d)}>
                                    入库
                                  </Button>
                                  <Button
                                    size="sm" variant="ghost" className="text-rose-500" disabled={applyBusy}
                                    onClick={() => removeOne(d)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell colSpan={6}>
                                <span className="flex items-center gap-1.5 text-sm text-rose-600">
                                  <AlertTriangle className="h-4 w-4" />{d.error}，无法解密，已跳过入库
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm" variant="ghost" className="text-rose-500" disabled={applyBusy}
                                  onClick={() => removeOne(d)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {applyItems && applyItems.length === 0 && (
                <p className="rounded-lg border border-dashed py-6 text-center text-sm text-slate-400">投递箱暂无投递</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- 投递二维码：选择职位生成专属投递码 ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-5 w-5 text-indigo-600" />投递二维码
          </CardTitle>
          <CardDescription>
            生成在线投递页二维码，打印张贴在招聘公告或转发给候选人，扫码即可投递简历（免登录）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs space-y-1.5">
            <Label className="text-xs text-slate-500">选择职位</Label>
            <Select value={qrJobId} onValueChange={setQrJobId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={GENERAL_QR}>通用投递（不指定职位）</SelectItem>
                {jobs.filter((j) => j.status === 'open').map((j) => (
                  <SelectItem key={j.id} value={j.id}>{j.school} {j.level}{j.subject}教师</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ApplyQrPanel jobId={qrJob?.id} jobName={qrJobName || undefined} />
        </CardContent>
      </Card>
    </div>
  )
}
