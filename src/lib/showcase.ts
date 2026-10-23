/**
 * 首页精选案例的标签规则(后台写入、公开页读取共用)。
 * 存库格式是逗号分隔的短文本;不是数据库约束,写入前统一归一化,避免首页出现重复/超长标签。
 */

export const SHOWCASE_MAX_TAGS = 5
export const SHOWCASE_TAG_MAX_LEN = 20

/** 把后台输入(字符串或数组)归一化成最多 5 个去重标签 */
export function normalizeShowcaseTags(input: unknown): string[] {
  const raw = typeof input === 'string' ? input : Array.isArray(input) ? input.map((x) => String(x)).join(',') : ''
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,，]/)) {
    const tag = part.trim().replace(/\s+/g, ' ').slice(0, SHOWCASE_TAG_MAX_LEN)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= SHOWCASE_MAX_TAGS) break
  }
  return out
}

/** 存库字符串 → 标签数组(损坏/旧数据不报错,直接按空处理) */
export function splitShowcaseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, SHOWCASE_MAX_TAGS)
}

export function showcaseTagsText(tags: string[]): string {
  return tags.join(',')
}
