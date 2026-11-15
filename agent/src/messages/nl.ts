import type { zh } from './zh.js'

/**
 * Agent-side Dutch copy table.
 *
 * The key names must match `messages/zh.ts` exactly (enforced at the type level).
 */
export const nl: Record<keyof typeof zh, string> = {
  // ── Taakvoortgang (geschreven in jobs.progress, wordt letterlijk getoond) ──
  'progress.plan': 'De app wordt gepland',
  'progress.chatEdit': 'Je wijzigingen worden doorgevoerd',
  'progress.planned': 'Planning klaar, de app wordt gebouwd',
  'progress.writing': '{file} wordt geschreven · {count} bestand(en) gewijzigd',
  'progress.building': 'De app wordt gebouwd',
  'progress.polish': 'De designreview loopt',
  'progress.rebuilding': 'De app wordt opnieuw gebouwd',
  'progress.queued': 'In de wachtrij — er staan {n} taak/taken voor je',
  'progress.queuedNow': 'In de wachtrij — begint zo',
  // ── Streaminglog (het paneel “Proces” in de chat) ──
  'log.polishStart': '\n💭 Designreview gestart\n',
  'log.polishFallback': '\n⚠️ De reviewbuild is mislukt — we houden de eerste ronde aan\n',
  'log.polishUndone': '\n⚠️ De review is niet afgerond — we houden de eerste ronde aan ({msg})\n',
  'log.polishEnd': '\n💭 Designreview afgerond\n',
  'log.deliveryLangRetry': '\n🔁 De opleveringsnotitie stond in de verkeerde taal — we vragen het opnieuw\n',
  // ── Fouten (geschreven in jobs.error, wordt letterlijk getoond) ──
  'error.buildFailed': 'Build mislukt: {detail}',
  'error.buildNotPass': 'vite build is niet geslaagd',
  'error.timeout': 'Agent had een time-out (limiet {s}s)',
  'error.cancelled': 'Taak gestopt door de gebruiker',
  'error.bodyTooLarge': 'Aanvraagbody is te groot',
  'error.badJson': 'Aanvraagbody is geen geldige JSON',
  'error.notFound': 'Niet gevonden',
  'error.unauthorized': 'Niet geautoriseerd',
  'error.badParams': 'Ongeldige parameters',
  'error.incomplete': 'Ontbrekende parameters',
  'error.modelsLoad': 'Laden van models.json mislukt: {msg}',
  'error.modelMissing': 'Model niet gevonden: {provider}/{model}',
  'error.modelFailed': 'Modelaanroep mislukt: {msg}',
  'error.emptyModelRun':
    'Het model gaf niets bruikbaars terug en schreef geen bestanden; controleer de gateway, de credential en de API-dialect',
  'error.modelTruncated':
    'Het model raakte de max_tokens-limiet (het denken vulde de hele beurt) en schreef geen bestanden; verhoog max_tokens voor deze configuratie in de beheerconsole en probeer het opnieuw',
  'error.apiKeyMissing':
    'De agent heeft geen credential {env}; bind de Secret in Cloud Run of zet deze configuratie terug naar een beschikbare credential',
}
