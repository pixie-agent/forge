import type { zh } from './zh.js'

/**
 * agent 側日本語文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制)。
 */
export const ja: Record<keyof typeof zh, string> = {
  // ── 任务进度(写进 jobs.progress,前端原样展示)──
  'progress.plan': 'アプリを企画しています',
  'progress.chatEdit': 'ご要望を反映しています',
  'progress.planned': '企画が完了しました。アプリを実装しています',
  'progress.writing': '{file} を書き込み中 · {count} 個のファイルを変更',
  'progress.building': 'アプリの成果物をビルドしています',
  'progress.polish': 'デザインレビューと磨き上げを行っています',
  'progress.rebuilding': 'アプリの成果物を再ビルドしています',
  'progress.queued': '順番待ちです。前に {n} 件のタスクがあります。しばらくお待ちください',
  'progress.queuedNow': '順番待ちです。まもなく開始します。しばらくお待ちください',
  // ── 流式日志(聊天区「过程」面板)──
  'log.polishStart': '\n💭 デザインレビューを開始しました\n',
  'log.polishFallback': '\n⚠️ レビューのビルドに失敗したため、1 回目の結果を保持します\n',
  'log.polishUndone': '\n⚠️ レビューは完了しなかったため、1 回目の結果を保持します({msg})\n',
  'log.polishEnd': '\n💭 デザインレビューが完了しました\n',
  'log.deliveryLangRetry': '\n🔁 納品説明の言語が想定と異なっているため、問い合わせ直します\n',
  // ── 错误(写进 jobs.error,前端原样展示)──
  'error.buildFailed': 'ビルドに失敗しました:{detail}',
  'error.buildNotPass': 'vite build が通っていません',
  'error.timeout': 'Agent の実行がタイムアウトしました(上限 {s}s)',
  'error.cancelled': 'タスクはユーザーによって停止されました',
  'error.bodyTooLarge': 'リクエストが大きすぎます',
  'error.badJson': 'リクエストが正しい JSON ではありません',
  'error.notFound': '見つかりません',
  'error.unauthorized': '権限がありません',
  'error.badParams': 'パラメータが不正です',
  'error.incomplete': 'パラメータが不完全です',
  'error.modelsLoad': 'models.json の読み込みに失敗しました:{msg}',
  'error.modelMissing': 'モデルが見つかりません:{provider}/{model}',
  'error.modelFailed': 'モデル呼び出しに失敗しました:{msg}',
  'error.emptyModelRun':
    'モデルが利用可能な内容を返さず、ファイルも書き込みませんでした。ゲートウェイ、認証情報、API 方言を確認してください',
  'error.modelTruncated':
    'モデル出力が max_tokens で切り詰められ、ファイルも書き込みませんでした。思考だけで 1 ターンの上限を使い切っているため、管理画面でこの設定の max_tokens を増やして再試行してください',
  'error.apiKeyMissing':
    '実行環境に認証情報 {env} がバインドされていません。Cloud Run に Secret を追加するか、この設定を利用可能な認証情報に戻してください',
}
