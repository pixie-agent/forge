import type { zh } from './zh'

/**
 * Worker 측 한국어 문구표.
 *
 * 키 이름은 `messages/zh.ts`와 완전히 일치해야 합니다(타입 수준에서 강제됨).
 */
export const ko: Record<keyof typeof zh, string> = {
  listSep: ', ',
  'attach.marker': '\n\n📎 첨부 {count}개: {names}',
  'connector.marker': '\n\n🔌 커넥터: {names}',
  'connector.readonly': '{provider}(읽기 전용)',
  'connector.writable': '{provider}(쓰기 가능)',
  'commit.defaultAppName': '앱',
  'commit.generate':
    '「{name}」의 초안을 완성해 초안으로 저장했습니다. 만족하면 「새 버전 만들기」를 눌러 공식 버전으로 남기고, 그다음 게시하세요.',
  'commit.chat': '「{prompt}」에 맞춰 초안을 고쳤습니다. 만족하면 「새 버전 만들기」를 눌러 공식 버전으로 남기세요.',
  'cancel.message': '이번 작업을 중단했습니다(크레딧 차감 없음).',
  // ── 체크포인트 이어서 실행(새로운 chat의 사용자 메시지 / 오류 응답으로 기록)──
  'resume.message':
    '지난번에 끝내지 못한 작업을 체크포인트에서 이어서 진행하세요. 지금의 소스는 마지막 실행이 중단될 때 저장된 그대로이며(이미 쓰인 파일이 모두 남아 있습니다), 처음부터 다시 쓰지 말고 그 위에서 이어 완성해 주세요.',
  'resume.notUnfinished': '이 작업은 실패/중단 상태가 아니어서 체크포인트에서 이어 갈 수 없습니다',
  'resume.notLatest': '이 작업은 프로젝트의 최신 진행 상태가 아니어서 이어 갈 수 없습니다(뒤이어 생성된 내용을 덮어쓰지 않기 위함입니다)',
  'resume.noCheckpoint': '사용할 수 있는 체크포인트 스냅샷이 없습니다(만료되었거나 이 작업이 아직 스냅샷을 남기지 않았을 수 있습니다)',
  // ── 작업 실패/취소(jobs.error에 기록, 프런트엔드가 그대로 표시)──
  'job.notStarted': '실행 서비스가 작업을 받지 못했습니다. 설정을 확인한 뒤 다시 시도해 주세요',
  'job.lost': '작업 실행체와 연결이 끊어졌습니다. 다시 시도해 주세요',
  'job.timeout': '작업이 시간이 초과되어 끝나지 않았습니다. 다시 시작해 주세요',
  'job.cancelled': '직접 중단함',
  'job.failed': '실행에 실패했습니다',
  'commit.incomplete': '산출물이 불완전합니다(소스 트리 또는 빌드 결과 없음)',
  'commit.noJob': '작업이 존재하지 않습니다',
  'commit.noProject': '프로젝트가 존재하지 않습니다',
  'agent.failed': 'Agent 실행에 실패했습니다({status}). 다시 시도해 주세요(크레딧 차감 없음)',
  'agent.noArtifact': 'Agent가 쓸 만한 산출물을 반환하지 않았습니다. 다시 시도해 주세요(크레딧 차감 없음)',
  // ── 가입 인증 이메일(보내는 시점에 프런트엔드가 없으며, 언어는 가입 요청의 lang으로 결정)──
  'verify.subject': 'Forge 이메일 인증',
  'verify.text':
    'Forge에 오신 것을 환영합니다. 아래 링크로 이메일을 인증해 주세요(24시간 동안 유효합니다):\n\n{link}\n\n직접 가입하신 것이 아니라면 이 메일은 무시하셔도 됩니다.',
  'verify.html':
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 12px">Forge 이메일 인증</h2>' +
    '<p style="margin:0 0 16px;line-height:1.6">아래 버튼을 눌러 이메일을 인증해 주세요. 링크는 24시간 동안 유효합니다:</p>' +
    '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">이메일 인증</a></p>' +
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">버튼이 눌리지 않으면 이 링크를 브라우저로 복사해 주세요:<br><span style="word-break:break-all;color:#4f46e5">{link}</span></p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#666">직접 가입하신 것이 아니라면 이 메일은 무시하셔도 됩니다.</p>' +
    '</div>',
}
