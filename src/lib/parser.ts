/** 本地智能解析引擎：从简历纯文本中抽取结构化字段（中文简历规则 + 技能词典） */

export interface ParsedFields {
  name: string
  phone: string
  email: string
  position: string
  education: string
  experience: number
  skills: string[]
  /** 各字段置信度：low 的字段会在 UI 中提示人工确认 */
  lowConfidence: string[]
}

const POSITION_KEYWORDS = [
  '前端工程师', '前端开发', '后端工程师', '后端开发', '全栈工程师', 'Java工程师', 'Python工程师',
  '算法工程师', '机器学习工程师', '深度学习工程师', '数据分析师', '数据工程师', '大数据工程师',
  '测试工程师', '测试开发', 'QA工程师', '运维工程师', 'DevOps工程师', '安全工程师',
  '产品经理', '产品总监', '项目经理', 'UI设计师', 'UX设计师', '交互设计师', '视觉设计师',
  '运营专员', '运营经理', '市场专员', '市场经理', '销售代表', '销售经理', '客户经理',
  '人事专员', 'HRBP', '财务专员', '会计', '法务专员', '行政专员', '客服专员',
  'Android工程师', 'iOS工程师', '移动端工程师', '嵌入式工程师', '硬件工程师', '架构师',
]

const SKILL_DICT = [
  'JavaScript', 'TypeScript', 'React', 'Vue', 'Angular', 'Node.js', 'Next.js', 'Webpack', 'Vite',
  'HTML', 'CSS', 'Sass', 'Less', 'Tailwind', '小程序', 'uni-app', 'Flutter', 'React Native',
  'Java', 'Spring Boot', 'Spring Cloud', 'MyBatis', 'Kotlin', 'Scala', 'Go', 'Golang', 'Rust', 'C++', 'C#', '.NET', 'PHP', 'Laravel',
  'Python', 'Django', 'Flask', 'FastAPI', 'Pandas', 'NumPy', 'PyTorch', 'TensorFlow', '机器学习', '深度学习', 'NLP', '计算机视觉',
  'MySQL', 'PostgreSQL', 'Oracle', 'SQL Server', 'Redis', 'MongoDB', 'Elasticsearch', 'Kafka', 'RabbitMQ', 'ClickHouse',
  'Linux', 'Docker', 'Kubernetes', 'K8s', 'CI/CD', 'Jenkins', 'Git', 'AWS', '阿里云', '腾讯云', '微服务', '分布式',
  'SQL', 'Excel', 'Tableau', 'Power BI', 'SPSS', '数据仓库', '数据挖掘', 'AB测试',
  'Figma', 'Sketch', 'Photoshop', 'Illustrator', 'Axure', '交互设计', '视觉设计', 'UI设计', '原型设计',
  'Selenium', 'JMeter', 'Postman', '自动化测试', '性能测试', '接口测试',
  '产品规划', '需求分析', '用户研究', '数据分析', '项目管理', '敏捷开发', 'Scrum', 'Jira',
  'SEO', 'SEM', '内容运营', '用户运营', '活动策划', '新媒体运营', '私域运营',
]

const EDU_RANK: [string, number][] = [
  ['博士后', 6], ['博士', 5], ['PhD', 5], ['MBA', 4], ['硕士', 4], ['研究生', 4],
  ['本科', 3], ['学士', 3], ['统招本科', 3], ['大专', 2], ['专科', 2], ['高中', 1], ['中专', 1],
]

const NAME_STOPWORDS = ['简历', '求职', '应聘', '个人', '电话', '手机', '邮箱', '地址', '男', '女', '岁', '学历', '经验', '本科', '硕士', '大专', '期望', '意向']

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

function extractName(ls: string[], fileName: string): { name: string; confident: boolean } {
  // 1. 显式「姓名：」标注
  for (const l of ls.slice(0, 10)) {
    const m = l.match(/姓\s*名[:：\s]\s*([一-龥·]{2,5})/) ?? l.match(/Name[:：\s]\s*([A-Za-z][A-Za-z\s.]{1,30})/i)
    if (m) return { name: m[1].trim(), confident: true }
  }
  // 2. 前 6 行中纯中文名
  for (const l of ls.slice(0, 6)) {
    const clean = l.replace(/\s+/g, '')
    if (/^[一-龥·]{2,4}$/.test(clean) && !NAME_STOPWORDS.some((w) => clean.includes(w))) {
      return { name: clean, confident: true }
    }
  }
  // 3. 文件名推断（如「张三-前端工程师.pdf」）
  const stem = fileName.replace(/\.[^.]+$/, '')
  for (const token of stem.split(/[-_—–\s]+/)) {
    if (/^[一-龥·]{2,4}$/.test(token) && !NAME_STOPWORDS.some((w) => token.includes(w))) {
      return { name: token, confident: false }
    }
  }
  return { name: '', confident: false }
}

function extractPosition(text: string): { position: string; confident: boolean } {
  const m = text.match(/(?:求职意向|意向岗位|意向职位|应聘职位|期望职位|目标职位|求职岗位)[:：\s]*([^\n，,；;|]{2,20})/)
  if (m) return { position: m[1].trim(), confident: true }
  for (const kw of POSITION_KEYWORDS) {
    if (text.includes(kw)) return { position: kw, confident: false }
  }
  return { position: '', confident: false }
}

function extractEducation(text: string): string {
  let best = ''
  let bestRank = 0
  for (const [label, rank] of EDU_RANK) {
    if (rank > bestRank && text.toLowerCase().includes(label.toLowerCase())) {
      best = label
      bestRank = rank
    }
  }
  if (best === 'PhD') return '博士'
  if (best === '研究生' || best === 'MBA') return '硕士'
  if (best === '学士' || best === '统招本科') return '本科'
  if (best === '专科') return '大专'
  return best
}

function extractExperience(text: string): number {
  // 1. 显式「X年经验」（含「5年前端开发经验」等写法；前置非数字防止误匹配「2018年」）
  const m = text.match(/(?<!\d)(\d{1,2})\s*年(?:以上)?[一-龥A-Za-z]{0,6}?经验/) ?? text.match(/(?<!\d)(\d{1,2})\s*\+?\s*years?/i)
  if (m) return Math.min(Number(m[1]), 40)
  // 2. 工作时间段推断：取「20XX.XX - 至今/20XX」模式中的最早年份
  const years: number[] = []
  const rangeRe = /((?:19|20)\d{2})\s*[年./-]\s*\d{0,2}\s*[月]?\s*[-—–~至]\s*(?:至今|现在|now|((?:19|20)\d{2}))/gi
  let r: RegExpExecArray | null
  while ((r = rangeRe.exec(text)) !== null) years.push(Number(r[1]))
  if (years.length > 0) {
    const earliest = Math.min(...years)
    const exp = new Date().getFullYear() - earliest
    if (exp >= 0 && exp <= 40) return exp
  }
  return 0
}

function extractSkills(text: string): string[] {
  const lower = text.toLowerCase()
  const found = new Set<string>()
  for (const skill of SKILL_DICT) {
    const s = skill.toLowerCase()
    if (lower.includes(s)) {
      // 避免 Golang/Go、K8s/Kubernetes 重复
      if (skill === 'Go' && found.has('Golang')) continue
      if (skill === 'Golang' && found.has('Go')) continue
      if (skill === 'K8s' && found.has('Kubernetes')) continue
      if (skill === 'Kubernetes' && found.has('K8s')) continue
      found.add(skill)
    }
  }
  return [...found].slice(0, 12)
}

/** 解析简历文本，返回结构化字段与低置信度字段列表 */
export function parseResumeText(text: string, fileName: string): ParsedFields {
  const ls = lines(text)
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? ''
  const phone = text.match(/(?<!\d)1[3-9]\d{9}(?!\d)/)?.[0] ?? ''
  const { name, confident: nameOk } = extractName(ls, fileName)
  const { position, confident: posOk } = extractPosition(text)
  const education = extractEducation(text)
  const experience = extractExperience(text)
  const skills = extractSkills(text)

  const lowConfidence: string[] = []
  if (!name || !nameOk) lowConfidence.push('name')
  if (!position || !posOk) lowConfidence.push('position')
  if (!phone) lowConfidence.push('phone')
  if (!email) lowConfidence.push('email')
  if (!education) lowConfidence.push('education')

  return {
    name, phone, email,
    position: position || '未指定',
    education: education || '未知',
    experience,
    skills,
    lowConfidence,
  }
}
