/**
 * agent 侧中文文案表(源表 —— 键名以本文件为准)。
 *
 * 这些是**平台 chrome**,不是产物 —— 用户在平台的对话框里看到它们,所以跟随
 * **平台界面语言**(Worker 传来的 body.lang),而不是产物语言(见 lang.ts)。
 *
 * 与 Worker 侧 src/lib/messages 是两套字典:那边是服务端写进数据库的文案,
 * 这边是 agent 进程里临时生成、直接推给前端的文案,各管一段。
 */

/** 平台界面语言 */
export const zh = {
  // ── 任务进度(写进 jobs.progress,前端原样展示)──
  'progress.plan': '正在规划方案',
  'progress.chatEdit': '正在按要求修改应用',
  'progress.planned': '规划完成,正在实现应用',
  'progress.writing': '正在编写 {file} · 已修改 {count} 个文件',
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
  'error.modelFailed': '模型调用失败:{msg}',
  'error.emptyModelRun': '模型没有返回可用内容,也没有写入任何文件;请检查网关、凭证与 API 方言',
  'error.modelTruncated':
    '模型输出被 max_tokens 截断,没有写入任何文件;思考占满了单轮额度,请在后台把这条配置的 max_tokens 调大后重试',
  'error.apiKeyMissing': '执行体没有绑定凭证 {env};请在 Cloud Run 加 Secret,或把这条配置切回可用的凭证',
}
