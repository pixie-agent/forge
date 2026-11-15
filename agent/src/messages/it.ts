import type { zh } from './zh.js'

/**
 * agent-side Italian copy table.
 *
 * The keys must match `messages/zh.ts` exactly (enforced at the type level).
 */
export const it: Record<keyof typeof zh, string> = {
  // ── job progress (written into jobs.progress, shown as-is) ──
  'progress.plan': 'Sto pianificando l’app',
  'progress.chatEdit': 'Sto applicando le modifiche',
  'progress.planned': 'Piano pronto, sto costruendo l’app',
  'progress.writing': 'Sto scrivendo {file} · {count} file modificati',
  'progress.building': 'Sto costruendo l’app',
  'progress.polish': 'Sto eseguendo la revisione di design',
  'progress.rebuilding': 'Sto ricostruendo l’app',
  'progress.queued': 'In coda — hai {n} attività davanti',
  'progress.queuedNow': 'In coda — iniziamo a breve',
  // ── streaming log (the "process" panel in the chat area) ──
  'log.polishStart': '\n💭 Revisione di design avviata\n',
  'log.polishFallback': '\n⚠️ Build della revisione non riuscita — tengo il primo risultato\n',
  'log.polishUndone': '\n⚠️ La revisione non è finita — tengo il primo risultato ({msg})\n',
  'log.polishEnd': '\n💭 Revisione di design conclusa\n',
  'log.deliveryLangRetry': '\n🔁 La nota di consegna era nella lingua sbagliata — chiedo di nuovo\n',
  // ── errors (written into jobs.error, shown as-is) ──
  'error.buildFailed': 'Build non riuscita: {detail}',
  'error.buildNotPass': 'vite build non è andato a buon fine',
  'error.timeout': 'L’agente è andato in timeout (limite {s}s)',
  'error.cancelled': 'Attività fermata dall’utente',
  'error.bodyTooLarge': 'Corpo della richiesta troppo grande',
  'error.badJson': 'Il corpo della richiesta non è JSON valido',
  'error.notFound': 'Non trovato',
  'error.unauthorized': 'Non autorizzato',
  'error.badParams': 'Parametri non validi',
  'error.incomplete': 'Parametri mancanti',
  'error.modelsLoad': 'Caricamento di models.json non riuscito: {msg}',
  'error.modelMissing': 'Modello non trovato: {provider}/{model}',
  'error.modelFailed': 'Chiamata al modello non riuscita: {msg}',
  'error.emptyModelRun':
    'Il modello non ha restituito nulla di utilizzabile e non ha scritto alcun file; controlla il gateway, la credenziale e il dialetto API',
  'error.modelTruncated':
    'Il modello ha raggiunto il limite max_tokens (il ragionamento ha consumato tutto il turno) e non ha scritto alcun file; aumenta max_tokens per questa configurazione nella console di amministrazione e riprova',
  'error.apiKeyMissing':
    'L’agente non ha la credenziale {env}; aggiungi il Secret in Cloud Run oppure riporta questa configurazione a una credenziale disponibile',
}
