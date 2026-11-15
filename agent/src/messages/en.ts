import type { zh } from './zh.js'

/**
 * agent 侧英文文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制)。
 */
export const en: Record<keyof typeof zh, string> = {
  // ── 任务进度(写进 jobs.progress,前端原样展示)──
  'progress.plan': 'Planning the app',
  'progress.chatEdit': 'Applying your changes',
  'progress.planned': 'Plan ready, building the app',
  'progress.writing': 'Writing {file} · {count} file(s) modified',
  'progress.building': 'Building the app',
  'progress.polish': 'Running the design review',
  'progress.rebuilding': 'Rebuilding the app',
  'progress.queued': 'Queued — {n} task(s) ahead of you',
  'progress.queuedNow': 'Queued — starting shortly',
  // ── 流式日志(聊天区「过程」面板)──
  'log.polishStart': '\n💭 Design review started\n',
  'log.polishFallback': '\n⚠️ Review build failed — keeping the first pass\n',
  'log.polishUndone': '\n⚠️ Review did not finish — keeping the first pass ({msg})\n',
  'log.polishEnd': '\n💭 Design review finished\n',
  'log.deliveryLangRetry': '\n🔁 Delivery note was in the wrong language — asking again\n',
  // ── 错误(写进 jobs.error,前端原样展示)──
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
  'error.modelFailed': 'Model call failed: {msg}',
  'error.emptyModelRun':
    'The model returned nothing usable and wrote no files; check the gateway, credential and API dialect',
  'error.modelTruncated':
    'The model hit the max_tokens cap (thinking consumed the whole turn) and wrote no files; raise max_tokens for this config in the admin console and retry',
  'error.apiKeyMissing':
    'The agent has no credential {env}; bind the Secret in Cloud Run or switch this config back to an available credential',
}
