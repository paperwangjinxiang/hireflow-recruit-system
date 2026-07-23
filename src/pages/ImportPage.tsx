import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileUp, Download, ClipboardPaste, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useStore, filterDuplicateResumes } from '@/lib/store'
import { CSV_TEMPLATE, parseResumesFromCSV, type ParsedResume } from '@/lib/csv'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const SAMPLE_CSV = `姓名,电话,邮箱,应聘岗位,年龄,教资学段,教资科目,毕业院校,是否全日制,专业,毕业年份,籍贯,学历,工作年限,技能,来源
孙志远,13611112222,sunzy@example.com,高中语文教师,32,高中,语文,华中师范大学,全日制,汉语言文学,2015,湖北武汉,硕士,9,教学设计;作文指导;班主任工作,万行教师人才网
林晓梅,13733334444,linxm@example.com,初中数学教师,27,初中,数学,北京师范大学,全日制,数学与应用数学,2020,河南郑州,本科,4,教学设计;分层教学,内推
黄国强,13855556666,huanggq@example.com,小学英语教师,25,小学,英语,华东师范大学,全日制,英语（师范）,2022,江苏南京,本科,2,口语训练;家校沟通,校招双选会`

export default function ImportPage() {
  const { resumes, currentUser, dispatch } = useStore()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pasted, setPasted] = useState('')
  const [parsed, setParsed] = useState<ParsedResume[] | null>(null)
  const [fileName, setFileName] = useState('')

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
    </div>
  )
}
