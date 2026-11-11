import type { RunStatus, UserRole } from '../api/types'

//  * 실행 기록 / 모니터링 화면에서 쓰는 값 모음

// 모니터링 화면(통계, 모든 사용자의 실행 기록)을 볼 수 있는 권한 (백엔드 run/router.py 권한과 동일)
export const MONITORING_ROLES: UserRole[] = ['admin', 'manager']

//  * 실행 상태별 화면 정보
//  - label: 화면 표시 이름 / tone: 알약(pill) 색 (styles/global.css 의 .pill-xxx)
export const RUN_STATUS_META: Record<RunStatus, { label: string; tone: string }> = {
  running: { label: '실행 중', tone: 'blue' },
  succeeded: { label: '성공', tone: 'green' },
  failed: { label: '실패', tone: 'red' },
  stopped: { label: '중지', tone: 'gray' },
}

// 실행 상태 선택 목록 (실행 기록 필터)
export const RUN_STATUS_OPTIONS: { value: RunStatus; label: string }[] = (
  Object.keys(RUN_STATUS_META) as RunStatus[]
).map((status) => ({ value: status, label: RUN_STATUS_META[status].label }))

// 모니터링 기간 선택 목록 (값: 최근 며칠, 오늘 포함)
export const RUN_PERIOD_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '오늘' },
  { value: 7, label: '최근 7일' },
  { value: 30, label: '최근 30일' },
  { value: 90, label: '최근 90일' },
]

//  * 걸린 시간 표시 (밀리초 => 읽기 쉬운 글자)
//  - 예) 850 => "0.85초", 12_340 => "12.3초", 95_000 => "1분 35초", null => "-"
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return '-'
  }
  if (ms < 10_000) {
    return `${(ms / 1000).toFixed(2)}초`
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}초`
  }
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}분 ${seconds}초`
}
