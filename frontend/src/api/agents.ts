import { request, streamRequest } from './client'
import type {
  Agent,
  AgentCreateRequest,
  AgentRunEvent,
  AgentRunRequest,
  AgentTool,
  AgentUpdateRequest,
} from './types'

//  * 에이전트 API 모음 - backend/src/services/agent/router.py 와 연결

// 에이전트에 연결할 수 있는 도구 목록 (GET /agents/tools)
export function getAgentTools() {
  return request<AgentTool[]>('/agents/tools')
}

// 에이전트 목록 조회 (GET /agents/) - 일반 사용자에게는 "사용" 상태인 에이전트만 옴
export function getAgents() {
  return request<Agent[]>('/agents/')
}

// 에이전트 조회 (GET /agents/{id})
export function getAgent(agentId: number) {
  return request<Agent>(`/agents/${agentId}`)
}

// 에이전트 등록 (POST /agents/) - admin, manager
export function createAgent(data: AgentCreateRequest) {
  return request<Agent>('/agents/', { method: 'POST', body: data })
}

// 에이전트 수정 (PATCH /agents/{id}) - admin, manager
export function updateAgent(agentId: number, data: AgentUpdateRequest) {
  return request<Agent>(`/agents/${agentId}`, { method: 'PATCH', body: data })
}

// 에이전트 삭제 (DELETE /agents/{id}) - admin, manager
export function deleteAgent(agentId: number) {
  return request<{ success: boolean }>(`/agents/${agentId}`, { method: 'DELETE' })
}

//  * 에이전트 실행 (POST /agents/{id}/run) - 스트리밍
//  - 생각 과정, 도구 실행, 답변이 진행되는 대로 onEvent로 전달됨
//  - signal: 중지 버튼용 / 스트리밍 도중 오류는 { type: 'error' } 이벤트로 전달됨
export function streamAgentRun(
  agentId: number,
  data: AgentRunRequest,
  onEvent: (event: AgentRunEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamRequest<AgentRunEvent>(`/agents/${agentId}/run`, data, onEvent, signal)
}
