/**
 * agent 自己的界面文案(任务进度、错误提示)。
 *
 * 这些是**平台 chrome**,不是产物 —— 用户在平台的对话框里看到它们,所以跟随
 * **平台界面语言**(Worker 传来的 body.lang),而不是产物语言(见 lang.ts)。
 *
 * 与 Worker 侧 src/lib/i18n.ts 是两套字典:那边是服务端写进数据库的文案,
 * 这边是 agent 进程里临时生成、直接推给前端的文案,各管一段。
 */

/** 平台界面语言 */
export type UiLang = 'zh' | 'en'

const DICT = {
  zh: {
    // ── 任务进度(写进 jobs.progress,前端原样展示)──
    'progress.plan': '正在规划方案',
    'progress.chatEdit': '正在按要求修改应用',
    'progress.planned': '规划完成,正在实现应用',
    'progress.writing': '正在编写 {file}',
    'progress.building': '正在构建应用产物',
    'progress.polish': '正在做设计总监复查与打磨',
    'progress.rebuilding': '正在重新构建应用产物',
    'progress.queued': '排队中,前面还有 {n} 个任务,请稍候',
    'progress.queuedNow': '排队中,马上开始,请稍候',
    // ── 流式日志(聊天区「过程」面板)──
    'log.polishStart': '\n💭 设计总监复查轮开始\n',
    'log.polishFallback': '\n⚠️ 复查轮产物构建失败,已回落到第一轮结果\n',
    'log.polishUndone': '\n⚠️ 复查轮未完成,保留第一轮结果({msg})\n',
    'log.polishEnd': '\n💭 设计总监复查轮结束\n',
    'log.deliveryLangRetry': '\n🔁 交付说明语言不对,重问一次\n',
    // ── 错误(写进 jobs.error,前端原样展示)──
    'error.buildFailed': '构建失败:{detail}',
    'error.buildNotPass': 'vite build 未通过',
    'error.timeout': 'Agent 执行超时(上限 {s}s)',
    'error.cancelled': '任务已被用户停止',
    'error.bodyTooLarge': '请求体过大',
    'error.badJson': '请求体不是合法 JSON',
    'error.notFound': '不存在',
    'error.unauthorized': '未授权',
    'error.badParams': '参数错误',
    'error.incomplete': '参数不完整',
    'error.modelsLoad': 'models.json 加载失败:{msg}',
    'error.modelMissing': '模型未找到:{provider}/{model}',
  },
  en: {
    'progress.plan': 'Planning the app',
    'progress.chatEdit': 'Applying your changes',
    'progress.planned': 'Plan ready, building the app',
    'progress.writing': 'Writing {file}',
    'progress.building': 'Building the app',
    'progress.polish': 'Running the design review',
    'progress.rebuilding': 'Rebuilding the app',
    'progress.queued': 'Queued — {n} task(s) ahead of you',
    'progress.queuedNow': 'Queued — starting shortly',
    'log.polishStart': '\n💭 Design review started\n',
    'log.polishFallback': '\n⚠️ Review build failed — keeping the first pass\n',
    'log.polishUndone': '\n⚠️ Review did not finish — keeping the first pass ({msg})\n',
    'log.polishEnd': '\n💭 Design review finished\n',
    'log.deliveryLangRetry': '\n🔁 Delivery note was in the wrong language — asking again\n',
    'error.buildFailed': 'Build failed: {detail}',
    'error.buildNotPass': 'vite build did not pass',
    'error.timeout': 'Agent timed out (limit {s}s)',
    'error.cancelled': 'Task stopped by the user',
    'error.bodyTooLarge': 'Request body too large',
    'error.badJson': 'Request body is not valid JSON',
    'error.notFound': 'Not found',
    'error.unauthorized': 'Unauthorized',
    'error.badParams': 'Invalid parameters',
    'error.incomplete': 'Missing parameters',
    'error.modelsLoad': 'Failed to load models.json: {msg}',
    'error.modelMissing': 'Model not found: {provider}/{model}',
  },
} as const

export type MessageKey = keyof typeof DICT.zh

/**
 * 取文案。lang 缺失或非法一律按 zh(与 Worker 侧 parseLang 的回落策略一致)。
 * `{占位符}` 用 vars 里的值替换。
 */
export function t(lang: UiLang | undefined, key: MessageKey, vars?: Record<string, string | number>): string {
  const table = DICT[lang === 'en' ? 'en' : 'zh']
  let text: string = table[key]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v))
  }
  return text
}
