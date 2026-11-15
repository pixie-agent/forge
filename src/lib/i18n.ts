/**
 * Worker 侧的用户可见文案(11 种语言)。
 *
 * 为什么 Worker 也要有字典:有些文字**是服务端写进数据库的**——对话里的附件/连接器清单、
 * 任务失败/完成时补的 assistant 消息——它们不出现在任何前端组件里,前端无从翻译。
 * 其余纯 UI 文案一律在前端 web/src/lib/i18n 处理,不要往这里加。
 *
 * 语言的来源:请求体里的 `lang`(前端按当前界面语言带上),随任务存进 `jobs.payload`,
 * 这样 commit / cancel 这些**回调时刻**也能知道该用哪种语言 —— 回调是 agent / cron 触发的,
 * 它们并不知道用户此刻在用哪种语言。
 *
 * 语言集合与前端界面语言、agent 产物语言完全一致(zh/en/ja/ko/ru/es/fr/de/it/pt/nl),
 * 新增语言时三处一起加。
 */
import { zh } from './messages/zh'
import { en } from './messages/en'
import { ja } from './messages/ja'
import { ko } from './messages/ko'
import { ru } from './messages/ru'
import { es } from './messages/es'
import { fr } from './messages/fr'
import { de } from './messages/de'
import { it } from './messages/it'
import { pt } from './messages/pt'
import { nl } from './messages/nl'

export { grant } from './messages/grant'

export type Lang = 'zh' | 'en' | 'ja' | 'ko' | 'ru' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl'

export const LANGS: readonly Lang[] = ['zh', 'en', 'ja', 'ko', 'ru', 'es', 'fr', 'de', 'it', 'pt', 'nl']

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v)
}

/** 解析语言代码;非法值回落到 fallback(默认 zh,与历史行为一致) */
export function parseLang(v: unknown, fallback: Lang = 'zh'): Lang {
  return isLang(v) ? v : fallback
}

/** 从任务 payload(JSON)里取语言;解析失败按 zh */
export function langOfPayload(payloadJson: string | null | undefined): Lang {
  if (!payloadJson) return 'zh'
  try {
    return parseLang((JSON.parse(payloadJson) as { lang?: unknown }).lang)
  } catch {
    return 'zh'
  }
}

type Vars = Record<string, string | number>

/** 服务端文案表。新增字符串:所有语言都加,键名保持一致(与前端 dict 同一套思路) */
const TABLES: Record<Lang, Record<keyof typeof zh, string>> = {
  zh,
  en,
  ja,
  ko,
  ru,
  es,
  fr,
  de,
  it,
  pt,
  nl,
}

export type ServerMsgKey = keyof typeof zh

/** 替换 {占位符};缺参时保留占位符原样,方便一眼看出漏传 */
export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

/** 取一条服务端文案并替换 {占位符};缺参时保留占位符原样,方便一眼看出漏传 */
export function srv(lang: Lang, key: ServerMsgKey, vars?: Vars): string {
  const text: string = TABLES[lang]?.[key] ?? TABLES.zh[key]
  return interpolate(text, vars)
}

/** 语言相关的列表分隔符(中文顿号 / 英文逗号 / 日文顿号 ...) */
export function listSep(lang: Lang): string {
  return srv(lang, 'listSep')
}
