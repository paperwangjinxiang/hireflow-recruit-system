/** 公开投递页地址（GitHub Pages 部署地址） */
export const APPLY_PAGE_URL = 'https://paperwangjinxiang.github.io/hireflow-recruit-system/#/apply'

/** 构造投递链接：带职位时追加 jobId / jobName query */
export function buildApplyUrl(job?: { id: string; name: string }): string {
  if (!job) return APPLY_PAGE_URL
  return `${APPLY_PAGE_URL}?jobId=${encodeURIComponent(job.id)}&jobName=${encodeURIComponent(job.name)}`
}
