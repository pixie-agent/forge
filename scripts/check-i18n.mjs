#!/usr/bin/env node
/**
 * 多语言一致性检查。
 *
 * 三层词典(前端 UI / Worker 服务端 / agent)每种语言一份,语言一多,靠人眼核对
 * 「键集是否一致、占位符是否对齐」必然漏 —— 漏一个键,那门语言的用户就会在
 * 页面上看到裸键名;漏一个占位符,文案里就会露出 `{name}` 这种毛刺。
 *
 * 这里做三件事:
 *   1. 键集:每门语言的键必须与源表(中文)完全一致(不多不少);
 *   2. 占位符:同一键在各语言里的 `{占位符}` 集合必须一致;
 *   3. 未翻译:值与英文几乎完全相同 —— 只提示,不失败
 *      (品牌名、符号、代码片段本来就该一样)。
 *
 * 用法:node scripts/check-i18n.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 极简扫描:把一个 `export const xx = { ... }` 文件解析成 { key: valueSource }。
 *
 * 不用正则硬啃值(值可能是多行字符串拼接),而是按「引号外、括号外的逗号」切条目。
 */
function parseDict(file) {
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf('{', src.indexOf('='))
  if (start < 0) throw new Error(`${file}: 找不到对象字面量`)

  const entries = new Map()
  let i = start + 1

  /** 跳过空白与注释 */
  const skipTrivia = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++
      if (src[i] === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++
        continue
      }
      if (src[i] === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2)
        i = e < 0 ? src.length : e + 2
        continue
      }
      break
    }
  }

  for (;;) {
    skipTrivia()
    if (src[i] !== ',' && src[i] === '}') break

    // 键:带引号或不带引号
    let key = null
    if (src[i] === "'" || src[i] === '"') {
      const q = src[i]
      const e = src.indexOf(q, i + 1)
      if (e < 0) break
      key = src.slice(i + 1, e)
      i = e + 1
    } else {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))
      if (!m) break
      key = m[0]
      i += m[0].length
    }
    skipTrivia()
    if (src[i] !== ':') break
    i++
    skipTrivia()

    // 值:扫到顶层逗号或对象结束
    const valueStart = i
    let depth = 0
    let quote = null
    let escaped = false
    let ended = false
    for (; i < src.length; i++) {
      const ch = src[i]
      if (quote) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === quote) quote = null
        continue
      }
      if (ch === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++
        continue
      }
      if (ch === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2)
        i = e < 0 ? src.length : e + 1
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
        continue
      }
      if (ch === '{' || ch === '[' || ch === '(') {
        depth++
        continue
      }
      if (ch === '}' || ch === ']' || ch === ')') {
        if (depth === 0) {
          ended = true
          break
        }
        depth--
        continue
      }
      if (ch === ',' && depth === 0) break
    }
    entries.set(key, src.slice(valueStart, i).trim())
    if (ended) break
    i++ // 跳过逗号
  }
  return entries
}

/** 取值里的字符串字面量内容(拼接的片段拼起来) */
function literalOf(valueSrc) {
  const parts = []
  let quote = null
  let escaped = false
  let cur = ''
  for (const ch of valueSrc) {
    if (quote) {
      if (escaped) {
        cur += ch === 'n' ? '\n' : ch === 't' ? '\t' : ch
        escaped = false
      } else if (ch === '\\') escaped = true
      else if (ch === quote) {
        parts.push(cur)
        cur = ''
        quote = null
      } else cur += ch
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
  }
  return parts.join('')
}

/** 值里的 {占位符} 集合 */
function placeholders(valueSrc) {
  return new Set([...literalOf(valueSrc).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
}

const problems = []
const warnings = []

function compareDict(tag, baseDict, dict, enDict) {
  // 1) 键集
  for (const k of baseDict.keys()) if (!dict.has(k)) problems.push(`${tag}: 缺少键 '${k}'`)
  for (const k of dict.keys()) if (!baseDict.has(k)) problems.push(`${tag}: 多出键 '${k}'`)

  // 2) 占位符
  for (const [k, v] of baseDict) {
    if (!dict.has(k)) continue
    const want = placeholders(v)
    const got = placeholders(dict.get(k))
    for (const p of want) if (!got.has(p)) problems.push(`${tag}: '${k}' 缺少占位符 {${p}}`)
    for (const p of got) if (!want.has(p)) problems.push(`${tag}: '${k}' 多出占位符 {${p}}`)
  }

  // 3) 值首尾的多余空格:拼接用的空格不该藏在文案里(唯一的例外是 landing.heroSep)。
  //    行首行尾的换行是合法的(日志行就是 \n 开头结尾),所以只查空格与制表符。
  // 分隔位本身就以空格结尾,不在此列
  const SEPARATOR_KEYS = new Set(['listSep', 'chat.listSep', 'landing.heroSep'])
  // 碎片型条目(Suffix/Prefix/Hint)本来就是接在别的文字后面/前面的,
  // 首尾带空格是有意为之(中文不需要、拉丁文需要)—— 同样不在此列
  const FRAGMENT_KEY = /(Suffix|Prefix|Hint)$/
  for (const [k, v] of dict) {
    if (SEPARATOR_KEYS.has(k) || FRAGMENT_KEY.test(k)) continue
    const lit = literalOf(v)
    if (lit !== lit.replace(/^[ \t]+|[ \t]+$/g, '')) {
      problems.push(`${tag}: '${k}' 值首尾有多余空格 —— 拼接用的空格请走显式分隔位(如 landing.heroSep)`)
    }
  }
  if (dict.has('landing.heroSep')) {
    const sep = literalOf(dict.get('landing.heroSep'))
    if (sep !== '' && sep !== ' ') problems.push(`${tag}: 'landing.heroSep' 只允许是空串或单个空格`)
  }


  // 4) 疑似未翻译(仅提示)
  if (enDict) {
    let same = 0
    let total = 0
    for (const [k, v] of enDict) {
      if (!dict.has(k)) continue
      total++
      if (literalOf(v) === literalOf(dict.get(k))) same++
    }
    if (total && same / total > 0.9) warnings.push(`${tag}: ${same}/${total} 条与英文完全相同 —— 疑似未翻译`)
  }
}

/** 检查一个目录下的同构词典:源表 base,其余 .ts 文件都是语言 */
function checkLayer(label, dir, baseName, accept) {
  const dirPath = join(ROOT, dir)
  const base = join(dirPath, `${baseName}.ts`)
  if (!existsSync(base)) return
  const baseDict = parseDict(base)
  const enDict = existsSync(join(dirPath, 'en.ts')) ? parseDict(join(dirPath, 'en.ts')) : null

  for (const file of readdirSync(dirPath).sort()) {
    if (!file.endsWith('.ts')) continue
    if (file === `${baseName}.ts`) continue
    const name = file.replace(/\.ts$/, '')
    if (!accept(name)) continue
    const dict = parseDict(join(dirPath, file))
    compareDict(`${label}/${name}`, baseDict, dict, name === 'en' ? null : enDict)
  }
}

// 前端:只有 dict.* 是词典(langs.ts / serverMessages.ts 不是)
checkLayer('web/dict', 'web/src/lib/i18n', 'dict.zh', (n) => n.startsWith('dict.') && n !== 'dict.zh')
// Worker / agent:messages/ 下除 grant.ts 外都是语言表
checkLayer('worker/messages', 'src/lib/messages', 'zh', (n) => n !== 'grant')
checkLayer('agent/messages', 'agent/src/messages', 'zh', () => true)

// 法务文档:中英两份必须同构(其它语言暂无译本,回落到英文)
const legalZh = parseDict(join(ROOT, 'web/src/lib/i18n/legal/zh.ts'))
const legalEn = parseDict(join(ROOT, 'web/src/lib/i18n/legal/en.ts'))
compareDict('legal/en', legalZh, legalEn, null)

for (const w of warnings) console.warn(`warn  ${w}`)
if (problems.length) {
  for (const p of problems) console.error(`error ${p}`)
  console.error(`\n✗ ${problems.length} 处不一致`)
  process.exit(1)
}
console.log('✓ i18n 一致性检查通过')
