import type { zh } from './zh'

/**
 * Worker 侧俄语文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制),值是面向用户的俄语文案。
 */
export const ru: Record<keyof typeof zh, string> = {
  listSep: ', ',
  'attach.marker': '\n\n📎 Вложений ({count}): {names}',
  'connector.marker': '\n\n🔌 Коннекторы: {names}',
  'connector.readonly': '{provider} (только чтение)',
  'connector.writable': '{provider} (с правом записи)',
  'commit.defaultAppName': 'ваше приложение',
  'commit.generate':
    'Первый черновик «{name}» готов и сохранён как черновик. Когда всё устроит, нажмите «Создать новую версию», чтобы сохранить его как версию, а затем опубликуйте.',
  'commit.chat': 'Черновик обновлён по запросу «{prompt}». Когда всё устроит, нажмите «Создать новую версию», чтобы сохранить его как версию.',
  'cancel.message': 'Этот запуск остановлен (кредиты не списаны).',
  // ── 断点续跑(写进新一轮 chat 的用户消息 / 错误响应)──
  'resume.message':
    'Продолжите незавершённую задачу с сохранённой точки. Текущий исходный код — это ровно то состояние, которое было сохранено при остановке прошлого запуска (всё уже написанное осталось на месте) — продолжайте с него, не начиная заново.',
  'resume.notUnfinished': 'Эта задача не завершилась сбоем и не остановлена, поэтому продолжать её не с чего',
  'resume.notLatest':
    'Эта задача больше не является последним прогрессом проекта, поэтому её нельзя продолжить (это защищает более новую работу от перезаписи)',
  'resume.noCheckpoint':
    'Нет доступного снимка точки продолжения (возможно, он устарел или задача ещё не создавала его)',
  // ── 任务失败/取消(写进 jobs.error,前端原样展示)──
  'job.notStarted': 'Служба выполнения не приняла задачу. Проверьте её настройки и попробуйте снова.',
  'job.lost': 'Связь со службой выполнения потеряна. Попробуйте снова.',
  'job.timeout': 'Время выполнения задачи истекло. Запустите её заново.',
  'job.cancelled': 'Остановлено вручную',
  'job.failed': 'Выполнение завершилось с ошибкой',
  'job.waitTimeout': 'Время ожидания подтверждения истекло, задача завершена',
  'respond.noWaiting': 'Нет задачи, ожидающей подтверждения',
  'respond.lostContext': 'Контекст восстановления утерян, продолжить невозможно',
  'respond.invalidChoice': 'Выберите допустимый вариант',
  'respond.declined': 'Генерация отклонена',
  'respond.choose': 'Выбрано: {choice}',
  'respond.approve': 'Подтверждено, продолжаем',
  'respond.approveFeedback': 'Подтверждено, с дополнением: {feedback}',
  'commit.incomplete': 'Артефакт неполный (нет дерева исходников или результата сборки)',
  'commit.noJob': 'Задача не найдена',
  'commit.noProject': 'Проект не найден',
  'agent.failed': 'Агент завершился с ошибкой ({status}). Попробуйте снова (кредиты не списаны)',
  'agent.noArtifact': 'Агент не вернул пригодный артефакт. Попробуйте снова (кредиты не списаны)',
  // ── 注册验证邮件(发送时刻没有前端,语言由注册请求的 lang 决定)──
  'verify.subject': 'Подтвердите свой email в Forge',
  'verify.text':
    'Добро пожаловать в Forge. Откройте ссылку ниже, чтобы подтвердить email (действует 24 часа):\n\n{link}\n\nЕсли вы не создавали этот аккаунт, просто проигнорируйте письмо.',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Подтвердите свой email в Forge</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">Нажмите кнопку ниже, чтобы подтвердить email. Ссылка действительна 24 часа:</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Подтвердить email</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">Если кнопка не работает, скопируйте ссылку в браузер:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">Если вы не создавали этот аккаунт, просто проигнорируйте письмо.</p>' +
    '</div>',
}
