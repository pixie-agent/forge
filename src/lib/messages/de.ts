import type { zh } from './zh'

/**
 * Deutsche Texte auf Worker-Seite (serverseitige Kopie).
 *
 * Die Schlüssel müssen exakt mit `messages/zh.ts` übereinstimmen (typseitig erzwungen).
 */
export const de: Record<keyof typeof zh, string> = {
  listSep: ', ',
  'attach.marker': '\n\n📎 {count} Anhang/Anhänge: {names}',
  'connector.marker': '\n\n🔌 Connectors: {names}',
  'connector.readonly': '{provider} (nur Lesezugriff)',
  'connector.writable': '{provider} (mit Schreibzugriff)',
  'commit.defaultAppName': 'Ihre App',
  'commit.generate':
    'Der erste Entwurf von „{name}“ ist fertig und als Entwurf gespeichert. Wenn Sie zufrieden sind, klicken Sie auf „Version speichern“, um ihn als Version zu sichern, und veröffentlichen Sie ihn dann.',
  'commit.chat': 'Der Entwurf wurde anhand von „{prompt}“ aktualisiert. Wenn Sie zufrieden sind, klicken Sie auf „Version speichern“, um ihn als Version zu sichern.',
  'cancel.message': 'Dieser Lauf wurde gestoppt (keine Guthaben abgezogen).',
  // ── Fortsetzen vom Zwischenstand (geschrieben in die Nutzernachricht / Fehlerantwort)──
  'resume.message':
    'Setzen Sie die unvollständige Aufgabe ab dem Zwischenstand fort. Der aktuelle Quellcode entspricht genau dem Stand, der beim Abbruch des letzten Laufs gespeichert wurde (alles bereits Geschriebene ist noch da) – bauen Sie darauf auf, statt neu zu beginnen.',
  'resume.notUnfinished': 'Diese Aufgabe ist nicht fehlgeschlagen/gestoppt, es gibt nichts fortzusetzen',
  'resume.notLatest':
    'Diese Aufgabe ist nicht mehr der neueste Fortschritt des Projekts und kann daher nicht fortgesetzt werden (so wird neuere Arbeit nicht überschrieben)',
  'resume.noCheckpoint':
    'Es ist kein Snapshot vom Zwischenstand verfügbar (er ist möglicherweise abgelaufen oder die Aufgabe hat noch keinen geschrieben)',
  // ── Auftrag fehlgeschlagen/abgebrochen (geschrieben in jobs.error, wird direkt angezeigt)──
  'job.notStarted': 'Der Ausführungsdienst hat den Auftrag nicht angenommen. Prüfen Sie dessen Konfiguration und versuchen Sie es erneut.',
  'job.lost': 'Die Verbindung zum Ausführungsdienst ist abgebrochen. Bitte versuchen Sie es erneut.',
  'job.timeout': 'Der Auftrag hat das Zeitlimit überschritten. Bitte starten Sie ihn erneut.',
  'job.cancelled': 'Manuell gestoppt',
  'job.failed': 'Ausführung fehlgeschlagen',
  'commit.incomplete': 'Unvollständiges Artefakt (Quellbaum oder Build-Ausgabe fehlt)',
  'commit.noJob': 'Auftrag nicht gefunden',
  'commit.noProject': 'Projekt nicht gefunden',
  'agent.failed': 'Der Agent ist fehlgeschlagen ({status}). Bitte versuchen Sie es erneut (keine Guthaben abgezogen)',
  'agent.noArtifact': 'Der Agent hat kein verwendbares Artefakt zurückgegeben. Bitte versuchen Sie es erneut (keine Guthaben abgezogen)',
  // ── Bestätigungs-E-Mail bei der Registrierung (beim Senden gibt es kein Frontend; die Sprache kommt aus `lang` der Registrierungsanfrage)──
  'verify.subject': 'Bestätigen Sie Ihre Forge-E-Mail-Adresse',
  'verify.text':
    'Willkommen bei Forge. Öffnen Sie den folgenden Link, um Ihre E-Mail-Adresse zu bestätigen (24 Stunden gültig):\n\n{link}\n\nFalls Sie dieses Konto nicht erstellt haben, können Sie diese E-Mail bedenkenlos ignorieren.',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Bestätigen Sie Ihre Forge-E-Mail-Adresse</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">Klicken Sie auf die Schaltfläche unten, um Ihre E-Mail-Adresse zu bestätigen. Der Link ist 24 Stunden gültig:</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">E-Mail bestätigen</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">Falls Sie dieses Konto nicht erstellt haben, können Sie diese E-Mail bedenkenlos ignorieren.</p>' +
    '</div>',
}
