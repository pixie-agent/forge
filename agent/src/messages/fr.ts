import type { zh } from './zh.js'

/**
 * agent 侧法语文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制)。
 */
export const fr: Record<keyof typeof zh, string> = {
  // ── 任务进度(写进 jobs.progress,前端原样展示)──
  'progress.plan': 'Planification de l’application',
  'progress.chatEdit': 'Application de vos modifications',
  'progress.planned': 'Plan prêt, construction de l’application',
  'progress.writing': 'Écriture de {file} · {count} fichier(s) modifié(s)',
  'progress.building': 'Construction de l’application',
  'progress.polish': 'Revue de design en cours',
  'progress.rebuilding': 'Reconstruction de l’application',
  'progress.queued': 'En file d’attente — {n} tâche(s) devant vous',
  'progress.queuedNow': 'En file d’attente — démarrage imminent',
  // ── 流式日志(聊天区「过程」面板)──
  'log.polishStart': '\n💭 Revue de design démarrée\n',
  'log.polishFallback': '\n⚠️ Échec du build de la revue — conservation de la première version\n',
  'log.polishUndone':
    '\n⚠️ Revue non terminée — conservation de la première version ({msg})\n',
  'log.polishEnd': '\n💭 Revue de design terminée\n',
  'log.deliveryLangRetry':
    '\n🔁 La note de livraison était dans la mauvaise langue — nouvelle demande\n',
  // ── 错误(写进 jobs.error,前端原样展示)──
  'error.buildFailed': 'Échec du build : {detail}',
  'error.buildNotPass': 'vite build n’est pas passé',
  'error.timeout': 'L’agent a expiré (limite {s} s)',
  'error.cancelled': 'Tâche arrêtée par l’utilisateur',
  'error.bodyTooLarge': 'Corps de requête trop volumineux',
  'error.badJson': 'Le corps de la requête n’est pas du JSON valide',
  'error.notFound': 'Introuvable',
  'error.unauthorized': 'Non autorisé',
  'error.badParams': 'Paramètres invalides',
  'error.incomplete': 'Paramètres manquants',
  'error.modelsLoad': 'Échec du chargement de models.json : {msg}',
  'error.modelMissing': 'Modèle introuvable : {provider}/{model}',
  'error.modelFailed': 'Échec de l’appel au modèle : {msg}',
  'error.emptyModelRun':
    'Le modèle n’a renvoyé rien d’utilisable et n’a écrit aucun fichier ; vérifiez la passerelle, les identifiants et le dialecte d’API',
  'error.modelTruncated':
    'Le modèle a atteint la limite max_tokens (le raisonnement a consommé tout le tour) et n’a écrit aucun fichier ; augmentez max_tokens pour cette configuration dans la console d’administration, puis réessayez',
  'error.apiKeyMissing':
    'L’agent n’a aucun identifiant {env} ; liez le Secret dans Cloud Run ou rebasculez cette configuration vers un identifiant disponible',
}
