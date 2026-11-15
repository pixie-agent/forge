import type { zh } from './zh.js'

/**
 * agent 侧俄语文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制)。
 */
export const ru: Record<keyof typeof zh, string> = {
  // ── 任务进度(写进 jobs.progress,前端原样展示)──
  'progress.plan': 'Планируем приложение',
  'progress.chatEdit': 'Вносим ваши правки',
  'progress.planned': 'План готов, создаём приложение',
  'progress.writing': 'Пишем {file} · изменено файлов: {count}',
  'progress.building': 'Собираем приложение',
  'progress.polish': 'Проводим дизайн-ревью',
  'progress.rebuilding': 'Пересобираем приложение',
  'progress.queued': 'В очереди — перед вами {n} задач',
  'progress.queuedNow': 'В очереди — начнём совсем скоро',
  // ── 流式日志(聊天区「过程」面板)──
  'log.polishStart': '\n💭 Дизайн-ревью началось\n',
  'log.polishFallback': '\n⚠️ Не удалось собрать результат ревью — сохраняем первый проход\n',
  'log.polishUndone': '\n⚠️ Ревью не завершилось — сохраняем первый проход ({msg})\n',
  'log.polishEnd': '\n💭 Дизайн-ревью завершено\n',
  'log.deliveryLangRetry': '\n🔁 Текст о передаче проекта оказался не на нужном языке — спрашиваем ещё раз\n',
  // ── 错误(写进 jobs.error,前端原样展示)──
  'error.buildFailed': 'Сборка не удалась: {detail}',
  'error.buildNotPass': 'vite build не прошёл',
  'error.timeout': 'Истекло время работы агента (предел {s} сек)',
  'error.cancelled': 'Задача остановлена пользователем',
  'error.bodyTooLarge': 'Тело запроса слишком большое',
  'error.badJson': 'Тело запроса не является корректным JSON',
  'error.notFound': 'Не найдено',
  'error.unauthorized': 'Нет доступа',
  'error.badParams': 'Некорректные параметры',
  'error.incomplete': 'Отсутствуют параметры',
  'error.modelsLoad': 'Не удалось загрузить models.json: {msg}',
  'error.modelMissing': 'Модель не найдена: {provider}/{model}',
  'error.modelFailed': 'Не удалось вызвать модель: {msg}',
  'error.emptyModelRun':
    'Модель не вернула пригодного результата и не записала ни одного файла; проверьте шлюз, учётные данные и диалект API',
  'error.modelTruncated':
    'Вывод модели обрезан лимитом max_tokens (размышления заняли весь раунд), и ни одного файла не записано; увеличьте max_tokens для этой конфигурации в админ-панели и повторите попытку',
  'error.apiKeyMissing':
    'У агента нет учётных данных {env}; привяжите Secret в Cloud Run или переключите эту конфигурацию на доступные учётные данные',
}
