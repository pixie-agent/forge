/**
 * Worker 侧中文文案表(源表 —— 键名以本文件为准)。
 *
 * 为什么 Worker 也要有字典:有些文字**是服务端写进数据库的**——对话里的附件/连接器清单、
 * 任务失败/完成时补的 assistant 消息——它们不出现在任何前端组件里,前端无从翻译。
 * 其余纯 UI 文案一律在前端 web/src/lib/i18n 处理,不要往这里加。
 *
 * 语言的来源:请求体里的 `lang`(前端按当前界面语言带上),随任务存进 `jobs.payload`,
 * 这样 commit / cancel 这些**回调时刻**也能知道该用哪种语言 —— 回调是 agent / cron 触发的,
 * 它们并不知道用户此刻在用哪种语言。
 *
 * 新增语言:在 `messages/` 下加一份同构文件(键名与本表一致),并在 `lib/i18n.ts` 注册。
 */

/** 列表分隔符:中文顿号 */
export const zh = {
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
  'job.notStarted': '执行服务未能接收任务,请检查配置后重试',
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
}
