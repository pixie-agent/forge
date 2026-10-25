/** 时间与字节的展示格式化工具(统一按浏览器本地时区显示) */

import type { DictKey } from './i18n'

/**
 * 把库里的时间戳解析成 Date。
 * 库里存的是 SQLite `datetime('now')`(UTC、无时区标记,如 `2026-10-12 15:44:00`),
 * 补 `Z` 后按 UTC 解析;已带 `Z`/偏移的 ISO 串则原样解析。失败返回 null。
 */
function toLocalDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

function parts(iso: string | null | undefined) {
  const d = toLocalDate(iso)
  if (!d) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return { y: d.getFullYear(), mo: p(d.getMonth() + 1), da: p(d.getDate()), h: p(d.getHours()), mi: p(d.getMinutes()), s: p(d.getSeconds()) }
}

/** 无法解析时回退:仅截断原串(不猜时区),空值给占位符 */
function fallback(iso: string | null | undefined, empty = '—'): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : empty
}

/** `YYYY-MM-DD HH:mm`(本地时区) */
export function formatTime(iso: string | null | undefined): string {
  const x = parts(iso)
  return x ? `${x.y}-${x.mo}-${x.da} ${x.h}:${x.mi}` : fallback(iso)
}

/** `YYYY-MM-DD HH:mm:ss`(本地时区),用于需要秒级精度的场景(如对象上传时间) */
export function formatFullTime(iso: string | null | undefined): string {
  const x = parts(iso)
  return x ? `${x.y}-${x.mo}-${x.da} ${x.h}:${x.mi}:${x.s}` : fallback(iso)
}

/** `MM-DD HH:mm`(本地时区),紧凑场景(如版本下拉)用;空值给空串 */
export function formatShortTime(iso: string | null | undefined): string {
  const x = parts(iso)
  return x ? `${x.mo}-${x.da} ${x.h}:${x.mi}` : ''
}

/**
 * 秒数 → 人读耗时:不足 1 分钟按秒,不足 1 小时按「分 + 秒」,再往上按「小时 + 分」。
 * 文案走词典(见 i18n),不同语言各写一条;用于生成过程的实时计时器。
 */
export function formatElapsed(
  seconds: number,
  t: (key: DictKey, vars?: Record<string, string | number>) => string
): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return t('chat.elapsedSec', { s })
  if (s < 3600) return t('chat.elapsedMin', { m: Math.floor(s / 60), s: s % 60 })
  return t('chat.elapsedHour', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) })
}

/** 字节数 → 人读文本(B / KB / MB),与 DataPanel 的口径一致 */
export function formatBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}