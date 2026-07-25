import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Input } from '@/components/ui/input'

/** 简单图形验证码：随机加减法题，canvas 绘制带干扰线/噪点的图片（不依赖第三方服务，防简单 OCR） */

interface Question {
  a: number
  b: number
  op: '+' | '-'
  answer: number
  text: string
}

function makeQuestion(): Question {
  const op = Math.random() < 0.5 ? '+' : '-'
  let a = 3 + Math.floor(Math.random() * 17) // 3-19
  let b = 2 + Math.floor(Math.random() * 15) // 2-16
  if (op === '-' && b > a) [a, b] = [b, a] // 减法保证答案非负
  const answer = op === '+' ? a + b : a - b
  return { a, b, op, answer, text: `${a} ${op} ${b} = ?` }
}

const CHAR_COLORS = ['#334155', '#4f46e5', '#0f766e', '#b45309', '#be185d']

/** 在 canvas 上绘制题目：逐字随机角度/颜色 + 干扰曲线 + 噪点 */
function drawCaptcha(canvas: HTMLCanvasElement, text: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas

  // 背景
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, width, height)

  // 噪点
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(100,116,139,${0.25 + Math.random() * 0.35})`
    ctx.beginPath()
    ctx.arc(Math.random() * width, Math.random() * height, 0.6 + Math.random() * 1.2, 0, Math.PI * 2)
    ctx.fill()
  }

  // 干扰曲线
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `rgba(99,102,241,${0.15 + Math.random() * 0.25})`
    ctx.lineWidth = 1 + Math.random()
    ctx.beginPath()
    ctx.moveTo(Math.random() * width * 0.3, Math.random() * height)
    ctx.bezierCurveTo(
      Math.random() * width, Math.random() * height,
      Math.random() * width, Math.random() * height,
      width * 0.7 + Math.random() * width * 0.3, Math.random() * height,
    )
    ctx.stroke()
  }

  // 逐字绘制：随机字号、旋转、纵向抖动、颜色
  const chars = text.split('')
  const step = width / (chars.length + 1)
  chars.forEach((ch, i) => {
    ctx.save()
    const x = step * (i + 1)
    const y = height / 2 + (Math.random() - 0.5) * 8
    ctx.translate(x, y)
    ctx.rotate((Math.random() - 0.5) * 0.5)
    ctx.font = `${/^[0-9]$/.test(ch) ? 'bold ' : ''}${22 + Math.floor(Math.random() * 6)}px ui-monospace, monospace`
    ctx.fillStyle = CHAR_COLORS[Math.floor(Math.random() * CHAR_COLORS.length)]
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })
}

export interface MathCaptchaProps {
  /** 变化时重新出题并清空答案（父组件在提交后递增） */
  resetSignal: number
  /** 新题生成后回调正确答案，供父组件在提交时校验 */
  onQuestion: (answer: number) => void
  /** 用户输入（受控，由父组件持有以便提交时读取） */
  value: string
  onChange: (v: string) => void
}

export default function MathCaptcha({ resetSignal, onQuestion, value, onChange }: MathCaptchaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [question, setQuestion] = useState<Question>(makeQuestion)

  const regenerate = useCallback(() => {
    const q = makeQuestion()
    setQuestion(q)
    onQuestion(q.answer)
  }, [onQuestion])

  // 初次出题 + 外部要求重置时重新出题
  useEffect(() => {
    regenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  useEffect(() => {
    if (canvasRef.current) drawCaptcha(canvasRef.current, question.text)
  }, [question])

  return (
    <div className="flex items-stretch gap-2">
      <canvas
        ref={canvasRef}
        width={168}
        height={44}
        className="h-11 w-[168px] shrink-0 rounded-md border border-slate-200"
        aria-label={`验证码：${question.text.replace('?', '几')}`}
      />
      <Input
        className="h-11 flex-1 text-base"
        type="text"
        inputMode="numeric"
        maxLength={3}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        placeholder="计算结果"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={regenerate}
        title="看不清，换一题"
        aria-label="换一题"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-indigo-600"
      >
        <RefreshCw className="h-4 w-4" />
      </button>
    </div>
  )
}
