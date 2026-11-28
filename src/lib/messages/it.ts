import type { zh } from './zh'

/**
 * Worker-side Italian copy table.
 *
 * The keys must match `messages/zh.ts` exactly (enforced at the type level).
 */
export const it: Record<keyof typeof zh, string> = {
  listSep: ', ',
  'attach.marker': '\n\n📎 {count} allegati: {names}',
  'connector.marker': '\n\n🔌 Connettori: {names}',
  'connector.readonly': '{provider} (sola lettura)',
  'connector.writable': '{provider} (con scrittura)',
  'commit.defaultAppName': 'la tua app',
  'commit.generate':
    'La prima bozza di «{name}» è pronta ed è stata salvata come bozza. Quando sei soddisfatto, clicca «Salva la versione» per tenerla come versione, poi pubblicala.',
  'commit.chat': 'Bozza aggiornata per «{prompt}». Quando sei soddisfatto, clicca «Salva la versione» per tenerla come versione.',
  'cancel.message': 'Questa esecuzione è stata fermata (nessun credito scalato).',
  // ── resume from checkpoint (written into a new chat user message / error response) ──
  'resume.message':
    'Continua l’attività interrotta partendo dal checkpoint. Il sorgente attuale è esattamente quello salvato quando l’ultima esecuzione si è fermata (tutto ciò che era già stato scritto è ancora qui) — costruisci su quello invece di ricominciare da capo.',
  'resume.notUnfinished': 'Questa attività non è né fallita né fermata, quindi non c’è nulla da riprendere',
  'resume.notLatest':
    'Questa attività non è più l’ultimo avanzamento del progetto, quindi non può essere ripresa (evita di sovrascrivere lavoro più recente)',
  'resume.noCheckpoint':
    'Non è disponibile nessuno snapshot del checkpoint (potrebbe essere scaduto, oppure l’attività non ne ha mai scritto uno)',
  // ── job failure / cancellation (written into jobs.error, shown as-is) ──
  'job.notStarted': 'Il servizio di esecuzione non ha accettato l’attività. Controlla la configurazione e riprova.',
  'job.lost': 'Contatto perso con il servizio di esecuzione. Riprova.',
  'job.timeout': 'L’attività è scaduta. Riavviala.',
  'job.cancelled': 'Fermata manualmente',
  'job.failed': 'Esecuzione non riuscita',
  'job.waitTimeout': "Tempo scaduto in attesa della tua conferma; l'attività è terminata",
  'respond.noWaiting': "Nessuna attività in attesa di conferma",
  'respond.lostContext': "Contesto di ripresa mancante, impossibile continuare",
  'respond.invalidChoice': "Scegli un'opzione valida",
  'respond.declined': 'Questa generazione è stata rifiutata',
  'respond.choose': 'Scelto: {choice}',
  'respond.approve': 'Confermato, si continua',
  'respond.approveFeedback': 'Confermato, con integrazione: {feedback}',
  'commit.incomplete': 'Artefatto incompleto (manca il sorgente o gli artefatti della build)',
  'commit.noJob': 'Attività non trovata',
  'commit.noProject': 'Progetto non trovato',
  'agent.failed': 'L’agente è fallito ({status}). Riprova (nessun credito scalato)',
  'agent.noArtifact': 'L’agente non ha restituito un artefatto utilizzabile. Riprova (nessun credito scalato)',
  // ── signup verification email (no frontend at send time; language comes from the request lang) ──
  'verify.subject': 'Verifica la tua email Forge',
  'verify.text':
    'Benvenuto su Forge. Apri il link qui sotto per verificare la tua email (valido per 24 ore):\n\n{link}\n\nSe non hai creato tu questo account, puoi ignorare questa email.',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Verifica la tua email Forge</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">Clicca il pulsante qui sotto per verificare la tua email. Il link è valido per 24 ore:</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Verifica l’email</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">Se il pulsante non funziona, copia questo link nel browser:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">Se non hai creato tu questo account, puoi ignorare questa email.</p>' +
    '</div>',
}
