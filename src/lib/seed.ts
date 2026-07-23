import type { Interview, Resume, Stage, User } from '@/types'

export const SEED_USERS: User[] = [
  { id: 'u-admin', name: '林总监', role: 'admin', email: 'admin@hireflow.cn', color: '#6366f1' },
  { id: 'u-hr1', name: '王晓芸', role: 'hr', email: 'wangxy@hireflow.cn', color: '#f59e0b' },
  { id: 'u-hr2', name: '陈立群', role: 'hr', email: 'chenlq@hireflow.cn', color: '#10b981' },
  { id: 'u-int1', name: '张一鸣', role: 'interviewer', email: 'zhangym@hireflow.cn', color: '#3b82f6' },
  { id: 'u-int2', name: '赵思琪', role: 'interviewer', email: 'zhaosq@hireflow.cn', color: '#ec4899' },
]

const NAMES = [
  '刘子涵', '李思远', '周雅婷', '吴浩然', '郑晓峰', '孙雨桐', '马俊杰', '朱佩珊',
  '胡文博', '郭嘉怡', '何志远', '高梦洁', '罗建国', '梁诗涵', '宋启铭', '唐晓蕾',
  '韩志强', '冯佳琪', '董浩然', '萧雅静', '程立诚', '曹欣然', '袁志明', '邓雨欣',
]

const POSITIONS = ['前端工程师', '后端工程师', '产品经理', 'UI设计师', '测试工程师', '数据分析师', '算法工程师', '运营专员']
const EDUCATIONS = ['博士', '硕士', '本科', '大专']
const SOURCES = ['BOSS直聘', '智联招聘', '拉勾网', '内推', '猎聘', '官网投递']
const SKILL_POOL = [
  ['React', 'TypeScript', 'Vue', 'Node.js'],
  ['Java', 'Spring Boot', 'MySQL', 'Redis'],
  ['Python', 'Pandas', 'SQL', '机器学习'],
  ['Figma', 'Sketch', 'Photoshop', '交互设计'],
  ['Selenium', 'JMeter', '自动化测试', 'Python'],
  ['产品规划', 'Axure', '数据分析', '用户研究'],
]
const STAGES: Stage[] = ['new', 'new', 'screening', 'screening', 'interview', 'interview', 'offer', 'hired', 'rejected']

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]
}

export function seedResumes(): Resume[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  return NAMES.map((name, i) => {
    const stage = pick(STAGES, i)
    const assigneeId =
      stage === 'new' ? null : pick(['u-hr1', 'u-hr2', 'u-int1', 'u-int2'], i)
    const created = now - (i + 1) * day * 1.3
    const id = `r-seed-${i + 1}`
    return {
      id,
      name,
      phone: `138${String(10000000 + i * 137913).slice(0, 8)}`,
      email: `candidate${i + 1}@example.com`,
      position: pick(POSITIONS, i),
      education: pick(EDUCATIONS, i + 1),
      experience: (i * 3 + 1) % 12,
      skills: pick(SKILL_POOL, i),
      source: pick(SOURCES, i),
      stage,
      assigneeId,
      createdAt: created,
      updatedAt: created + day * 0.5,
      notes:
        i % 4 === 0
          ? [
              {
                id: `n-${id}`,
                authorId: 'u-hr1',
                content: '候选人沟通顺畅，期望薪资在预算范围内，建议尽快安排面试。',
                createdAt: created + day * 0.4,
              },
            ]
          : [],
      activities: [
        { id: `a-${id}-1`, actorId: 'u-admin', action: '导入简历', createdAt: created },
        ...(assigneeId
          ? [{ id: `a-${id}-2`, actorId: 'u-hr1', action: `分配给 ${SEED_USERS.find((u) => u.id === assigneeId)?.name}`, createdAt: created + day * 0.2 }]
          : []),
      ],
    }
  })
}

/** 为「面试中」阶段的种子简历生成示例面试安排 */
export function seedInterviews(resumes: Resume[]): Interview[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const hour = 60 * 60 * 1000
  const interviewing = resumes.filter((r) => r.stage === 'interview')
  const result: Interview[] = []
  interviewing.forEach((r, i) => {
    // 一场已完成的面试（有结果）
    result.push({
      id: `iv-${r.id}-1`,
      resumeId: r.id,
      round: '一面',
      time: now - (i + 1) * day + 14 * hour,
      interviewerId: 'u-int1',
      location: '腾讯会议 583-221-096',
      result: i % 3 === 2 ? 'fail' : 'pass',
      feedback: i % 3 === 2 ? '基础不够扎实，与岗位要求有差距。' : '专业基础扎实，沟通表达清晰，建议进入下一轮。',
      createdAt: now - (i + 2) * day,
    })
    // 部分候选人安排本周内的下一场面试
    if (i % 3 !== 2) {
      result.push({
        id: `iv-${r.id}-2`,
        resumeId: r.id,
        round: '二面',
        time: now + (i % 4 + 1) * day + (10 + i) * hour,
        interviewerId: 'u-int2',
        location: i % 2 === 0 ? '公司 3F 会议室 A' : '腾讯会议 762-410-553',
        result: 'pending',
        feedback: '',
        createdAt: now - day,
      })
    }
  })
  return result
}
