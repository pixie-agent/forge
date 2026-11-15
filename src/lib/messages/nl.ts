import type { zh } from './zh'

/**
 * Worker-side Dutch copy table.
 *
 * The key names must match `messages/zh.ts` exactly (enforced at the type level);
 * the values are the user-facing Dutch strings.
 */
export const nl: Record<keyof typeof zh, string> = {
  listSep: ', ',
  'attach.marker': '\n\n📎 {count} bijlage(n): {names}',
  'connector.marker': '\n\n🔌 Connectors: {names}',
  'connector.readonly': '{provider} (alleen lezen)',
  'connector.writable': '{provider} (met schrijfrechten)',
  'commit.defaultAppName': 'je app',
  'commit.generate':
    'Het eerste concept van “{name}” staat klaar en is opgeslagen als concept. Als je tevreden bent, klik je op “Versie opslaan” om het als versie te bewaren, en daarna publiceer je het.',
  'commit.chat':
    'Concept bijgewerkt voor “{prompt}”. Als je tevreden bent, klik je op “Versie opslaan” om het als versie te bewaren.',
  'cancel.message': 'Deze run is gestopt (geen credits afgeschreven).',
  // ── Resume vanaf checkpoint (geschreven in een nieuwe chatronde / foutreactie) ──
  'resume.message':
    'Ga verder met de onafgeronde taak vanaf het checkpoint. De huidige broncode is precies wat er is opgeslagen toen de laatste run stopte (alles wat al geschreven is, staat er nog) — bouw daarop voort in plaats van opnieuw te beginnen.',
  'resume.notUnfinished': 'Deze taak is niet mislukt of gestopt, dus er valt niets te hervatten',
  'resume.notLatest':
    'Deze taak is niet meer de nieuwste voortgang voor het project en kan dus niet worden hervat (zo wordt nieuwer werk niet overschreven)',
  'resume.noCheckpoint':
    'Er is geen checkpoint-snapshot beschikbaar (die is misschien verlopen, of de taak heeft er nooit een gemaakt)',
  // ── Taak mislukt/gestopt (geschreven in jobs.error, wordt letterlijk getoond) ──
  'job.notStarted': 'De uitvoeringsdienst heeft de taak niet geaccepteerd. Controleer de configuratie en probeer het opnieuw.',
  'job.lost': 'Het contact met de uitvoeringsdienst is verbroken. Probeer het opnieuw.',
  'job.timeout': 'De taak heeft de time-out overschreden. Start hem opnieuw.',
  'job.cancelled': 'Handmatig gestopt',
  'job.failed': 'Uitvoering mislukt',
  'commit.incomplete': 'Onvolledig artefact (broncodeboom of buildoutput ontbreekt)',
  'commit.noJob': 'Taak niet gevonden',
  'commit.noProject': 'Project niet gevonden',
  'agent.failed': 'De agent is mislukt ({status}). Probeer het opnieuw (geen credits afgeschreven)',
  'agent.noArtifact': 'De agent gaf geen bruikbaar artefact terug. Probeer het opnieuw (geen credits afgeschreven)',
  // ── Registratieverificatiemail (bij verzenden is er geen frontend; de taal komt uit de lang van het registratieverzoek) ──
  'verify.subject': 'Verifieer je Forge-e-mailadres',
  'verify.text':
    'Welkom bij Forge. Open de link hieronder om je e-mailadres te verifiëren (24 uur geldig):\n\n{link}\n\nAls je dit account niet hebt aangemaakt, kun je deze mail negeren.',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Verifieer je Forge-e-mailadres</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">Klik op de knop hieronder om je e-mailadres te verifiëren. De link is 24 uur geldig:</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">E-mail verifiëren</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">Werkt de knop niet? Kopieer deze link naar je browser:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">Als je dit account niet hebt aangemaakt, kun je deze mail negeren.</p>' +
    '</div>',
}
