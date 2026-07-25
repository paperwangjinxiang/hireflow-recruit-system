import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { encryptApplication, submitApplication } from '@/lib/applybox'
import { isValidIdCard } from '@/lib/regions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import MathCaptcha from '@/components/MathCaptcha'

/** 防重复提交：同一浏览器 10 分钟内只允许投递一次 */
const APPLY_LAST_KEY = 'hireflow-apply-last'
const APPLY_COOLDOWN_MS = 10 * 60 * 1000

const CERT_STAGE_OPTIONS = ['幼儿园', '小学', '初中', '高中', '持合格证明', '暂无']
const CERT_SUBJECT_OPTIONS = [
  '语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治',
  '音乐', '体育', '美术', '信息技术', '科学', '心理健康', '其他',
]
const EDUCATION_OPTIONS = ['博士', '硕士', '本科', '大专', '高中']
const FULLTIME_OPTIONS = ['全日制', '非全日制', '不确定']

const PHONE_RE = /^1[3-9]\d{9}$/

interface ApplyForm {
  name: string
  phone: string
  email: string
  idCard: string
  certStage: string
  certSubject: string
  education: string
  fullTime: string
  university: string
  major: string
  gradYear: string
  hometown: string
  experience: string
  region: string
  rawText: string
}

const EMPTY_FORM: ApplyForm = {
  name: '', phone: '', email: '', idCard: '',
  certStage: '', certSubject: '', education: '', fullTime: '',
  university: '', major: '', gradYear: '', hometown: '',
  experience: '', region: '', rawText: '',
}

/** 公开投递页（#/apply，免登录，移动端优先）：表单 → 浏览器内加密 → 提交到投递箱 */
export default function Apply() {
  const [searchParams] = useSearchParams()
  const jobId = searchParams.get('jobId')
  const jobName = searchParams.get('jobName') ?? ''

  const [form, setForm] = useState<ApplyForm>(EMPTY_FORM)
  // 蜜罐字段：正常用户不可见，机器人填了就静默假成功
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  // 图形验证码：答案由 MathCaptcha 出题后回调；resetSignal 递增即重新出题
  const [captchaInput, setCaptchaInput] = useState('')
  const [captchaReset, setCaptchaReset] = useState(0)
  const captchaAnswerRef = useRef<number | null>(null)

  const set = (key: keyof ApplyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))
  const setSel = (key: keyof ApplyForm) => (v: string) => setForm((f) => ({ ...f, [key]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    // 蜜罐命中：假装成功，实际丢弃
    if (honeypot) {
      setDone(true)
      return
    }
    // 10 分钟防重复提交
    const last = Number(localStorage.getItem(APPLY_LAST_KEY) ?? 0)
    if (Date.now() - last < APPLY_COOLDOWN_MS) {
      setError('您已投递过，请勿重复提交')
      return
    }
    // 必填与格式校验
    if (!form.name.trim()) {
      setError('请填写姓名')
      return
    }
    if (!PHONE_RE.test(form.phone.trim())) {
      setError('请填写正确的 11 位手机号')
      return
    }
    if (form.idCard.trim() && !isValidIdCard(form.idCard.trim())) {
      setError('身份证号校验失败，请检查')
      return
    }
    const gradYear = form.gradYear.trim() ? Number(form.gradYear) : 0
    if (gradYear && (gradYear < 1950 || gradYear > 2030)) {
      setError('毕业年份需在 1950-2030 之间')
      return
    }
    const experience = form.experience.trim() ? Number(form.experience) : 0
    if (experience < 0 || experience > 50) {
      setError('工作年限需在 0-50 之间')
      return
    }
    // 图形验证码校验：答错不能提交并刷新题目
    if (captchaAnswerRef.current === null || Number(captchaInput) !== captchaAnswerRef.current) {
      setError('验证码回答错误，请重新作答')
      setCaptchaInput('')
      setCaptchaReset((n) => n + 1)
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        idCard: form.idCard.trim(),
        certStage: form.certStage,
        certSubject: form.certSubject,
        education: form.education,
        fullTime: form.fullTime,
        university: form.university.trim(),
        major: form.major.trim(),
        gradYear,
        hometown: form.hometown.trim(),
        experience,
        region: form.region.trim(),
        rawText: form.rawText.slice(0, 20000),
      }
      // 浏览器内加密后再上传：投递箱中存的全是密文
      const envelope = await encryptApplication(JSON.stringify(payload))
      await submitApplication(envelope, { jobId, jobName })
      localStorage.setItem(APPLY_LAST_KEY, String(Date.now()))
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
      // 提交后无论成败都重置验证码，防止同一答案被重复利用
      setCaptchaInput('')
      setCaptchaReset((n) => n + 1)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white px-4 py-8">
      <div className="mx-auto max-w-md">
        {/* 学校 Logo 区 */}
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white shadow-lg">
            师
          </div>
          <div className="text-lg font-bold text-slate-800">HireFlow</div>
          <h1 className="text-xl font-bold text-slate-900">教师岗位在线投递</h1>
          {jobName && (
            <div className="rounded-full bg-indigo-100 px-4 py-1 text-sm font-medium text-indigo-700">
              投递职位：{jobName}
            </div>
          )}
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border bg-white p-10 text-center shadow-sm">
            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
            <div className="text-xl font-bold text-slate-900">投递成功！</div>
            <p className="text-sm leading-relaxed text-slate-500">
              HR 会尽快与你联系，请保持电话畅通
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
            {/* 蜜罐：视觉隐藏，id 含 website 诱使机器人填写 */}
            <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
              <label htmlFor="apply-website">网站</label>
              <input
                id="apply-website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            <Field label="姓名" required>
              <Input className="h-11 text-base" value={form.name} onChange={set('name')} placeholder="您的真实姓名" />
            </Field>
            <Field label="手机号" required>
              <Input
                className="h-11 text-base" type="tel" inputMode="numeric" maxLength={11}
                value={form.phone} onChange={set('phone')} placeholder="11 位手机号"
              />
            </Field>
            <Field label="邮箱">
              <Input className="h-11 text-base" type="email" value={form.email} onChange={set('email')} placeholder="选填" />
            </Field>
            <Field label="身份证号">
              <Input
                className="h-11 text-base" maxLength={18}
                value={form.idCard} onChange={set('idCard')} placeholder="选填，用于身份信息核对"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="教师资格证学段">
                <Select value={form.certStage} onValueChange={setSel('certStage')}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="请选择" /></SelectTrigger>
                  <SelectContent>
                    {CERT_STAGE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="教资科目">
                <Select value={form.certSubject} onValueChange={setSel('certSubject')}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="请选择" /></SelectTrigger>
                  <SelectContent>
                    {CERT_SUBJECT_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="最高学历">
                <Select value={form.education} onValueChange={setSel('education')}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="请选择" /></SelectTrigger>
                  <SelectContent>
                    {EDUCATION_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="是否全日制">
                <Select value={form.fullTime} onValueChange={setSel('fullTime')}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="请选择" /></SelectTrigger>
                  <SelectContent>
                    {FULLTIME_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="毕业院校">
              <Input className="h-11 text-base" value={form.university} onChange={set('university')} placeholder="如 华中师范大学" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="专业">
                <Input className="h-11 text-base" value={form.major} onChange={set('major')} placeholder="如 汉语言文学" />
              </Field>
              <Field label="毕业年份">
                <Input
                  className="h-11 text-base" type="number" min={1950} max={2030}
                  value={form.gradYear} onChange={set('gradYear')} placeholder="如 2020"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="籍贯">
                <Input className="h-11 text-base" value={form.hometown} onChange={set('hometown')} placeholder="如 湖北武汉" />
              </Field>
              <Field label="工作年限">
                <Input
                  className="h-11 text-base" type="number" min={0} max={50}
                  value={form.experience} onChange={set('experience')} placeholder="应届填 0"
                />
              </Field>
            </div>
            <Field label="意向片区">
              <Input className="h-11 text-base" value={form.region} onChange={set('region')} placeholder="如 东湖高新区" />
            </Field>
            <Field label="简历原文">
              <Textarea
                rows={8} maxLength={20000} className="text-base"
                value={form.rawText} onChange={set('rawText')}
                placeholder="可直接粘贴简历文字内容（教育经历、工作经历、证书等），不超过 20000 字"
              />
            </Field>

            <Field label="验证码" required>
              <MathCaptcha
                resetSignal={captchaReset}
                onQuestion={(answer) => { captchaAnswerRef.current = answer }}
                value={captchaInput}
                onChange={setCaptchaInput}
              />
            </Field>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}

            <Button type="submit" className="h-12 w-full text-base font-semibold" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />正在加密并提交…
                </>
              ) : error ? (
                <>
                  <RefreshCw className="mr-2 h-5 w-5" />重新提交
                </>
              ) : (
                '提交投递'
              )}
            </Button>
          </form>
        )}

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" />简历信息加密传输，仅招聘团队可见
        </p>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm text-slate-600">
        {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
      </Label>
      {children}
    </div>
  )
}
