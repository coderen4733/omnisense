import { request } from './client'
import type { RunDetail, RunListQuery, RunListResponse, RunStats } from './types'

//  * 실행 기록 / 모니터링 API 모음 - backend/src/services/run/router.py 와 연결
//  - 실행 기록은 워크플로우를 실행할 때 서버가 자동으로 저장함 (조회 API만 있음)
//  - 일반 사용자(user)에게는 자기가 실행한 기록만 옴

// 실행 기록 목록 조회 (GET /runs/) - 최근 실행 순서
export function getRuns(query: RunListQuery = {}) {
  return request<RunListResponse>('/runs/', { query: { ...query } })
}

// 실행 기록 상세 조회 (GET /runs/{id}) - 실행 당시 그래프 + 노드 기록 포함
export function getRun(runId: number) {
  return request<RunDetail>(`/runs/${runId}`)
}

//  * 모니터링 통계 조회 (GET /runs/stats) - admin, manager
//  - days: 최근 며칠 (오늘 포함)
//  - tz: 날짜를 나누는 기준 시간대 => 브라우저의 시간대를 보냄 (예: Asia/Seoul)
export function getRunStats(days: number) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'
  return request<RunStats>('/runs/stats', { query: { days, tz } })
}
