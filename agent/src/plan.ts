/** 从 plan.json 文本解析规划(前端据此渲染规划卡片/展示),失败返回 null */

import type { Plan } from './types.js'

/** 从 plan.json 文本解析规划,失败返回 null(前端会退化为无规划卡片) */
export function parsePlan(text: string): Plan | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const palette = Array.isArray(raw.palette) ? (raw.palette as unknown[]).map(String).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)) : []
    const sections = Array.isArray(raw.sections)
      ? (raw.sections as Record<string, unknown>[]).slice(0, 8).map((s) => ({ title: String(s?.title ?? ''), summary: String(s?.summary ?? '') }))
      : []
    return {
      name: String(raw.name ?? ''),
      tagline: String(raw.tagline ?? ''),
      palette: palette.length ? palette : ['#6366f1', '#a855f7', '#f59e0b', '#e5e7eb'],
      sections,
    }
  } catch {
    return null
  }
}
