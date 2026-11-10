import { request, streamRequest } from './client'
import type {
  ChatRequest,
  ChatStreamEvent,
  LlmModel,
  LlmProvider,
  ModelCreateRequest,
  ModelTestResult,
  ModelUpdateRequest,
  ProviderCreateRequest,
  ProviderUpdateRequest,
} from './types'

//  * LLM 공급자·모델 API 모음 - backend/src/services/llm/router.py 와 연결
//  - 매개변수 llmModelId: llm_models 테이블의 번호(id) (모델 이름인 model_id와 다름)

// ===== 1. 공급자 =====

// 공급자 목록 조회 (GET /llm/providers) - 등록된 모델 목록 포함
export function getProviders() {
  return request<LlmProvider[]>('/llm/providers')
}

// 공급자 등록 (POST /llm/providers) - admin 전용
export function createProvider(data: ProviderCreateRequest) {
  return request<LlmProvider>('/llm/providers', { method: 'POST', body: data })
}

// 공급자 수정 (PATCH /llm/providers/{id}) - admin 전용
export function updateProvider(providerId: number, data: ProviderUpdateRequest) {
  return request<LlmProvider>(`/llm/providers/${providerId}`, { method: 'PATCH', body: data })
}

// 공급자 삭제 (DELETE /llm/providers/{id}) - admin 전용, 등록된 모델도 함께 삭제
export function deleteProvider(providerId: number) {
  return request<{ success: boolean }>(`/llm/providers/${providerId}`, { method: 'DELETE' })
}

// 공급자 서버에 설치된 모델 이름 목록 (GET /llm/providers/{id}/available-models) - admin 전용
export async function getAvailableModels(providerId: number) {
  const data = await request<{ model_ids: string[] }>(
    `/llm/providers/${providerId}/available-models`,
  )
  return data.model_ids
}

// ===== 2. 모델 =====

// 모델 등록 (POST /llm/providers/{id}/models) - admin 전용
export function createModel(providerId: number, data: ModelCreateRequest) {
  return request<LlmModel>(`/llm/providers/${providerId}/models`, { method: 'POST', body: data })
}

// 모델 수정 (PATCH /llm/models/{id}) - admin 전용
export function updateModel(llmModelId: number, data: ModelUpdateRequest) {
  return request<LlmModel>(`/llm/models/${llmModelId}`, { method: 'PATCH', body: data })
}

// 모델 삭제 (DELETE /llm/models/{id}) - admin 전용
export function deleteModel(llmModelId: number) {
  return request<{ success: boolean }>(`/llm/models/${llmModelId}`, { method: 'DELETE' })
}

// 모델 연결 테스트 (POST /llm/models/{id}/test) - 실패해도 에러가 아니라 success=false로 옴
export function testModel(llmModelId: number) {
  return request<ModelTestResult>(`/llm/models/${llmModelId}/test`, { method: 'POST' })
}

// ===== 3. 테스트 대화 (스트리밍) =====
//  * 테스트 대화 (POST /llm/chat)
//  - 답변이 한 번에 오지 않고 조각조각 오므로(SSE), 조각이 올 때마다 onEvent를 호출함
//  - signal: 중지 버튼용 (AbortController.abort() 호출 시 즉시 중단 => AbortError 발생)
//  - 스트리밍 시작 전 오류(모델 없음, 권한 없음 등)는 ApiError로 발생
//  - 스트리밍 도중 오류는 { type: 'error' } 이벤트로 전달됨
export function streamChat(
  data: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamRequest<ChatStreamEvent>('/llm/chat', data, onEvent, signal)
}
