import type { zh } from './zh'

/**
 * Worker 侧法语文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制),值是面向用户的法语文案。
 */
export const fr: Record<keyof typeof zh, string> = {
  listSep: ', ',
  'attach.marker': '\n\n📎 {count} pièce(s) jointe(s) : {names}',
  'connector.marker': '\n\n🔌 Connecteurs : {names}',
  'connector.readonly': '{provider} (lecture seule)',
  'connector.writable': '{provider} (écriture)',
  'commit.defaultAppName': 'votre application',
  'commit.generate':
    'Le premier brouillon de « {name} » est prêt et enregistré comme brouillon. Lorsque vous en êtes satisfait, cliquez sur « Enregistrer la version » pour le conserver comme version, puis publiez.',
  'commit.chat':
    'Brouillon mis à jour pour « {prompt} ». Lorsque vous en êtes satisfait, cliquez sur « Enregistrer la version » pour le conserver comme version.',
  'cancel.message': 'Cette exécution a été arrêtée (aucun crédit débité).',
  // ── 断点续跑(写进新一轮 chat 的用户消息 / 错误响应)──
  'resume.message':
    'Reprenez la tâche inachevée depuis la sauvegarde. Le code source actuel est exactement celui qui a été enregistré lorsque la dernière exécution s’est arrêtée (tout ce qui a déjà été écrit est toujours là) — construisez dessus au lieu de recommencer.',
  'resume.notUnfinished': 'Cette tâche n’est ni en échec ni arrêtée, il n’y a donc rien à reprendre',
  'resume.notLatest':
    'Cette tâche n’est plus la progression la plus récente du projet, elle ne peut donc pas être reprise (cela évite d’écraser un travail plus récent)',
  'resume.noCheckpoint':
    'Aucune sauvegarde de point de reprise n’est disponible (elle a peut-être expiré, ou la tâche n’en a jamais créé)',
  // ── 任务失败/取消(写进 jobs.error,前端原样展示)──
  'job.notStarted':
    'Le service d’exécution n’a pas accepté la tâche. Vérifiez sa configuration et réessayez.',
  'job.lost': 'Contact perdu avec le service d’exécution. Veuillez réessayer.',
  'job.timeout': 'La tâche a expiré. Veuillez la relancer.',
  'job.cancelled': 'Arrêtée manuellement',
  'job.failed': 'Échec de l’exécution',
  'job.waitTimeout': "Délai d'attente de confirmation dépassé, la tâche est terminée",
  'respond.noWaiting': "Aucune tâche en attente de confirmation",
  'respond.lostContext': 'Contexte de reprise manquant, impossible de continuer',
  'respond.invalidChoice': 'Choisissez une option valide',
  'respond.declined': 'Cette génération a été refusée',
  'respond.choose': 'Choisi : {choice}',
  'respond.approve': 'Confirmé, on continue',
  'respond.approveFeedback': 'Confirmé, avec précision : {feedback}',
  'commit.incomplete': 'Artefacts incomplets (arborescence source ou résultat de build manquant)',
  'commit.noJob': 'Tâche introuvable',
  'commit.noProject': 'Projet introuvable',
  'agent.failed': 'L’agent a échoué ({status}). Veuillez réessayer (aucun crédit débité)',
  'agent.noArtifact':
    'L’agent n’a renvoyé aucun artefact exploitable. Veuillez réessayer (aucun crédit débité)',
  // ── 注册验证邮件(发送时刻没有前端,语言由注册请求的 lang 决定)──
  'verify.subject': 'Vérifiez votre e-mail Forge',
  'verify.text':
    'Bienvenue sur Forge. Ouvrez le lien ci-dessous pour vérifier votre e-mail (valable 24 heures) :\n\n{link}\n\nSi vous n’avez pas créé ce compte, vous pouvez ignorer cet e-mail en toute sécurité.',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Vérifiez votre e-mail Forge</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">Cliquez sur le bouton ci-dessous pour vérifier votre e-mail. Le lien est valable 24 heures :</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Vérifier l’e-mail</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">Si vous n’avez pas créé ce compte, vous pouvez ignorer cet e-mail en toute sécurité.</p>' +
    '</div>',
}
