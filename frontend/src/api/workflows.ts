import { request, streamRequest } from './client'
import type {
  Workflow,
  WorkflowCreateRequest,
  WorkflowRunEvent,
  WorkflowRunRequest,
  WorkflowSummary,
  WorkflowUpdateRequest,
} from './types'

//  * 워크플로우 API 모음 - backend/src/services/workflow/router.py 와 연결

// 워크플로우 목록 조회 (GET /workflows/) - 일반 사용자에게는 "사용" 상태인 워크플로우만 옴
export function getWorkflows() {
  return request<WorkflowSummary[]>('/workflows/')
}

// 워크플로우 조회 (GET /workflows/{id}) - 그래프 + 실행 전에 고쳐야 할 문제 목록 포함
export function getWorkflow(workflowId: number) {
  return request<Workflow>(`/workflows/${workflowId}`)
}

// 워크플로우 만들기 (POST /workflows/) - admin, manager / 기본 그래프(시작 => 끝)로 만들어짐
export function createWorkflow(data: WorkflowCreateRequest) {
  return request<Workflow>('/workflows/', { method: 'POST', body: data })
}

// 워크플로우 수정 (PATCH /workflows/{id}) - admin, manager / 편집 화면의 "저장"도 이 API 사용
export function updateWorkflow(workflowId: number, data: WorkflowUpdateRequest) {
  return request<Workflow>(`/workflows/${workflowId}`, { method: 'PATCH', body: data })
}

// 워크플로우 삭제 (DELETE /workflows/{id}) - admin, manager
export function deleteWorkflow(workflowId: number) {
  return request<{ success: boolean }>(`/workflows/${workflowId}`, { method: 'DELETE' })
}

// [수정] * 워크플로우 실행 API 추가 [2026-11-10 16:50]
// [기존] 목록/조회/만들기/수정/삭제 API만 있었습니다.
// [변경] 실행 API(스트리밍)를 추가했습니다.

//  * 워크플로우 실행 (POST /workflows/{id}/run) - 스트리밍
//  - 노드별 진행 상황이 실행되는 대로 onEvent로 전달됨 (마지막으로 저장한 그래프 기준으로 실행)
//  - signal: 중지 버튼용 / 스트리밍 도중 오류는 { type: 'error' } 이벤트로 전달됨
export function streamWorkflowRun(
  workflowId: number,
  data: WorkflowRunRequest,
  onEvent: (event: WorkflowRunEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamRequest<WorkflowRunEvent>(`/workflows/${workflowId}/run`, data, onEvent, signal)
}
