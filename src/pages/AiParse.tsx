import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Sparkles, FileText, FileUp, Settings, Trash2, CheckCircle2,
  AlertTriangle, Loader2, BrainCircuit, ClipboardPaste,
} from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import { detectKind, extractText } from '@/lib/extract'
import { parseResumeText, type ParsedFields } from '@/lib/parser'
import { tagColor } from '@/lib/tags'
import { getLlmConfig, saveLlmConfig, parseWithLlm, mergeParsed, type LlmConfig } from '@/lib/llm'
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
}

const EDUCATION_OPTIONS = ['博士', '硕士', '本科', '大专', '高中', '未知']

function uid() {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default function AiParse() {
  const { currentUser, dispatch } = useStore()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<FileItem[]>([])
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(getLlmConfig)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draftConfig, setDraftConfig] = useState<LlmConfig>(llmConfig)
  const [pasted, setPasted] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)

  const doneItems = items.filter((i) => i.status === 'done')
  const importable = doneItems.filter((i) => i.fields.name.trim())

  async function processOne(itemId: string, fileName: string, rawText: string) {
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
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: 'done', fields, method } : i)))
  }

  async function handleFiles(files: FileList | File[]) {
    const list = [...files]
    if (list.length === 0) return
    const pairs: { item: FileItem; file: File }[] = []
    for (const file of list) {
      if (!detectKind(file.name)) {
        toast.error(`不支持的格式：${file.name}（支持 PDF / DOCX / TXT / MD）`)
        continue
      }
      const item: FileItem = { id: uid(), fileName: file.name, status: 'processing', rawText: '', fields: emptyFields() }
      pairs.push({ item, file })
    }
    setItems((prev) => [...pairs.map((p) => p.item), ...prev])
    for (const { item, file } of pairs) {
      const setProgress = (msg: string) =>
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, progress: msg } : i)))
      try {
        const text = await extractText(file, setProgress)
        if (!text.trim()) throw new Error('OCR 也无法识别出文字，请上传更清晰的扫描件或文字版简历')
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, rawText: text, progress: '解析字段中…' } : i)))
        await processOne(item.id, item.fileName, text)
      } catch (e) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'error', error: e instanceof Error ? e.message : '解析失败' } : i)),
        )
      }
    }
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

  function doImport() {
    if (importable.length === 0) {
      toast.error('没有可导入的简历（姓名不能为空）')
      return
    }
    dispatch({
      type: 'importResumes',
      actorId: currentUser.id,
      resumes: importable.map((i) => ({
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
        gradYear: i.fields.gradYear,
        hometown: i.fields.hometown,
        fullTime: i.fields.fullTime,
        major: i.fields.major,
        source: i.method === 'ai' ? 'AI 解析' : '智能解析',
        stage: 'imported' as const,
        assigneeId: null,
        initialNote: `【${i.fileName} 解析导入】原文摘要：\n${i.rawText.slice(0, 400)}${i.rawText.length > 400 ? '……' : ''}`,
      })),
    })
    toast.success(`成功导入 ${importable.length} 份简历`)
    navigate('/resumes')
  }

  function saveSettings() {
    saveLlmConfig(draftConfig)
    setLlmConfig(draftConfig)
    setSettingsOpen(false)
    toast.success(draftConfig.enabled ? 'AI 增强解析已启用' : '已保存，当前使用本地智能引擎')
  }

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
                  <Label>接口地址（Base URL）</Label>
                  <Input
                    value={draftConfig.baseUrl}
                    onChange={(e) => setDraftConfig({ ...draftConfig, baseUrl: e.target.value })}
                    placeholder="https://api.moonshot.cn/v1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    value={draftConfig.apiKey}
                    onChange={(e) => setDraftConfig({ ...draftConfig, apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>模型</Label>
                  <Input
                    value={draftConfig.model}
                    onChange={(e) => setDraftConfig({ ...draftConfig, model: e.target.value })}
                    placeholder="moonshot-v1-8k"
                  />
                </div>
                <Button className="w-full" onClick={saveSettings}>保存设置</Button>
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
            <p className="text-xs text-slate-400">支持 PDF、DOCX、TXT、MD，可一次选择多份批量解析；扫描件图片型 PDF 自动启用 OCR 识别</p>
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
                <CardContent><p className="text-sm text-rose-600">{item.error}</p></CardContent>
              )}

              {item.status === 'done' && (
                <CardContent className="space-y-3">
                  {item.fields.lowConfidence.length > 0 && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      高亮字段识别置信度较低，请人工确认后再导入。
                    </p>
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
    age: 0, certStage: '', certSubject: '', gradYear: 0, hometown: '', fullTime: '未知', major: '',
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
