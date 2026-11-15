import type { zh } from './zh.js'

/**
 * Deutsche Texte auf Agent-Seite.
 *
 * Die Schlüssel müssen exakt mit `messages/zh.ts` übereinstimmen (typseitig erzwungen).
 */
export const de: Record<keyof typeof zh, string> = {
  // ── Auftragsfortschritt (geschrieben in jobs.progress, wird direkt angezeigt)──
  'progress.plan': 'Die App wird geplant',
  'progress.chatEdit': 'Ihre Änderungen werden umgesetzt',
  'progress.planned': 'Plan steht, die App wird gebaut',
  'progress.writing': '{file} wird geschrieben · {count} Datei(en) geändert',
  'progress.building': 'Die App wird gebaut',
  'progress.polish': 'Das Design-Review läuft',
  'progress.rebuilding': 'Die App wird neu gebaut',
  'progress.queued': 'In der Warteschlange – {n} Aufgabe(n) vor Ihnen',
  'progress.queuedNow': 'In der Warteschlange – startet in Kürze',
  // ── Streaming-Log (Bereich „Prozess“ im Chat)──
  'log.polishStart': '\n💭 Design-Review gestartet\n',
  'log.polishFallback': '\n⚠️ Review-Build fehlgeschlagen – das erste Ergebnis bleibt erhalten\n',
  'log.polishUndone': '\n⚠️ Review nicht abgeschlossen – das erste Ergebnis bleibt erhalten ({msg})\n',
  'log.polishEnd': '\n💭 Design-Review abgeschlossen\n',
  'log.deliveryLangRetry': '\n🔁 Die Übergabenotiz war in der falschen Sprache – wir fragen erneut nach\n',
  // ── Fehler (geschrieben in jobs.error, wird direkt angezeigt)──
  'error.buildFailed': 'Build fehlgeschlagen: {detail}',
  'error.buildNotPass': 'vite build ist nicht durchgelaufen',
  'error.timeout': 'Zeitüberschreitung des Agenten (Limit {s}s)',
  'error.cancelled': 'Der Auftrag wurde vom Benutzer gestoppt',
  'error.bodyTooLarge': 'Der Anfragekörper ist zu groß',
  'error.badJson': 'Der Anfragekörper ist kein gültiges JSON',
  'error.notFound': 'Nicht gefunden',
  'error.unauthorized': 'Nicht autorisiert',
  'error.badParams': 'Ungültige Parameter',
  'error.incomplete': 'Fehlende Parameter',
  'error.modelsLoad': 'models.json konnte nicht geladen werden: {msg}',
  'error.modelMissing': 'Modell nicht gefunden: {provider}/{model}',
  'error.modelFailed': 'Modellaufruf fehlgeschlagen: {msg}',
  'error.emptyModelRun':
    'Das Modell hat nichts Verwendbares zurückgegeben und keine Dateien geschrieben; prüfen Sie Gateway, Zugangsdaten und API-Dialekt',
  'error.modelTruncated':
    'Das Modell hat das max_tokens-Limit erreicht (das Denken hat die gesamte Runde verbraucht) und keine Dateien geschrieben; erhöhen Sie max_tokens für diese Konfiguration in der Admin-Konsole und versuchen Sie es erneut',
  'error.apiKeyMissing':
    'Der Agent hat keine Zugangsdaten {env}; binden Sie das Secret in Cloud Run oder setzen Sie diese Konfiguration wieder auf eine verfügbare Zugangsberechtigung um',
}
