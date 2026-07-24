import type { Interview, Job, Resume, Stage, User, CertStage, FullTime } from '@/types'
import { deriveTags } from '@/lib/tags'

export const SEED_USERS: User[] = [
  { id: 'u-admin', name: '林总监', role: 'admin', email: 'admin@hireflow.cn', color: '#6366f1' },
  { id: 'u-hr1', name: '王晓芸', role: 'hr', email: 'wangxy@hireflow.cn', color: '#f59e0b' },
  { id: 'u-hr2', name: '陈立群', role: 'hr', email: 'chenlq@hireflow.cn', color: '#10b981' },
  { id: 'u-int1', name: '张一鸣', role: 'interviewer', email: 'zhangym@hireflow.cn', color: '#3b82f6' },
  { id: 'u-int2', name: '赵思琪', role: 'interviewer', email: 'zhaosq@hireflow.cn', color: '#ec4899' },
]

interface TeacherSeed {
  name: string
  subject: string // 任教学科
  certStage: CertStage
  major: string
  university: string
  fullTime: FullTime
  education: string
  age: number
  gradYear: number
  hometown: string
  experience: number
  school: string // 最近任职学校
  skills: string[]
  certs: string[]
}

const TEACHERS: TeacherSeed[] = [
  { name: '刘子涵', subject: '语文', certStage: '高中', major: '汉语言文学', university: '华中师范大学', fullTime: '全日制', education: '硕士', age: 28, gradYear: 2021, hometown: '湖北武汉', experience: 4, school: '武汉市第二中学', skills: ['教学设计', '班级管理', '作文指导', '公开课'], certs: ['教师资格证', '普通话一级乙等' as string, 'CET-6'] },
  { name: '李思远', subject: '数学', certStage: '高中', major: '数学与应用数学', university: '北京师范大学', fullTime: '全日制', education: '本科', age: 26, gradYear: 2022, hometown: '河南郑州', experience: 3, school: '郑州外国语学校', skills: ['教学设计', '竞赛辅导', '学情分析', '中高考备考'], certs: ['教师资格证', 'CET-6'] },
  { name: '周雅婷', subject: '英语', certStage: '初中', major: '英语（师范）', university: '华东师范大学', fullTime: '全日制', education: '本科', age: 25, gradYear: 2023, hometown: '江苏南京', experience: 2, school: '南京树人学校', skills: ['口语训练', '教学设计', '家校沟通', '分层教学'], certs: ['教师资格证', '专八', '普通话二级甲等'] },
  { name: '吴浩然', subject: '物理', certStage: '高中', major: '物理学', university: '武汉大学', fullTime: '全日制', education: '硕士', age: 30, gradYear: 2019, hometown: '湖南长沙', experience: 6, school: '长沙雅礼中学', skills: ['教学设计', '试卷命题', '中高考备考', '教研活动'], certs: ['教师资格证', 'CET-6'] },
  { name: '郑晓峰', subject: '化学', certStage: '高中', major: '化学（师范）', university: '陕西师范大学', fullTime: '全日制', education: '本科', age: 35, gradYear: 2013, hometown: '陕西西安', experience: 12, school: '西安高新一中', skills: ['教学设计', '班主任工作', '试卷命题', '中高考备考', '教研活动'], certs: ['教师资格证', '普通话二级甲等'] },
  { name: '孙雨桐', subject: '语文', certStage: '小学', major: '小学教育', university: '南京师范大学', fullTime: '全日制', education: '本科', age: 24, gradYear: 2024, hometown: '安徽合肥', experience: 1, school: '合肥师范附小', skills: ['教学设计', '班级管理', '书法', '家校沟通'], certs: ['教师资格证', '普通话一级乙等' as string] },
  { name: '马俊杰', subject: '数学', certStage: '初中', major: '数学与应用数学', university: '西南大学', fullTime: '全日制', education: '本科', age: 27, gradYear: 2021, hometown: '重庆', experience: 4, school: '重庆巴蜀中学', skills: ['教学设计', '奥数辅导', '分层教学', '学情分析'], certs: ['教师资格证', 'CET-4'] },
  { name: '朱佩珊', subject: '英语', certStage: '高中', major: '英语语言文学', university: '广东外语外贸大学', fullTime: '全日制', education: '硕士', age: 29, gradYear: 2020, hometown: '广东广州', experience: 5, school: '广州执信中学', skills: ['口语训练', '教学设计', '公开课', '中高考备考'], certs: ['教师资格证', '专八', '雅思'] },
  { name: '胡文博', subject: '历史', certStage: '初中', major: '历史学', university: '东北师范大学', fullTime: '全日制', education: '本科', age: 31, gradYear: 2017, hometown: '辽宁沈阳', experience: 8, school: '沈阳第七中学', skills: ['教学设计', '班主任工作', '校本课程', '听课评课'], certs: ['教师资格证', '普通话二级甲等'] },
  { name: '郭嘉怡', subject: '音乐', certStage: '小学', major: '音乐学（师范）', university: '星海音乐学院', fullTime: '全日制', education: '本科', age: 26, gradYear: 2022, hometown: '广东深圳', experience: 3, school: '深圳实验小学', skills: ['教学设计', '社团指导', '公开课', '合唱指挥' as string], certs: ['教师资格证', '普通话二级甲等'] },
  { name: '何志远', subject: '体育', certStage: '初中', major: '体育教育', university: '武汉体育学院', fullTime: '全日制', education: '本科', age: 28, gradYear: 2020, hometown: '湖北宜昌', experience: 5, school: '宜昌第一中学', skills: ['教学设计', '社团指导', '班级管理', '运动会组织' as string], certs: ['教师资格证'] },
  { name: '高梦洁', subject: '生物', certStage: '高中', major: '生物科学', university: '华中农业大学', fullTime: '全日制', education: '硕士', age: 27, gradYear: 2022, hometown: '湖北襄阳', experience: 3, school: '襄阳第五中学', skills: ['教学设计', '实验教学' as string, '学情分析', '教研活动'], certs: ['教师资格证', 'CET-6'] },
  { name: '罗建国', subject: '数学', certStage: '高中', major: '数学与应用数学', university: '华中师范大学', fullTime: '非全日制', education: '本科', age: 42, gradYear: 2005, hometown: '湖北黄冈', experience: 20, school: '黄冈中学', skills: ['教学设计', '班主任工作', '中高考备考', '试卷命题', '竞赛辅导'], certs: ['教师资格证', '普通话二级甲等'] },
  { name: '梁诗涵', subject: '语文', certStage: '初中', major: '汉语言文学（师范）', university: '湖南师范大学', fullTime: '全日制', education: '本科', age: 23, gradYear: 2025, hometown: '湖南株洲', experience: 0, school: '应届毕业生', skills: ['教学设计', '说课', '试讲', '书法'], certs: ['教师资格证', '普通话一级乙等' as string, 'CET-6'] },
  { name: '宋启铭', subject: '地理', certStage: '高中', major: '地理科学', university: '南京大学', fullTime: '全日制', education: '硕士', age: 26, gradYear: 2023, hometown: '江西南昌', experience: 2, school: '南昌第二中学', skills: ['教学设计', '多媒体教学', '学情分析'], certs: ['教师资格证', 'CET-6'] },
  { name: '唐晓蕾', subject: '政治', certStage: '初中', major: '思想政治教育', university: '西南大学', fullTime: '全日制', education: '本科', age: 29, gradYear: 2019, hometown: '四川成都', experience: 6, school: '成都第七中学', skills: ['教学设计', '班主任工作', '德育工作', '家校沟通'], certs: ['教师资格证', '普通话二级甲等'] },
  { name: '韩志强', subject: '物理', certStage: '初中', major: '物理学（师范）', university: '首都师范大学', fullTime: '全日制', education: '本科', age: 33, gradYear: 2015, hometown: '河北石家庄', experience: 10, school: '石家庄外国语学校', skills: ['教学设计', '实验教学' as string, '班主任工作', '教研活动'], certs: ['教师资格证'] },
  { name: '冯佳琪', subject: '英语', certStage: '小学', major: '英语（师范）', university: '天津师范大学', fullTime: '全日制', education: '本科', age: 24, gradYear: 2024, hometown: '天津', experience: 1, school: '天津和平区中心小学', skills: ['口语训练', '教学设计', '家校沟通'], certs: ['教师资格证', '专四', '普通话二级甲等'] },
  { name: '董浩然', subject: '信息技术', certStage: '高中', major: '计算机科学与技术（师范）', university: '华中科技大学', fullTime: '全日制', education: '本科', age: 27, gradYear: 2021, hometown: '湖北武汉', experience: 4, school: '武汉水果湖中学', skills: ['教学设计', '智慧课堂', '竞赛辅导', '项目式学习'], certs: ['教师资格证', 'CET-6'] },
  { name: '萧雅静', subject: '美术', certStage: '小学', major: '美术学（师范）', university: '湖北美术学院', fullTime: '全日制', education: '本科', age: 25, gradYear: 2023, hometown: '湖北孝感', experience: 2, school: '武汉育才小学', skills: ['教学设计', '社团指导', '公开课'], certs: ['教师资格证', '普通话二级甲等'] },
  { name: '程立诚', subject: '语文', certStage: '高中', major: '汉语言文学', university: '武汉大学', fullTime: '全日制', education: '硕士', age: 32, gradYear: 2017, hometown: '湖北荆州', experience: 8, school: '荆州中学', skills: ['教学设计', '作文指导', '班主任工作', '中高考备考'], certs: ['教师资格证', '普通话一级乙等' as string] },
  { name: '曹欣然', subject: '心理健康', certStage: '初中', major: '应用心理学', university: '华中师范大学', fullTime: '全日制', education: '硕士', age: 28, gradYear: 2021, hometown: '河南洛阳', experience: 4, school: '洛阳外国语学校', skills: ['心理辅导', '德育工作', '家校沟通', '团体辅导' as string], certs: ['教师资格证', '心理咨询师'] },
  { name: '袁志明', subject: '数学', certStage: '小学', major: '小学教育（数学方向）', university: '湖北师范大学', fullTime: '全日制', education: '本科', age: 26, gradYear: 2022, hometown: '湖北黄石', experience: 3, school: '黄石广场路小学', skills: ['教学设计', '分层教学', '班级管理'], certs: ['教师资格证', '普通话二级甲等'] },
  { name: '邓雨欣', subject: '化学', certStage: '初中', major: '化学（师范）', university: '华南师范大学', fullTime: '全日制', education: '本科', age: 23, gradYear: 2025, hometown: '广东佛山', experience: 0, school: '应届毕业生', skills: ['教学设计', '说课', '实验教学' as string], certs: ['教师资格证', 'CET-6', '普通话二级甲等'] },
]

const STAGES: Stage[] = ['imported', 'imported', 'screening', 'screening', 'matched', 'matched', 'interview', 'interview', 'offered', 'onboarded', 'rejected', 'blacklisted']
const SOURCES = ['BOSS直聘', '智联招聘', '万行教师人才网', '内推', '猎聘', '官网投递', '校招双选会']

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]
}

export function seedResumes(): Resume[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  return TEACHERS.map((t, i) => {
    const stage = pick(STAGES, i)
    const assigneeId = stage === 'imported' ? null : pick(['u-hr1', 'u-hr2', 'u-int1', 'u-int2'], i)
    const created = now - (i + 1) * day * 1.3
    const id = `r-seed-${i + 1}`
    const matchedJob = stage === 'matched' || stage === 'interview' || stage === 'offered' ? `j-seed-${(i % 5) + 1}` : null
    return {
      id,
      name: t.name,
      phone: `138${String(10000000 + i * 137913).slice(0, 8)}`,
      email: `candidate${i + 1}@example.com`,
      position: `${t.certStage}${t.subject}教师`,
      education: t.education,
      experience: t.experience,
      skills: t.skills,
      source: pick(SOURCES, i),
      stage,
      assigneeId,
      university: t.university,
      company: t.school,
      certificates: t.certs,
      tags: deriveTags({
        education: t.education,
        experience: t.experience,
        certificates: t.certs,
        university: t.university,
        company: t.school,
        major: t.major,
        certStage: t.certStage,
        skills: t.skills,
      }),
      rating: i % 5 === 0 ? 4 : i % 5 === 1 ? 5 : i % 3,
      age: t.age,
      certStage: t.certStage,
      certSubject: t.subject,
      certQualified: false,
      gradYear: t.gradYear,
      hometown: t.hometown,
      fullTime: t.fullTime,
      major: t.major,
      idCard: '',
      rawText: '',
      jobId: matchedJob,
      lockedBy: matchedJob ? pick(['u-hr1', 'u-hr2'], i) : null,
      lockedAt: matchedJob ? created + day : null,
      createdAt: created,
      updatedAt: created + day * 0.5,
      notes:
        i % 4 === 0
          ? [
              {
                id: `n-${id}`,
                authorId: 'u-hr1',
                content: '试讲表现优秀，课堂节奏把控好，学生互动积极，建议尽快推进。',
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

/** 种子职位：片区学校教师岗位 */
export function seedJobs(): Job[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const jobs: Array<Omit<Job, 'id' | 'createdAt'>> = [
    { region: '东湖高新区', school: '光谷实验中学', level: '初中', subject: '语文', dormitory: true, headcount: 2, status: 'open', note: '需班主任经验优先' },
    { region: '东湖高新区', school: '光谷实验中学', level: '初中', subject: '数学', dormitory: true, headcount: 2, status: 'open', note: '' },
    { region: '江岸区', school: '武汉市第二中学', level: '高中', subject: '物理', dormitory: false, headcount: 1, status: 'open', note: '高三教学经验' },
    { region: '武昌区', school: '水果湖第一小学', level: '小学', subject: '英语', dormitory: false, headcount: 2, status: 'open', note: '' },
    { region: '洪山区', school: '卓刀泉中学', level: '初中', subject: '化学', dormitory: true, headcount: 1, status: 'open', note: '' },
    { region: '江汉区', school: '常青第一中学', level: '高中', subject: '语文', dormitory: true, headcount: 1, status: 'open', note: '可接受应届生' },
    { region: '硚口区', school: '崇仁路小学', level: '小学', subject: '数学', dormitory: false, headcount: 2, status: 'open', note: '' },
    { region: '汉阳区', school: '武汉第三寄宿中学', level: '初中', subject: '英语', dormitory: true, headcount: 1, status: 'closed', note: '已招满' },
  ]
  return jobs.map((j, i) => ({ ...j, id: `j-seed-${i + 1}`, createdAt: now - (i + 2) * day * 2 }))
}

/** 为「面试」阶段的种子简历生成示例面试安排 */
export function seedInterviews(resumes: Resume[]): Interview[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const hour = 60 * 60 * 1000
  const interviewing = resumes.filter((r) => r.stage === 'interview')
  const result: Interview[] = []
  interviewing.forEach((r, i) => {
    result.push({
      id: `iv-${r.id}-1`,
      resumeId: r.id,
      round: '试讲',
      time: now - (i + 1) * day + 14 * hour,
      interviewerId: 'u-int1',
      location: '学校 3F 录播教室',
      result: i % 3 === 2 ? 'fail' : 'pass',
      feedback: i % 3 === 2 ? '教学设计不够贴合学情，课堂互动偏少。' : '试讲结构完整，重难点突出，师生互动自然，建议进入校长面。',
      createdAt: now - (i + 2) * day,
    })
    if (i % 3 !== 2) {
      result.push({
        id: `iv-${r.id}-2`,
        resumeId: r.id,
        round: '校长面',
        time: now + (i % 4 + 1) * day + (10 + i) * hour,
        interviewerId: 'u-int2',
        location: i % 2 === 0 ? '学校行政楼会议室' : '腾讯会议 762-410-553',
        result: 'pending',
        feedback: '',
        createdAt: now - day,
      })
    }
  })
  return result
}
