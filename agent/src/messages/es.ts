import type { zh } from './zh.js'

/**
 * agent 侧西班牙语文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制)。
 */
export const es: Record<keyof typeof zh, string> = {
  // ── 任务进度(写进 jobs.progress,前端原样展示)──
  'progress.plan': 'Planificando la app',
  'progress.chatEdit': 'Aplicando tus cambios',
  'progress.planned': 'Plan listo, construyendo la app',
  'progress.writing': 'Escribiendo {file} · {count} archivo(s) modificados',
  'progress.building': 'Construyendo la app',
  'progress.polish': 'Realizando la revisión de diseño',
  'progress.rebuilding': 'Volviendo a construir la app',
  'progress.queued': 'En cola: hay {n} tarea(s) antes que tú',
  'progress.queuedNow': 'En cola: empieza enseguida',
  // ── 流式日志(聊天区「过程」面板)──
  'log.polishStart': '\n💭 Ha empezado la revisión de diseño\n',
  'log.polishFallback': '\n⚠️ La compilación de la revisión ha fallado: se conserva la primera pasada\n',
  'log.polishUndone': '\n⚠️ La revisión no ha terminado: se conserva la primera pasada ({msg})\n',
  'log.polishEnd': '\n💭 La revisión de diseño ha terminado\n',
  'log.deliveryLangRetry': '\n🔁 La nota de entrega iba en el idioma equivocado: se vuelve a pedir\n',
  // ── 错误(写进 jobs.error,前端原样展示)──
  'error.buildFailed': 'Error de compilación: {detail}',
  'error.buildNotPass': 'vite build no ha pasado',
  'error.timeout': 'El agente ha agotado el tiempo (límite {s}s)',
  'error.cancelled': 'La tarea la ha detenido el usuario',
  'error.bodyTooLarge': 'El cuerpo de la solicitud es demasiado grande',
  'error.badJson': 'El cuerpo de la solicitud no es JSON válido',
  'error.notFound': 'No encontrado',
  'error.unauthorized': 'No autorizado',
  'error.badParams': 'Parámetros no válidos',
  'error.incomplete': 'Faltan parámetros',
  'error.modelsLoad': 'No se ha podido cargar models.json: {msg}',
  'error.modelMissing': 'Modelo no encontrado: {provider}/{model}',
  'error.modelFailed': 'La llamada al modelo ha fallado: {msg}',
  'error.emptyModelRun':
    'El modelo no ha devuelto nada utilizable y no ha escrito ningún archivo; revisa el gateway, la credencial y el dialecto de la API',
  'error.modelTruncated':
    'El modelo ha alcanzado el límite de max_tokens (el razonamiento ha consumido todo el turno) y no ha escrito ningún archivo; aumenta max_tokens para esta configuración en la consola de administración e inténtalo de nuevo',
  'error.apiKeyMissing':
    'El agente no tiene la credencial {env}; vincula el Secret en Cloud Run o vuelve a cambiar esta configuración a una credencial disponible',
}
