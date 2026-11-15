import type { zh } from './zh'

/**
 * Worker 側日本語文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制),值是面向用户的日语文案。
 */
export const ja: Record<keyof typeof zh, string> = {
  listSep: '、',
  'attach.marker': '\n\n📎 添付ファイル {count} 件:{names}',
  'connector.marker': '\n\n🔌 コネクター:{names}',
  'connector.readonly': '{provider}(読み取り専用)',
  'connector.writable': '{provider}(書き込み可)',
  'commit.defaultAppName': 'アプリ',
  'commit.generate':
    '「{name}」の初稿が完成し、下書きに保存しました。よろしければ「新しいバージョンを生成」をクリックして正式なバージョンとして保存し、その後公開してください。',
  'commit.chat': '「{prompt}」に合わせて下書きを更新しました。よろしければ「新しいバージョンを生成」をクリックして正式なバージョンとして保存してください。',
  'cancel.message': 'このタスクを停止しました(クレジットは消費されていません)。',
  // ── 断点续跑(写进新一轮 chat 的用户消息 / 错误响应)──
  'resume.message':
    '前回の未完了タスクを途中から再開します。現在のソースは前回中断した時点の状態です(書き込まれたファイルはすべて残っています)。この状態から完成まで進めてください。最初から書き直さないでください。',
  'resume.notUnfinished': 'このタスクは失敗/停止状態ではないため、途中からの再開はできません',
  'resume.notLatest': 'このタスクはプロジェクトの最新の進捗ではないため、続きから再開できません(後の生成内容を上書きしないため)',
  'resume.noCheckpoint': '利用可能なチェックポイントがありません(期限切れか、このタスクがまだスナップショットを保存していない可能性があります)',
  // ── 任务失败/取消(写进 jobs.error,前端原样展示)──
  'job.notStarted': '実行サービスがタスクを受け付けられませんでした。設定を確認して再試行してください',
  'job.lost': '実行サービスとの接続が失われました。再試行してください',
  'job.timeout': 'タスクがタイムアウトしました。改めて実行してください',
  'job.cancelled': '手動で停止しました',
  'job.failed': '実行に失敗しました',
  'commit.incomplete': '成果物が不完全です(ソースツリーまたはビルド成果物がありません)',
  'commit.noJob': 'タスクが存在しません',
  'commit.noProject': 'プロジェクトが存在しません',
  'agent.failed': 'Agent の実行に失敗しました({status})。再試行してください(クレジットは消費されていません)',
  'agent.noArtifact': 'Agent が有効な成果物を返しませんでした。再試行してください(クレジットは消費されていません)',
  // ── 注册验证邮件(发送时刻没有前端,语言由注册请求的 lang 决定)──
  'verify.subject': 'Forge のメールアドレスを確認してください',
  'verify.text':
    'Forge へようこそ。以下のリンクを開いてメールアドレスの確認を完了してください(24 時間有効です):\n\n{link}\n\nご自身が登録されたものでない場合は、このメールを無視してください。',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Forge のメールアドレスを確認してください</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">下のボタンからメールアドレスの確認を完了してください。リンクの有効期限は 24 時間です:</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">メールアドレスを確認</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">ボタンが押せない場合は、次のリンクをコピーしてブラウザで開いてください:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">ご自身が登録されたものでない場合は、このメールを無視してください。</p>' +
    '</div>',
}
