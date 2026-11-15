import type { zh } from './zh'

/**
 * Worker-side Portuguese (pt-BR) copy table.
 *
 * The key names must match `messages/zh.ts` exactly (enforced by the type); the values are
 * user-facing Portuguese copy.
 */
export const pt: Record<keyof typeof zh, string> = {
  listSep: ', ',
  'attach.marker': '\n\n📎 {count} anexo(s): {names}',
  'connector.marker': '\n\n🔌 Conectores: {names}',
  'connector.readonly': '{provider} (somente leitura)',
  'connector.writable': '{provider} (com escrita)',
  'commit.defaultAppName': 'seu app',
  'commit.generate':
    'O primeiro rascunho de “{name}” está pronto e foi salvo como rascunho. Quando estiver satisfeito, clique em “Salvar versão” para guardá-lo como uma versão e depois publique.',
  'commit.chat':
    'Rascunho atualizado para “{prompt}”. Quando estiver satisfeito, clique em “Salvar versão” para guardá-lo como uma versão.',
  'cancel.message': 'Esta execução foi interrompida (nenhum crédito cobrado).',
  // ── 断点续跑(写进新一轮 chat 的用户消息 / 错误响应)──
  'resume.message':
    'Continue a tarefa inacabada a partir do checkpoint. O código atual é exatamente o que foi salvo quando a última execução parou (tudo o que já foi escrito continua aqui) — continue a partir dele em vez de recomeçar.',
  'resume.notUnfinished': 'Esta tarefa não está falhada nem interrompida, então não há nada para retomar',
  'resume.notLatest':
    'Esta tarefa já não é o progresso mais recente do projeto, então não pode ser retomada (isso evita sobrescrever trabalhos mais novos)',
  'resume.noCheckpoint':
    'Nenhum snapshot de checkpoint disponível (pode ter expirado ou a tarefa nunca gravou um)',
  // ── 任务失败/取消(写进 jobs.error,前端原样展示)──
  'job.notStarted':
    'O serviço de execução não aceitou a tarefa. Verifique a configuração dele e tente novamente.',
  'job.lost': 'Perdemos o contato com o serviço de execução. Tente novamente.',
  'job.timeout': 'A tarefa expirou. Comece-a de novo.',
  'job.cancelled': 'Interrompido manualmente',
  'job.failed': 'Falha na execução',
  'commit.incomplete': 'Artefato incompleto (falta a árvore de código-fonte ou a saída do build)',
  'commit.noJob': 'Tarefa não encontrada',
  'commit.noProject': 'Projeto não encontrado',
  'agent.failed': 'O agente falhou ({status}). Tente novamente (nenhum crédito cobrado)',
  'agent.noArtifact': 'O agente não retornou nenhum artefato utilizável. Tente novamente (nenhum crédito cobrado)',
  // ── 注册验证邮件(发送时刻没有前端,语言由注册请求的 lang 决定)──
  'verify.subject': 'Verifique seu e-mail do Forge',
  'verify.text':
    'Boas-vindas ao Forge. Abra o link abaixo para verificar seu e-mail (válido por 24 horas):\n\n{link}\n\nSe você não criou esta conta, pode ignorar este e-mail com segurança.',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Verifique seu e-mail do Forge</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">Clique no botão abaixo para verificar seu e-mail. O link é válido por 24 horas:</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Verificar e-mail</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">Se o botão não funcionar, copie este link para o seu navegador:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">Se você não criou esta conta, pode ignorar este e-mail com segurança.</p>' +
    '</div>',
}
