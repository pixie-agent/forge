/**
 * 产物文案语言:跟随用户需求正文的语言。
 *
 * 为什么在 agent 侧检测:产物语言是**产物**的属性(应用里的文案该用什么语言),
 * 而 Worker 只知道平台界面语言(`body.lang`);需求正文原文只有 agent 这一侧拿得到。
 * 检测不到就回落界面语言 —— 与 Worker 侧 `parseLang` 的回落策略一致(缺省 zh)。
 *
 * 检测分两步:
 *   1) 字符类别(假名/谚文/汉字/西里尔/拉丁)—— 非拉丁文字靠字形就能定,准确率高;
 *   2) 拉丁文字靠各语言的**特征词**加权打分 —— 纯统计词频会把英/西/法混在一起,
 *      所以只收各语言辨识度高的词,再用「领先第二名」的门槛挡住平局。
 *
 * 阈值说明:汉字占「汉字+拉丁字母」的比例 ≥ 20% 才算中文 —— 中文需求里常夹一堆
 * React / TypeScript / IndexedDB 这类英文技术词,纯按字母数比会把中文误判成英文。
 */

import type { RunRequest } from './types.js'

/** 产物可能出现的语言 */
export type OutputLang = 'zh' | 'en' | 'ja' | 'ko' | 'ru' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl'

/** 平台界面语言(Worker 传来的 `body.lang`);只影响平台自身的文案,不决定产物语言 */
export type UiLang = 'zh' | 'en'

/** 汉字占「汉字 + 拉丁字母」的比例达到这个值就判为中文 */
const HAN_RATIO = 0.2

/** 拉丁文字判定:最高分要达到这个值,且领先第二名才算命中 */
const MIN_SCORE = 2
/** 最高分要领先第二名这个倍数(第二名为 0 时不设限) */
const MIN_MARGIN = 2

/**
 * 各语言的特征词。权重 2 = 辨识度高(几乎只出现在该语言),权重 1 = 常见功能词。
 * 刻意不收会跨语言撞车的词(如西语的 de、意语的 con 与英语的 a),否则互相加分就废了。
 */
const LATIN_MARKERS: Record<string, string[]> = {
  en: [
    'build', 'create', 'make', 'website', 'app', 'page', 'please', 'want', 'need', 'should',
    'my', 'the', 'and', 'for', 'with', 'that', 'this', 'from', 'using', 'can', 'would',
  ],
  es: [
    'crea', 'crear', 'quiero', 'necesito', 'página', 'pagina', 'sitio', 'aplicación', 'aplicacion',
    'los', 'las', 'una', 'para', 'por', 'con', 'que', 'un', 'y', 'en', 'usando',
  ],
  fr: [
    'crée', 'cree', 'je', 'veux', 'besoin', 'page', 'site', 'application', 'les', 'une', 'des',
    'pour', 'avec', 'qui', 'dans', 'est', 'le', 'la', 'et',
  ],
  de: [
    'erstelle', 'möchte', 'seite', 'bitte', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine',
    'für', 'mit', 'ich', 'und', 'ist', 'nicht', 'einen',
  ],
  it: [
    'creare', 'voglio', 'sito', 'pagina', 'applicazione', 'gli', 'della', 'degli', 'per',
    'con', 'che', 'una', 'un', 'di', 'e',
  ],
  pt: [
    'quero', 'criar', 'página', 'pagina', 'aplicativo', 'você', 'voce', 'dos', 'das',
    'uma', 'com', 'para', 'que', 'não', 'nao', 'um',
  ],
  nl: [
    'maken', 'pagina', 'applicatie', 'het', 'een', 'van', 'voor', 'met', 'ik', 'wil',
    'niet', 'onze', 'en', 'is',
  ],
}

/** 辨识度高的词(权重 2)—— 与其它语言几乎不撞车 */
const STRONG = new Set([
  'build', 'create', 'make', 'website', 'app', 'page', 'please', 'want', 'need', 'should',
  'crea', 'crear', 'quiero', 'necesito', 'página', 'pagina', 'sitio', 'aplicación', 'aplicacion',
  'crée', 'cree', 'veux', 'besoin', 'application', 'erstelle', 'möchte', 'seite', 'bitte',
  'creare', 'voglio', 'applicazione', 'quero', 'criar', 'aplicativo', 'você', 'voce',
  'maken', 'applicatie', 'wil',
])

interface ScriptCount {
  kana: number
  hangul: number
  han: number
  cyrillic: number
  latin: number
}

/** 去掉代码块、行内代码与 URL:里面的英文是技术符号,不代表用户用什么语言表达需求 */
function stripNoise(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function countScripts(text: string): ScriptCount {
  const c: ScriptCount = { kana: 0, hangul: 0, han: 0, cyrillic: 0, latin: 0 }
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) c.kana++
    else if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f)) c.hangul++
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff)) c.han++
    else if (cp >= 0x0400 && cp <= 0x04ff) c.cyrillic++
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) c.latin++
  }
  return c
}

/** 拉丁文字按特征词打分;返回最高分与次高分 */
function scoreLatin(text: string): { best: [string, number]; second: number } {
  const words = text.toLowerCase().match(/[a-zà-ÿáéíóúñüöä]+/g) ?? []
  const counts = new Map<string, number>()
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)

  const scores = new Map<string, number>()
  for (const [lang, markers] of Object.entries(LATIN_MARKERS)) {
    let score = 0
    for (const m of markers) {
      const n = counts.get(m)
      if (!n) continue
      score += (STRONG.has(m) ? 2 : 1) * Math.min(n, 3)
    }
    if (score > 0) scores.set(lang, score)
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const best: [string, number] = ranked[0] ?? ['en', 0]
  const second = ranked[1]?.[1] ?? 0
  return { best, second }
}

/**
 * 检测需求正文的语言;识别不出来返回 null(由调用方回落界面语言)。
 */
export function detectRequestLang(rawText: string): OutputLang | null {
  const text = stripNoise(rawText ?? '')
  if (!text.trim()) return null
  const c = countScripts(text)

  // 非拉丁文字:字形即语言,不需要猜
  if (c.kana > 0) return 'ja'
  if (c.hangul > 0) return 'ko'
  if (c.cyrillic > 0 && c.cyrillic >= c.latin) return 'ru'
  // 汉字占比过 20% 判中文(中文需求常夹英文技术词,按字母数比会误判)
  if (c.han > 0 && c.han / (c.han + c.latin) >= HAN_RATIO) return 'zh'

  // 拉丁文字:特征词打分
  if (c.latin === 0) return null
  const { best, second } = scoreLatin(text)
  const [lang, score] = best
  if (score < MIN_SCORE) return null
  if (second > 0 && score < second * MIN_MARGIN) return null
  return lang as OutputLang
}

/** 需求正文:generate 看 idea,chat 看 message,补充要求(note)一并算上 */
export function requestText(req: Pick<RunRequest, 'type' | 'idea' | 'message' | 'note'>): string {
  return [req.type === 'chat' ? req.message : req.idea, req.note].filter(Boolean).join('\n')
}

/**
 * 产物语言 = 检测到的需求语言;检测不到回落界面语言,再回落简体中文。
 * 界面语言是 Worker 传来的 body.lang(缺失即 zh)。
 */
export function resolveOutputLang(req: Pick<RunRequest, 'type' | 'idea' | 'message' | 'note' | 'lang'>): OutputLang {
  const detected = detectRequestLang(requestText(req))
  if (detected) return detected
  return req.lang === 'en' ? 'en' : 'zh'
}

/** 给模型看的语言名(写进提示词) */
export function langName(lang: OutputLang): string {
  switch (lang) {
    case 'zh': return '简体中文'
    case 'en': return 'English'
    case 'ja': return '日本語'
    case 'ko': return '한국어'
    case 'ru': return 'Русский'
    case 'es': return 'Español'
    case 'fr': return 'Français'
    case 'de': return 'Deutsch'
    case 'it': return 'Italiano'
    case 'pt': return 'Português'
    case 'nl': return 'Nederlands'
  }
}

/**
 * 粗判一段文本是不是目标语言:用于检查模型写的交付说明有没有跑偏。
 *
 * 只做「有没有混进汉字」这一层的判断 —— 拉丁系语言之间分不出来,
 * 但那不重要:模型跑偏时几乎总是退回中文(提示词本身是中文写的),
 * 而中文是最容易被认出来的那一种。
 */
export function matchesLang(text: string, lang: OutputLang): boolean {
  if (!text.trim()) return false
  const han = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)
  if (lang === 'zh') return han
  if (lang === 'ja') return /[\u3040-\u30ff\u4e00-\u9fff]/.test(text)
  if (lang === 'ko') return /[\uac00-\ud7af\u1100-\u11ff]/.test(text)
  // 拉丁系(含 en):出现汉字就说明模型用中文写了
  return !han
}

/**
 * 给脚手架 setLocale() 用的代码。模板只内置中英两套默认文案,
 * 其它语言的应用回落到英文(总比留中文强)。
 */
export function localeCode(lang: OutputLang): 'zh' | 'en' {
  return lang === 'zh' ? 'zh' : 'en'
}
