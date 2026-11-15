import type { zh } from './zh.js'

/**
 * agent 측 한국어 문구표.
 *
 * 키 이름은 `messages/zh.ts`와 완전히 일치해야 합니다(타입 수준에서 강제됨).
 */
export const ko: Record<keyof typeof zh, string> = {
  // ── 작업 진행(작업 진행 상황으로 기록, 프런트엔드가 그대로 표시)──
  'progress.plan': '기획하는 중',
  'progress.chatEdit': '요청하신 변경을 반영하는 중',
  'progress.planned': '기획 완료, 앱을 구현하는 중',
  'progress.writing': '{file} 작성 중 · 파일 {count}개 수정',
  'progress.building': '앱 산출물을 빌드하는 중',
  'progress.polish': '디자인 리뷰와 다듬기를 진행하는 중',
  'progress.rebuilding': '앱 산출물을 다시 빌드하는 중',
  'progress.queued': '대기 중 — 앞에 {n}개의 작업이 남아 있어요',
  'progress.queuedNow': '대기 중 — 곧 시작합니다',
  // ── 스트리밍 로그(대화창의 「과정」 패널)──
  'log.polishStart': '\n💭 디자인 리뷰 라운드 시작\n',
  'log.polishFallback': '\n⚠️ 리뷰 라운드 빌드 실패 — 첫 번째 결과를 유지합니다\n',
  'log.polishUndone': '\n⚠️ 리뷰 라운드를 끝내지 못했습니다 — 첫 번째 결과를 유지합니다({msg})\n',
  'log.polishEnd': '\n💭 디자인 리뷰 라운드 종료\n',
  'log.deliveryLangRetry': '\n🔁 전달 안내 언어가 맞지 않아 다시 물어봅니다\n',
  // ── 오류(작업 오류로 기록, 프런트엔드가 그대로 표시)──
  'error.buildFailed': '빌드 실패: {detail}',
  'error.buildNotPass': 'vite build가 통과되지 않았습니다',
  'error.timeout': 'Agent 실행 시간이 초과되었습니다(최대 {s}초)',
  'error.cancelled': '사용자가 작업을 중단했습니다',
  'error.bodyTooLarge': '요청 본문이 너무 큽니다',
  'error.badJson': '요청 본문이 올바른 JSON이 아닙니다',
  'error.notFound': '없음',
  'error.unauthorized': '권한 없음',
  'error.badParams': '잘못된 매개변수입니다',
  'error.incomplete': '매개변수가 빠졌습니다',
  'error.modelsLoad': 'models.json을 불러오지 못했습니다: {msg}',
  'error.modelMissing': '모델을 찾을 수 없습니다: {provider}/{model}',
  'error.modelFailed': '모델 호출에 실패했습니다: {msg}',
  'error.emptyModelRun':
    '모델이 쓸 만한 내용을 반환하지도, 파일 하나 쓰지도 않았습니다. 게이트웨이, 자격 증명, API 방식을 확인해 주세요',
  'error.modelTruncated':
    '모델 출력이 max_tokens에 잘려 파일을 하나도 쓰지 못했습니다(사고 과정이 한 번의 호출 한도를 모두 사용했습니다). 관리자 콘솔에서 이 설정의 max_tokens를 늘린 뒤 다시 시도해 주세요',
  'error.apiKeyMissing':
    '실행체에 자격 증명 {env}가 바인딩되어 있지 않습니다. Cloud Run에서 Secret을 추가하거나 이 설정을 쓸 수 있는 자격 증명으로 되돌려 주세요',
}
