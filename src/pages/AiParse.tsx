import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Sparkles, FileText, FileUp, Settings, Trash2, CheckCircle2,
  AlertTriangle, Loader2, BrainCircuit, ClipboardPaste, ExternalLink, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { useStore, filterDuplicateResumes } from '@/lib/store'
import { detectKind, extractText, MAX_FILE_SIZE } from '@/lib/extract'
import { parseResumeText, type ParsedFields } from '@/lib/parser'
import { tagColor } from '@/lib/tags'
import { getLlmConfig, saveLlmConfig, parseWithLlm, mergeParsed, matchProviderPreset, testLlmConnection, LLM_PROVIDER_PRESETS, type LlmConfig } from '@/lib/llm'
import { maskIdCard } from '@/lib/regions'
import { saveResumeFile } from '@/lib/filestore'
import { matchDuplicates } from '@/lib/dedup'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface FileItem {
  id: string
  fileName: string
  status: 'processing' | 'done' | 'error'
  error?: string
  method?: 'ai' | 'local'
  /** 处理中的进度提示（如 OCR 识别进度） */
  progress?: string
  rawText: string
  fields: ParsedFields
  /** 原始文件（导入成功后存入本机 IndexedDB 供原件预览；粘贴解析无文件） */
  file?: File
}

const EDUCATION_OPTIONS = ['博士', '硕士', '本科', '大专', '高中', '未知']

/** 低置信度列表中代表「字段键」的项（其余为中文提醒文案） */
const LOW_CONFIDENCE_FIELD_KEYS = ['name', 'position', 'phone', 'email', 'education', 'certStage']

function uid() {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 预生成简历 ID：导入成功后以此 ID 把原件存入本机 IndexedDB */
function rid() {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default function AiParse() {
  const { resumes, currentUser, dispatch } = useStore()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<FileItem[]>([])
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(getLlmConfig)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftConfig, setDraftConfig] = useState<LlmConfig>(llmConfig)
  const [pasted, setPasted] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [testing, setTesting] = useState(false)

  const doneItems = items.filter((i) => i.status === 'done')
  const importable = doneItems.filter((i) => i.fields.name.trim())

  async function processOne(itemId: string, fileName: string, rawText: string, extraWarnings: string[] = []) {
    const local = parseResumeText(rawText, fileName)
    let fields = local
    let method: 'ai' | 'local' = 'local'
    const config = getLlmConfig()
    if (config.enabled && config.baseUrl && config.apiKey && config.model) {
      try {
        const llm = await parseWithLlm(rawText, config)
        fields = mergeParsed(local, llm)
        method = 'ai'
      } catch (e) {
        console.warn('LLM 解析失败，回退本地引擎：', e)
      }
    }
    // 提取阶段的提醒（OCR 截断/超时等）并入低置信度提示
    if (extraWarnings.length > 0) {
      fields = { ...fields, lowConfidence: [...fields.lowConfidence, ...extraWarnings.filter((w) => !fields.lowConfidence.includes(w))] }
    }
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: 'done', fields, method } : i)))
  }

  /** 单份文件的提取+解析（失败项可凭保留的 file 重试） */
  async function runOne({ item, file }: { item: FileItem; file: File }) {
    const setProgress = (msg: string) =>
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, progress: msg } : i)))
    try {
      const { text, warnings } = await extractText(file, setProgress)
      if (!text.trim()) throw new Error('OCR 也无法识别出文字，请上传更清晰的扫描件或文字版简历')
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, rawText: text, progress: '解析字段中…' } : i)))
      await processOne(item.id, item.fileName, text, warnings)
    } catch (e) {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'error', error: e instanceof Error ? e.message : '解析失败' } : i)),
      )
    }
  }

  /** 失败项重试：重置状态后重新走提取+解析管线 */
  async function retryOne(item: FileItem) {
    if (!item.file) return
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'processing', error: undefined, progress: '重试中…' } : i)))
    await runOne({ item, file: item.file })
  }

  async function handleFiles(files: FileList | File[]) {
    const list = [...files]
    if (list.length === 0) return
    const pairs: { item: FileItem; file: File }[] = []
    for (const file of list) {
      if (!detectKind(file.name)) {
        toast.error(`不支持的格式：${file.name}（支持 PDF / DOCX / DOC / TXT / MD）`)
        continue
      }
      // 大小护栏：单文件 >20MB 直接拒绝
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} 文件过大（>20MB），请先压缩`)
        continue
      }
      const item: FileItem = { id: uid(), fileName: file.name, status: 'processing', rawText: '', fields: emptyFields(), file }
      pairs.push({ item, file })
    }
    setItems((prev) => [...pairs.map((p) => p.item), ...prev])
    // 受限并发解析：3 个 worker 消费队列（OCR 场景下 Tesseract 单线程天然受限）
    let cursor = 0
    const workers = Array.from({ length: Math.min(3, pairs.length) }, async () => {
      while (cursor < pairs.length) {
        const pair = pairs[cursor++]
        await runOne(pair)
      }
    })
    await Promise.all(workers)
  }

  function handlePasteParse() {
    if (!pasted.trim()) {
      toast.error('请先粘贴简历文本')
      return
    }
    const item: FileItem = { id: uid(), fileName: '粘贴的简历.txt', status: 'processing', rawText: pasted, fields: emptyFields() }
    setItems((prev) => [item, ...prev])
    setPasted('')
    setPasteOpen(false)
    processOne(item.id, item.fileName, pasted)
  }

  function updateField(id: string, patch: Partial<ParsedFields>) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, fields: { ...i.fields, ...patch, lowConfidence: i.fields.lowConfidence.filter((f) => !(f in patch)) } }
          : i,
      ),
    )
  }

  async function doImport() {
    if (importable.length === 0) {
      toast.error('没有可导入的简历（姓名不能为空）')
      return
    }
    const fileByResumeId = new Map<string, File>()
    const candidates = importable.map((i) => {
      const resumeId = rid()
      if (i.file) fileByResumeId.set(resumeId, i.file)
      return {
        id: resumeId,
        name: i.fields.name.trim(),
      phone: i.fields.phone,
      email: i.fields.email,
      position: i.fields.position,
      education: i.fields.education,
      experience: i.fields.experience,
      skills: i.fields.skills,
      university: i.fields.university,
      company: i.fields.company,
      certificates: i.fields.certificates,
      tags: i.fields.tags,
      age: i.fields.age,
      certStage: i.fields.certStage,
      certSubject: i.fields.certSubject,
      certQualified: i.fields.certQualified,
      gradYear: i.fields.gradYear,
      hometown: i.fields.hometown,
      fullTime: i.fields.fullTime,
      major: i.fields.major,
      idCard: i.fields.idCard,
      rawText: i.rawText.slice(0, 20000),
      source: i.method === 'ai' ? 'AI 解析' : '智能解析',
      stage: 'imported' as const,
      assigneeId: null,
      initialNote: `【${i.fileName} 解析导入】原文摘要：\n${i.rawText.slice(0, 400)}${i.rawText.length > 400 ? '……' : ''}`,
      }
    })
    const { unique, skipped } = filterDuplicateResumes(candidates, resumes)
    if (unique.length === 0) {
      toast.error('全部为重复简历（手机号/邮箱已存在），未导入')
      return
    }
    dispatch({ type: 'importResumes', actorId: currentUser.id, resumes: unique })
    // 原件存本机 IndexedDB（失败不阻断导入，但明确提示原件未保存）
    let fileSaveFail = 0
    for (const c of unique) {
      const f = fileByResumeId.get(c.id)
      if (f) {
        const ok = await saveResumeFile(c.id, f)
        if (!ok) fileSaveFail++
      }
    }
    toast.success(`成功导入 ${unique.length} 份简历${skipped > 0 ? `，跳过 ${skipped} 份重复` : ''}`)
    if (fileSaveFail > 0) {
      toast.warning(`${fileSaveFail} 份原件未能保存到本机存储（解析数据已正常入库，可在详情页重新上传原件）`)
    }
    navigate('/resumes')
  }

  function saveSettings() {
    saveLlmConfig(draftConfig)
    setLlmConfig(draftConfig)
    setSettingsOpen(false)
    toast.success(draftConfig.enabled ? 'AI 增强解析已启用' : '已保存，当前使用本地智能引擎')
  }

  /** 选择服务商预设：自动填端点与推荐模型，模型仍可手填覆盖 */
  function applyPreset(id: string) {
    const preset = LLM_PROVIDER_PRESETS.find((p) => p.id === id)
    if (!preset || preset.id === 'custom') return
    setDraftConfig({
      ...draftConfig,
      enabled: true,
      baseUrl: preset.baseUrl,
      model: preset.model,
      visionModel: preset.visionModel,
      // 无视觉能力的服务商自动关闭视觉识别，扫描件走本地 OCR
      visionEnabled: preset.hasVision ? draftConfig.visionEnabled : false,
    })
  }

  /** 测试连接：最小开销请求验证 接口地址 + 模型 + API Key 是否可用 */
  async function handleTestConnection() {
    if (!draftConfig.baseUrl.trim() || !draftConfig.apiKey.trim() || !draftConfig.model.trim()) {
      toast.error('请先填好接口地址、API Key 和模型（火山引擎填推理接入点 ID）')
      return
    }
    setTesting(true)
    try {
      await testLlmConnection(draftConfig)
      toast.success('连接成功！点击「保存设置」即可启用 AI 增强解析')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '连接失败，请检查配置')
    } finally {
      setTesting(false)
    }
  }

  const activePreset = matchProviderPreset(draftConfig.baseUrl)

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-indigo-600" />AI 简历解析
          </h1>
          <p className="text-sm text-slate-500">
            上传任意格式的简历文件，自动识别并抽取候选人信息，确认后批量入库。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={llmConfig.enabled ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'text-slate-500'}>
            <BrainCircuit className="mr-1 h-3.5 w-3.5" />
            {llmConfig.enabled ? 'AI 增强已启用' : '本地智能引擎'}
          </Badge>
          <Dialog open={settingsOpen} onOpenChange={(o) => { setSettingsOpen(o); if (o) setDraftConfig(llmConfig) }}>
            <DialogTrigger asChild>
              <Button variant="outline"><Settings className="mr-2 h-4 w-4" />解析设置</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>AI 增强解析设置</DialogTitle>
                <DialogDescription>
                  默认使用本地智能引擎（离线、免费）。配置任意 OpenAI 兼容接口后，可启用大模型增强解析，识别更复杂的简历版式。密钥仅保存在本机浏览器中。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="llm-enabled" className="cursor-pointer">启用 AI 增强解析</Label>
                  <Switch
                    id="llm-enabled"
                    checked={draftConfig.enabled}
                    onCheckedChange={(v) => setDraftConfig({ ...draftConfig, enabled: v })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>一键选择引擎</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {LLM_PROVIDER_PRESETS.map((p) => {
                      const active = (activePreset?.id ?? 'custom') === p.id
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyPreset(p.id)}
                          className={`rounded-lg border p-2.5 text-left transition-colors ${
                            active
                              ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                              : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40'
                          }`}
                        >
                          <p className={`text-sm font-medium ${active ? 'text-indigo-700' : 'text-slate-700'}`}>{p.name}</p>
                          {p.tagline && <p className="mt-0.5 text-[11px] leading-tight text-slate-400">{p.tagline}</p>}
                        </button>
                      )
                    })}
                  </div>
                  {activePreset?.note && (
                    <p className="text-xs leading-relaxed text-slate-400">{activePreset.note}</p>
                  )}
                </div>

                {/* 非技术用户三步引导（一键预设专属） */}
                {activePreset && activePreset.id !== 'custom' && activePreset.signupUrl && (
                  <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                    <p className="text-xs font-medium text-indigo-700">只需三步，完成配置：</p>
                    <ol className="space-y-1.5 text-xs leading-relaxed text-slate-600">
                      <li className="flex items-center gap-1.5">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">1</span>
                        <a
                          href={activePreset.signupUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
                        >
                          {activePreset.signupLabel ?? '打开官网注册'}<ExternalLink className="h-3 w-3" />
                        </a>
                        <span>，免费创建 API Key</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">2</span>
                        <span>把 API Key 粘贴到下方「API Key」一栏{activePreset.id === 'volcengine' ? '，并填入推理接入点 ID' : ''}</span>
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">3</span>
                        <span>点击「测试连接」，成功后保存设置</span>
                      </li>
                    </ol>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>接口地址（Base URL）</Label>
                  <Input
                    value={draftConfig.baseUrl}
                    onChange={(e) => setDraftConfig({ ...draftConfig, baseUrl: e.target.value })}
                    placeholder="https://open.bigmodel.cn/api/paas/v4"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    value={draftConfig.apiKey}
                    onChange={(e) => setDraftConfig({ ...draftConfig, apiKey: e.target.value })}
                    placeholder="粘贴你的 API Key"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{activePreset?.id === 'volcengine' ? '推理接入点 ID（作为模型名）' : '模型'}</Label>
                  <Input
                    value={draftConfig.model}
                    onChange={(e) => setDraftConfig({ ...draftConfig, model: e.target.value })}
                    placeholder={activePreset?.modelPlaceholder ?? 'glm-4-flash'}
                  />
                  {activePreset?.modelHint && (
                    <p className="text-xs leading-relaxed text-slate-400">{activePreset.modelHint}</p>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="vision-enabled" className="cursor-pointer">扫描件使用 AI 视觉识别</Label>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {activePreset && !activePreset.hasVision
                        ? '当前服务商无视觉模型，扫描件将使用本地 Tesseract OCR'
                        : '识别精度显著高于本地 OCR，适合模糊/复杂版式扫描件'}
                    </p>
                  </div>
                  <Switch
                    id="vision-enabled"
                    checked={draftConfig.visionEnabled}
                    disabled={activePreset ? !activePreset.hasVision : false}
                    onCheckedChange={(v) => setDraftConfig({ ...draftConfig, visionEnabled: v })}
                  />
                </div>
                {draftConfig.visionEnabled && (
                  <div className="space-y-1.5">
                    <Label>视觉模型{activePreset?.id === 'volcengine' ? '（填视觉模型的推理接入点 ID）' : ''}</Label>
                    <Input
                      value={draftConfig.visionModel}
                      onChange={(e) => setDraftConfig({ ...draftConfig, visionModel: e.target.value })}
                      placeholder={activePreset?.id === 'volcengine' ? 'ep-xxxxxxxxxxxx' : 'glm-4v-flash / gpt-4o'}
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" disabled={testing} onClick={handleTestConnection}>
                    {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                    测试连接
                  </Button>
                  <Button className="flex-1" onClick={saveSettings}>保存设置</Button>
                </div>
                <p className="text-xs leading-relaxed text-slate-400">
                  以上均为官方接口，非中转站；未配置时系统自动使用本地规则解析 + Tesseract OCR，无需任何费用
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 上传区 */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50/40 py-12 text-slate-600 transition-colors hover:border-indigo-500 hover:bg-indigo-50"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
            }}
          >
            <FileUp className="h-10 w-10 text-indigo-400" />
            <p className="font-medium">点击选择或拖拽简历文件到此处</p>
            <p className="text-xs text-slate-400">支持 PDF、DOCX、DOC、TXT、MD，可一次选择多份批量解析；扫描件图片型 PDF 自动启用 OCR 识别</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.txt,.md"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => setPasteOpen(!pasteOpen)}>
              <ClipboardPaste className="mr-2 h-4 w-4" />或直接粘贴简历文本
            </Button>
          </div>
          {pasteOpen && (
            <div className="space-y-2">
              <Textarea
                rows={8}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="把从任何地方复制的简历全文粘贴到这里……"
                className="text-sm"
              />
              <Button size="sm" onClick={handlePasteParse}>
                <Sparkles className="mr-2 h-3.5 w-3.5" />解析这份简历
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 解析结果 */}
      {items.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              解析结果（{doneItems.length}/{items.length} 完成）
            </h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setItems([])}>清空列表</Button>
              <Button size="sm" onClick={doImport} disabled={importable.length === 0}>
                <CheckCircle2 className="mr-2 h-4 w-4" />导入 {importable.length} 份到简历库
              </Button>
            </div>
          </div>

          {/* 解析队列进度条：已完成 x/总数（含失败项计入已完成） */}
          {items.some((i) => i.status === 'processing') && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.round(((doneItems.length + items.filter((i) => i.status === 'error').length) / items.length) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">
                已完成 {doneItems.length + items.filter((i) => i.status === 'error').length}/{items.length}
                （最多 3 份并发解析）
              </p>
            </div>
          )}

          {items.map((item) => (
            <Card key={item.id} className={item.status === 'error' ? 'border-rose-200' : ''}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-slate-400" />
                  {item.fileName}
                  {item.status === 'processing' && (
                    <Badge variant="secondary" title={item.progress}>
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />{item.progress ?? '解析中…'}
                    </Badge>
                  )}
                  {item.status === 'done' && (
                    <Badge className={item.method === 'ai' ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'}>
                      {item.method === 'ai' ? 'AI 解析' : '本地引擎'}
                    </Badge>
                  )}
                  {item.status === 'done' &&
                    matchDuplicates(
                      {
                        name: item.fields.name,
                        phone: item.fields.phone,
                        email: item.fields.email,
                        idCard: item.fields.idCard,
                        gradYear: item.fields.gradYear,
                      },
                      resumes,
                    ).length > 0 && (
                      <Badge variant="secondary" className="bg-slate-200 text-slate-500 hover:bg-slate-200" title="与简历库中已有简历疑似重复">
                        重复
                      </Badge>
                    )}
                  {item.status === 'error' && (
                    <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">
                      <AlertTriangle className="mr-1 h-3 w-3" />解析失败
                    </Badge>
                  )}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                >
                  <Trash2 className="h-4 w-4 text-slate-400" />
                </Button>
              </CardHeader>

              {item.status === 'error' && (
                <CardContent className="flex items-center justify-between gap-3">
                  <p className="text-sm text-rose-600">{item.error}</p>
                  {item.file && (
                    <Button variant="outline" size="sm" onClick={() => void retryOne(item)}>
                      重试
                    </Button>
                  )}
                </CardContent>
              )}

              {item.status === 'done' && (
                <CardContent className="space-y-3">
                  {item.fields.lowConfidence.length > 0 && (
                    <div className="space-y-1">
                      {item.fields.lowConfidence.some((f) => LOW_CONFIDENCE_FIELD_KEYS.includes(f)) && (
                        <p className="flex items-center gap-1.5 text-xs text-amber-600">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          高亮字段识别置信度较低，请人工确认后再导入。
                        </p>
                      )}
                      {/* 中文提醒类（身份证校验失败 / OCR 截断 / 多教师资格证 / 合格证明等）逐条展示 */}
                      {item.fields.lowConfidence
                        .filter((f) => !LOW_CONFIDENCE_FIELD_KEYS.includes(f))
                        .map((msg, i) => (
                          <p key={i} className="flex items-center gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{msg}
                          </p>
                        ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <FieldInput label="姓名" warn={item.fields.lowConfidence.includes('name')} value={item.fields.name} onChange={(v) => updateField(item.id, { name: v })} />
                    <FieldInput label="电话" warn={item.fields.lowConfidence.includes('phone')} value={item.fields.phone} onChange={(v) => updateField(item.id, { phone: v })} />
                    <FieldInput label="邮箱" warn={item.fields.lowConfidence.includes('email')} value={item.fields.email} onChange={(v) => updateField(item.id, { email: v })} />
                    <FieldInput label="应聘职位" warn={item.fields.lowConfidence.includes('position')} value={item.fields.position} onChange={(v) => updateField(item.id, { position: v })} />
                    <div className="space-y-1">
                      <Label className="text-xs">学历{item.fields.lowConfidence.includes('education') && <span className="ml-1 text-amber-500">●</span>}</Label>
                      <Select value={item.fields.education} onValueChange={(v) => updateField(item.id, { education: v })}>
                        <SelectTrigger className={item.fields.lowConfidence.includes('education') ? 'border-amber-400 bg-amber-50' : ''}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EDUCATION_OPTIONS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">工作年限</Label>
                      <Input
                        type="number"
                        min={0}
                        max={40}
                        value={item.fields.experience}
                        onChange={(e) => updateField(item.id, { experience: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">技能（用 、分隔）</Label>
                      <Input
                        value={item.fields.skills.join('、')}
                        onChange={(e) => updateField(item.id, { skills: e.target.value.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean) })}
                      />
                    </div>
                    {(item.fields.university || item.fields.company || item.fields.certStage || item.fields.certificates.length > 0 || item.fields.tags.length > 0) && (
                      <div className="col-span-2 space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
                          {item.fields.age > 0 && <span>年龄：{item.fields.age} 岁</span>}
                          {item.fields.gender && <span>性别：{item.fields.gender}</span>}
                          {item.fields.idCard && <span>身份证：{maskIdCard(item.fields.idCard)}</span>}
                          {item.fields.certStage && <span className="font-medium text-teal-700">{item.fields.certStage}{item.fields.certSubject}教资</span>}
                          {item.fields.university && <span>院校：{item.fields.university}{item.fields.fullTime !== '未知' ? `（${item.fields.fullTime}）` : ''}</span>}
                          {item.fields.major && <span>专业：{item.fields.major}</span>}
                          {item.fields.gradYear > 0 && <span>{item.fields.gradYear} 年毕业</span>}
                          {item.fields.hometown && <span>籍贯：{item.fields.hometown}</span>}
                          {item.fields.company && <span>最近任职：{item.fields.company}</span>}
                        </div>
                        {item.fields.certificates.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-slate-500">证书：</span>
                            {item.fields.certificates.map((c) => (
                              <Badge key={c} variant="secondary" className="bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700">{c}</Badge>
                            ))}
                          </div>
                        )}
                        {item.fields.tags.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-slate-500">智能标签：</span>
                            {item.fields.tags.map((t) => (
                              <Badge key={t} variant="outline" className={`px-1.5 py-0 text-[10px] ${tagColor(t)}`}>{t}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function emptyFields(): ParsedFields {
  return {
    name: '', phone: '', email: '', position: '', education: '未知', experience: 0,
    skills: [], university: '', company: '', certificates: [], tags: [],
    age: 0, certStage: '', certSubject: '', certQualified: false, gradYear: 0, hometown: '', fullTime: '未知', major: '',
    idCard: '', gender: '',
    lowConfidence: [],
  }
}

function FieldInput({ label, value, onChange, warn }: { label: string; value: string; onChange: (v: string) => void; warn?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}{warn && <span className="ml-1 text-amber-500">●</span>}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className={warn ? 'border-amber-400 bg-amber-50' : ''} />
    </div>
  )
}
