/** 项目的公开短链 slug:小写字母 + 数字,冲突时重试,极端情况加长。 */

function randomSlug(len = 8): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/** 生成一个当前库里不存在的 slug(创建项目 / 克隆精选案例共用) */
export async function newUniqueSlug(db: D1Database): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = randomSlug()
    const hit = await db.prepare('SELECT id FROM projects WHERE slug = ?').bind(slug).first()
    if (!hit) return slug
  }
  return randomSlug(12)
}
