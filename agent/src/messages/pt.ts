import type { zh } from './zh.js'

/**
 * Agent-side Portuguese (pt-BR) copy table.
 *
 * The key names must match `messages/zh.ts` exactly (enforced by the type).
 */
export const pt: Record<keyof typeof zh, string> = {
  // ── 任务进度(写进 jobs.progress,前端原样展示)──
  'progress.plan': 'Planejando o app',
  'progress.chatEdit': 'Aplicando suas alterações',
  'progress.planned': 'Plano pronto, construindo o app',
  'progress.writing': 'Escrevendo {file} · {count} arquivo(s) modificado(s)',
  'progress.building': 'Construindo o app',
  'progress.polish': 'Fazendo a revisão de design',
  'progress.rebuilding': 'Reconstruindo o app',
  'progress.queued': 'Na fila — {n} tarefa(s) à sua frente',
  'progress.queuedNow': 'Na fila — começando em instantes',
  // ── 流式日志(聊天区「过程」面板)──
  'log.polishStart': '\n💭 Revisão de design iniciada\n',
  'log.polishFallback': '\n⚠️ O build da revisão falhou — mantendo a primeira versão\n',
  'log.polishUndone': '\n⚠️ A revisão não terminou — mantendo a primeira versão ({msg})\n',
  'log.polishEnd': '\n💭 Revisão de design concluída\n',
  'log.deliveryLangRetry': '\n🔁 A nota de entrega estava no idioma errado — pedindo de novo\n',
  // ── 错误(写进 jobs.error,前端原样展示)──
  'error.buildFailed': 'Falha no build: {detail}',
  'error.buildNotPass': 'o vite build não passou',
  'error.timeout': 'Tempo do agente esgotado (limite de {s}s)',
  'error.cancelled': 'Tarefa parada pelo usuário',
  'error.bodyTooLarge': 'Corpo da requisição muito grande',
  'error.badJson': 'O corpo da requisição não é um JSON válido',
  'error.notFound': 'Não encontrado',
  'error.unauthorized': 'Não autorizado',
  'error.badParams': 'Parâmetros inválidos',
  'error.incomplete': 'Parâmetros ausentes',
  'error.modelsLoad': 'Falha ao carregar models.json: {msg}',
  'error.modelMissing': 'Modelo não encontrado: {provider}/{model}',
  'error.modelFailed': 'Falha na chamada do modelo: {msg}',
  'error.emptyModelRun':
    'O modelo não retornou nada utilizável e não gravou arquivos; verifique o gateway, a credencial e o dialeto da API',
  'error.modelTruncated':
    'O modelo atingiu o limite de max_tokens (o raciocínio consumiu toda a rodada) e não gravou arquivos; aumente o max_tokens desta configuração no console do admin e tente novamente',
  'error.apiKeyMissing':
    'O agente não tem a credencial {env}; vincule o Secret no Cloud Run ou volte esta configuração para uma credencial disponível',
}
