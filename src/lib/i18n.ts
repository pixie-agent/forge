/**
 * Worker 侧的用户可见文案(中/英)。
 *
 * 为什么 Worker 也要有字典:有些文字**是服务端写进数据库的**——对话里的附件/连接器清单、
 * 任务失败/完成时补的 assistant 消息——它们不出现在任何前端组件里,前端无从翻译。
 * 其余纯 UI 文案一律在前端 web/src/lib/i18n 处理,不要往这里加。
 *
 * 语言的来源:请求体里的 `lang`(前端按当前界面语言带上),随任务存进 `jobs.payload`,
 * 这样 commit / cancel 这些**回调时刻**也能知道该用哪种语言 —— 回调是 agent / cron 触发的,
 * 它们并不知道用户此刻在用哪种语言。
 */

export type Lang = 'zh' | 'en'

/** 只认 'en',其余(含缺失、脏值)一律按 'zh' —— 历史任务与 API 直连都落在这里,保持既有行为 */
export function parseLang(v: unknown): Lang {
  return v === 'en' ? 'en' : 'zh'
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

/** 服务端文案表。新增字符串:两边都加,键名保持一致(与前端 dict 同一套思路) */
const MESSAGES = {
  zh: {
    listSep: '、',
    'attach.marker': '\n\n📎 附件 {count} 个:{names}',
    'connector.marker': '\n\n🔌 连接器:{names}',
    'connector.readonly': '{provider}(只读)',
    'connector.writable': '{provider}(可写)',
    'commit.defaultAppName': '应用',
    'commit.generate':
      '已完成「{name}」初稿并写入草稿。满意后点「生成新版本」保存为正式版本,再发布上线。',
    'commit.chat': '已按「{prompt}」更新草稿。满意后点「生成新版本」保存为正式版本。',
    'cancel.message': '已停止本次任务(未扣除积分)。',
    // ── 断点续跑(写进新一轮 chat 的用户消息 / 错误响应)──
    'resume.message':
      '从断点继续上一次未完成的任务。当前源码已经是上次中断时的状态(已写好的文件都在),请在此基础上继续完成,不要从头重写。',
    'resume.notUnfinished': '该任务不是失败/停止状态,无需从断点继续',
    'resume.notLatest': '该任务已不是项目最新进度,不能从它继续(避免覆盖后续生成的内容)',
    'resume.noCheckpoint': '没有可用的断点快照(可能已过期或该任务还没写入过快照)',
    // ── 任务失败/取消(写进 jobs.error,前端原样展示)──
    'job.lost': '任务执行体失联,请重试',
    'job.timeout': '任务超时未完成,请重新发起',
    'job.cancelled': '已手动停止',
    'job.failed': '执行失败',
    'commit.incomplete': '产物不完整(缺源码树或构建产物)',
    'commit.noJob': '任务不存在',
    'commit.noProject': '项目不存在',
    'agent.failed': 'Agent 执行失败({status}),请重试(未扣除积分)',
    'agent.noArtifact': 'Agent 未返回有效产物,请重试(未扣除积分)',
    // ── 注册验证邮件(发送时刻没有前端,语言由注册请求的 lang 决定)──
    'verify.subject': '验证你的 Forge 邮箱',
    'verify.text':
      '欢迎使用 Forge。请打开下面的链接验证邮箱(24 小时内有效):\n\n{link}\n\n如果不是你本人注册,请忽略这封邮件。',
    'verify.html':
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
      '<h2 style="margin:0 0 12px">验证你的 Forge 邮箱</h2>' +
      '<p style="margin:0 0 16px;line-height:1.6">点击下面的按钮完成验证,链接 24 小时内有效:</p>' +
      '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">验证邮箱</a></p>' +
      '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">如果按钮无法点击,请复制这个链接到浏览器:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
      '<p style="margin:16px 0 0;font-size:12px;color:#666">如果不是你本人注册,请忽略这封邮件。</p>' +
      '</div>',
    // ── 后台加积分到账通知(与 en 段拼接成双语邮件)──
    'grant.subject': '你的 Forge 积分已到账',
    'grant.text':
      '你的 Forge 账户已增加 {amount} 积分,当前余额 {balance} 积分。\n\n积分可用于生成与修改应用:{link}\n\n如有疑问,请联系我们的支持。',
    'grant.html':
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
      '<h2 style="margin:0 0 12px">你的 Forge 积分已到账</h2>' +
      '<p style="margin:0 0 12px;line-height:1.6">已为你的账户增加 <strong>{amount}</strong> 积分,当前余额 <strong>{balance}</strong> 积分。</p>' +
      '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">去使用积分</a></p>' +
      '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">积分可用于生成与修改应用。如有疑问,请联系我们的支持。</p>' +
      '</div>',
  },
  en: {
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
    'resume.notLatest': 'This task is no longer the latest progress for the project, so it cannot be resumed (this avoids overwriting newer work)',
    'resume.noCheckpoint': 'No checkpoint snapshot is available (it may have expired, or the task never wrote one)',
    // ── 任务失败/取消(写进 jobs.error,前端原样展示)──
    'job.lost': 'Lost contact with the execution service. Please try again.',
    'job.timeout': 'The task timed out. Please start it again.',
    'job.cancelled': 'Stopped manually',
    'job.failed': 'Execution failed',
    'commit.incomplete': 'Incomplete artifact (missing source tree or build output)',
    'commit.noJob': 'Task not found',
    'commit.noProject': 'Project not found',
    'agent.failed': 'The agent failed ({status}). Please try again (no credits charged)',
    'agent.noArtifact': 'The agent returned no usable artifact. Please try again (no credits charged)',
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
    // ── 后台加积分到账通知(与 zh 段拼接成双语邮件)──
    'grant.subject': 'Credits added to your Forge account',
    'grant.text':
      '{amount} credits have been added to your Forge account. Your balance is now {balance} credits.\n\nUse them to generate and update apps: {link}\n\nIf you have any questions, please contact our support.',
    'grant.html':
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
      '<h2 style="margin:0 0 12px">Credits added to your Forge account</h2>' +
      '<p style="margin:0 0 12px;line-height:1.6"><strong>{amount}</strong> credits have been added to your account. Your balance is now <strong>{balance}</strong> credits.</p>' +
      '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Use credits</a></p>' +
      '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">Use credits to generate and update apps. If you have any questions, please contact our support.</p>' +
      '</div>',
  },
} as const

export type ServerMsgKey = keyof (typeof MESSAGES)['zh']

/** 取一条服务端文案并替换 {占位符};缺参时保留占位符原样,方便一眼看出漏传 */
export function srv(lang: Lang, key: ServerMsgKey, vars?: Vars): string {
  const text: string = MESSAGES[lang][key] ?? MESSAGES.zh[key]
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

/** 语言相关的列表分隔符(中文顿号 / 英文逗号) */
export function listSep(lang: Lang): string {
  return srv(lang, 'listSep')
}
