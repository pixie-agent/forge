/**
 * 语言检测自检:仓库没有测试框架,这是唯一有真逻辑的一段,单独用脚本兜住。
 *
 * 用法:node --experimental-strip-types agent/scripts/lang-check.mjs
 */

import { detectRequestLang, resolveOutputLang } from '../src/lang.ts'

/** [需求正文, 期望语言] */
const CASES = [
  ['做一个宠物领养网站,能浏览待领养的宠物并留言', 'zh'],
  ['帮我做一个 React + TypeScript 的 todo app,用 IndexedDB 存数据', 'zh'],
  ['做一个咖啡店点单页面,要能上传菜单图', 'zh'],
  ['Build a pet adoption site where visitors can browse adoptable pets', 'en'],
  ['Create a task management app with due dates and tags', 'en'],
  ['Make a coffee shop ordering app for 咖啡店', 'en'],
  ['I want a simple website for my photography portfolio', 'en'],
  ['ペットアドOPTIONサイトを作って、里有。记得書き', 'ja'],
  ['반려동물 입양 사이트 만들어줘', 'ko'],
  ['Сделай сайт для списка покупок с возможностью отмечать купленные', 'ru'],
  ['Хочу сделать приложение для заметок с тегами', 'ru'],
  ['Crea una página web para una lista de tareas', 'es'],
  ['Ich möchte eine Website für eine Einkaufsliste erstellen', 'de'],
  ['Je veux créer un site web pour une liste de tâches', 'fr'],
  ['Voglio creare un sito web per una lista di cose', 'it'],
  ['Quero criar um site para lista de tarefas', 'pt'],
  ['Ik wil een website maken voor een takenlijst', 'nl'],
]

/** 识别不出来 → 回落界面语言(界面语言集合与产物语言集合一致,直接拿来当默认值) */
const FALLBACK = [
  ['', 'zh'],
  ['', 'en'],
  ['', 'ja'],
  ['', 'ru'],
  ['🙂', 'zh'],
]

let failed = 0

for (const [text, want] of CASES) {
  const got = detectRequestLang(text)
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${JSON.stringify(text.slice(0, 40))} → ${got ?? 'null'}(期望 ${want})`)
}

for (const [text, uiLang] of FALLBACK) {
  const got = resolveOutputLang({ type: 'generate', idea: text, lang: uiLang })
  const want = uiLang
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} 回落 ${JSON.stringify(text.slice(0, 30))} lang=${uiLang} → ${got}(期望 ${want})`)
}

// 界面语言不该盖过需求语言
const reqWins = resolveOutputLang({ type: 'generate', idea: 'Build a pet adoption site', lang: 'zh' })
if (reqWins !== 'en') {
  failed++
  console.log(`✗ 需求语言优先 → ${reqWins}(期望 en)`)
} else {
  console.log('✓ 需求语言优先 → en')
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 条不通过`)
process.exit(failed === 0 ? 0 : 1)
