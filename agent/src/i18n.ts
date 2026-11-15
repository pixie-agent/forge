/**
 * agent 自己的界面文案(任务进度、错误提示)。
 *
 * 这些是**平台 chrome**,不是产物 —— 用户在平台的对话框里看到它们,所以跟随
 * **平台界面语言**(Worker 传来的 body.lang),而不是产物语言(见 lang.ts)。
 *
 * 与 Worker 侧 src/lib/messages 是两套字典:那边是服务端写进数据库的文案,
 * 这边是 agent 进程里临时生成、直接推给前端的文案,各管一段。
 *
 * 语言集合与前端界面语言、产物语言完全一致(zh/en/ja/ko/ru/es/fr/de/it/pt/nl)。
 */
import { zh } from './messages/zh.js'
import { en } from './messages/en.js'
import { ja } from './messages/ja.js'
import { ko } from './messages/ko.js'
import { ru } from './messages/ru.js'
import { es } from './messages/es.js'
import { fr } from './messages/fr.js'
import { de } from './messages/de.js'
import { it } from './messages/it.js'
import { pt } from './messages/pt.js'
import { nl } from './messages/nl.js'

/** 平台界面语言 */
export type UiLang = 'zh' | 'en' | 'ja' | 'ko' | 'ru' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl'

export const UI_LANGS: readonly UiLang[] = ['zh', 'en', 'ja', 'ko', 'ru', 'es', 'fr', 'de', 'it', 'pt', 'nl']

export function isUiLang(v: unknown): v is UiLang {
  return typeof v === 'string' && (UI_LANGS as readonly string[]).includes(v)
}

const DICT: Record<UiLang, Record<keyof typeof zh, string>> = {
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

export type MessageKey = keyof typeof zh

/**
 * 取文案。lang 缺失或非法一律按 zh(与 Worker 侧 parseLang 的回落策略一致)。
 * `{占位符}` 用 vars 里的值替换。
 */
export function t(lang: UiLang | undefined, key: MessageKey, vars?: Record<string, string | number>): string {
  const table = DICT[isUiLang(lang) ? lang : 'zh']
  let text: string = table[key]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v))
  }
  return text
}
