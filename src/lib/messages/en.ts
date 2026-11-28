import type { zh } from './zh'

/**
 * Worker 侧英文文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制),值是面向用户的英文文案。
 */
export const en: Record<keyof typeof zh, string> = {
  listSep: ', ',
  'attach.marker': '\n\n📎 {count} attachment(s): {names}',
  'connector.marker': '\n\n🔌 Connectors: {names}',
  'connector.readonly': '{provider} (read-only)',
  'connector.writable': '{provider} (writable)',
  'commit.defaultAppName': 'your app',
  'commit.generate':
    'The first draft of “{name}” is ready and saved as a draft. When you are happy with it, click “Save version” to keep it as a version, then publish.',
  'commit.chat': 'Draft updated for “{prompt}”. When you are happy with it, click “Save version” to keep it as a version.',
  'cancel.message': 'This run was stopped (no credits charged).',
  // ── 断点续跑(写进新一轮 chat 的用户消息 / 错误响应)──
  'resume.message':
    'Continue the unfinished task from the checkpoint. The current source is exactly what was saved when the last run stopped (everything already written is still here) — build on it instead of starting over.',
  'resume.notUnfinished': 'This task is not failed/stopped, so there is nothing to resume',
  'resume.notLatest':
    'This task is no longer the latest progress for the project, so it cannot be resumed (this avoids overwriting newer work)',
  'resume.noCheckpoint':
    'No checkpoint snapshot is available (it may have expired, or the task never wrote one)',
  // ── 任务失败/取消(写进 jobs.error,前端原样展示)──
  'job.notStarted': 'The execution service did not accept the task. Check its configuration and try again.',
  'job.lost': 'Lost contact with the execution service. Please try again.',
  'job.timeout': 'The task timed out. Please start it again.',
  'job.cancelled': 'Stopped manually',
  'job.failed': 'Execution failed',
  'job.waitTimeout': 'Timed out waiting for your confirmation; the task has ended',
  'respond.noWaiting': 'There is no task waiting for confirmation',
  'respond.lostContext': 'Recovery context is missing; cannot continue',
  'respond.invalidChoice': 'Please pick a valid option',
  'respond.declined': 'This run was declined',
  'respond.choose': 'Chose: {choice}',
  'respond.approve': 'Confirmed, continuing',
  'respond.approveFeedback': 'Confirmed, with feedback: {feedback}',
  'commit.incomplete': 'Incomplete artifact (missing source tree or build output)',
  'commit.noJob': 'Task not found',
  'commit.noProject': 'Project not found',
  'agent.failed': 'The agent failed ({status}). Please try again (no credits charged)',
  'agent.noArtifact': 'The agent returned no usable artifact. Please try again (no credits charged)',
  // ── 注册验证邮件(发送时刻没有前端,语言由注册请求的 lang 决定)──
  'verify.subject': 'Verify your Forge email',
  'verify.text':
    'Welcome to Forge. Open the link below to verify your email (valid for 24 hours):\n\n{link}\n\nIf you did not create this account, you can safely ignore this email.',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Verify your Forge email</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">Click the button below to verify your email. The link is valid for 24 hours:</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Verify email</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">If you did not create this account, you can safely ignore this email.</p>' +
    '</div>',
}
