import type { zh } from './zh'

/**
 * Worker 侧西班牙语文案表。
 *
 * 键名必须与 `messages/zh.ts` 完全一致(类型层面已强制),值是面向用户的西班牙语文案。
 */
export const es: Record<keyof typeof zh, string> = {
  listSep: ', ',
  'attach.marker': '\n\n📎 {count} adjunto(s): {names}',
  'connector.marker': '\n\n🔌 Conectores: {names}',
  'connector.readonly': '{provider} (solo lectura)',
  'connector.writable': '{provider} (con escritura)',
  'commit.defaultAppName': 'tu app',
  'commit.generate':
    'El primer borrador de «{name}» está listo y se ha guardado como borrador. Cuando te guste, haz clic en «Guardar versión» para conservarlo como versión y luego publícalo.',
  'commit.chat':
    'Borrador actualizado para «{prompt}». Cuando te guste, haz clic en «Guardar versión» para conservarlo como versión.',
  'cancel.message': 'Esta ejecución se ha detenido (sin créditos descontados).',
  // ── 断点续跑(写进新一轮 chat 的用户消息 / 错误响应)──
  'resume.message':
    'Continúa la tarea sin terminar desde el punto de control. El código actual es exactamente el que se guardó cuando se detuvo la última ejecución (todo lo ya escrito sigue aquí): constrúyelo en lugar de empezar de cero.',
  'resume.notUnfinished':
    'Esta tarea no está en estado fallido o detenido, así que no hay nada que continuar',
  'resume.notLatest':
    'Esta tarea ya no es el progreso más reciente del proyecto, así que no se puede continuar desde ella (esto evita sobrescribir trabajo posterior)',
  'resume.noCheckpoint':
    'No hay ninguna instantánea de punto de control disponible (puede haber caducado o la tarea nunca llegó a escribirla)',
  // ── 任务失败/取消(写进 jobs.error,前端原样展示)──
  'job.notStarted':
    'El servicio de ejecución no ha aceptado la tarea. Revisa su configuración e inténtalo de nuevo.',
  'job.lost': 'Se ha perdido el contacto con el servicio de ejecución. Inténtalo de nuevo.',
  'job.timeout': 'La tarea ha agotado el tiempo. Vuelve a iniciarla.',
  'job.cancelled': 'Detenida manualmente',
  'job.failed': 'La ejecución ha fallado',
  'job.waitTimeout': 'Se agotó la espera de tu confirmación; la tarea ha terminado',
  'respond.noWaiting': 'No hay ninguna tarea esperando confirmación',
  'respond.lostContext': 'Falta el contexto de recuperación; no se puede continuar',
  'respond.invalidChoice': 'Elige una opción válida',
  'respond.declined': 'Esta generación se ha descartado',
  'respond.choose': 'Elegido: {choice}',
  'respond.approve': 'Confirmado, continuando',
  'respond.approveFeedback': 'Confirmado, con comentarios: {feedback}',
  'commit.incomplete': 'Artefacto incompleto (falta el árbol de fuentes o la salida de compilación)',
  'commit.noJob': 'La tarea no existe',
  'commit.noProject': 'El proyecto no existe',
  'agent.failed':
    'El agente ha fallado ({status}). Inténtalo de nuevo (sin créditos descontados)',
  'agent.noArtifact':
    'El agente no ha devuelto ningún artefacto utilizable. Inténtalo de nuevo (sin créditos descontados)',
  // ── 注册验证邮件(发送时刻没有前端,语言由注册请求的 lang 决定)──
  'verify.subject': 'Verifica tu correo de Forge',
  'verify.text':
    'Te damos la bienvenida a Forge. Abre el enlace de abajo para verificar tu correo (válido durante 24 horas):\n\n{link}\n\nSi no has creado esta cuenta, puedes ignorar este correo sin problema.',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Verifica tu correo de Forge</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">Haz clic en el botón de abajo para verificar tu correo. El enlace es válido durante 24 horas:</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Verificar correo</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">Si no has creado esta cuenta, puedes ignorar este correo sin problema.</p>' +
    '</div>',
}
