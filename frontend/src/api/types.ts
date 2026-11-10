//  * 백엔드 API의 요청/응답 형식(타입) 모음
//  - 백엔드의 schemas.py(Pydantic)와 똑같은 모양으로 맞춰야 함
//  - 백엔드 스키마가 바뀌면 이 파일도 함께 수정할 것

// 계정 권한 (backend/src/services/iam/user/enums.py 의 UserRole 값)
export type UserRole = 'admin' | 'manager' | 'user'

// 모든 API 응답의 공통 형식 (backend/src/common/response.py 의 ResponseSchema)
//  - <T>: data 안에 들어올 데이터의 타입을 나중에 정하겠다는 뜻 (제네릭)
export interface ApiResponse<T> {
  message: string
  data: T | null
}

// 사용자 정보 (UserReadRes / UserUpdateRes)
//  - 날짜는 ISO 형식 문자열로 옴 (예: "2026-10-08T08:53:39Z")
export interface User {
  id: number
  email: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

// 사용자 생성 응답 (UserCreateRes / SignUpRes) - updated_at이 없음
export type CreatedUser = Omit<User, 'updated_at'>

// 사용자 목록 조회 - 요청(Query) (UserReadListQuery)
//  - ?(물음표): 보내지 않아도 되는 값 (보내지 않으면 백엔드 기본값 사용)
export type UserListQuery = {
  is_active?: boolean
  role?: UserRole
  email?: string
  sort_by?: 'created_at' | 'updated_at' | 'email' | 'id'
  order?: 'asc' | 'desc'
  page?: number
  size?: number
}

// 사용자 목록 조회 - 응답 (UserReadListRes)
export interface UserListResponse {
  items: User[]
  total: number
  page: number
  size: number
  total_pages: number
}

// 사용자 생성(관리자 전용) - 요청 (UserCreateReq)
export interface CreateUserRequest {
  email: string
  password: string
  password_confirm: string
  role: UserRole
}

// 회원가입 - 요청 (SignUpReq)
export interface SignUpRequest {
  email: string
  password: string
  password_confirm: string
}

// 로그인 - 응답 (SignInRes)
export interface SignInResponse {
  access_token: string
  refresh_token: string
}

// 토큰재발급 - 응답 (ReTokenRes)
export interface ReTokenResponse {
  access_token: string
  token_type: string
}

// 비밀번호 변경 - 요청 (ChangePasswordReq)
export interface ChangePasswordRequest {
  current_password: string
  new_password: string
  new_password_confirm: string
}

// 비밀번호 변경 - 응답 (ChangePasswordRes)
export interface ChangePasswordResponse {
  success: boolean
  signed_out_sessions: number
}

// LLM 연결 방식 (openai_compatible: Ollama·vLLM / bedrock: AWS Bedrock)
export type LlmProviderType = 'openai_compatible' | 'bedrock'

// LLM 모델 (ModelRes)
//  - id: llm_models 테이블의 번호 / model_id: 공급자 서버의 모델 이름 (예: qwen3.5:9b)
export interface LlmModel {
  id: number
  provider_id: number
  model_id: string
  display_name: string
  supports_tools: boolean
  supports_reasoning: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

// LLM 공급자 (ProviderRes) - API 키 원문은 오지 않고 등록 여부(has_api_key)만 옴
export interface LlmProvider {
  id: number
  name: string
  provider_type: LlmProviderType
  base_url: string | null
  region: string | null
  has_api_key: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  models: LlmModel[]
}

// LLM 공급자 등록 - 요청 (ProviderCreateReq)
export interface ProviderCreateRequest {
  name: string
  provider_type: LlmProviderType
  base_url?: string
  region?: string
  api_key?: string
}

// LLM 공급자 수정 - 요청 (ProviderUpdateReq) - 보내지 않은 값은 바뀌지 않음
export type ProviderUpdateRequest = {
  name?: string
  base_url?: string
  region?: string
  api_key?: string // 새 API 키 (보내지 않으면 기존 키 유지)
  clear_api_key?: boolean // true면 저장된 API 키 삭제
  is_active?: boolean
}

// LLM 모델 등록 - 요청 (ModelCreateReq)
export interface ModelCreateRequest {
  model_id: string
  display_name: string
  supports_tools: boolean
  supports_reasoning: boolean
}

// LLM 모델 수정 - 요청 (ModelUpdateReq)
export type ModelUpdateRequest = {
  display_name?: string
  supports_tools?: boolean
  supports_reasoning?: boolean
  is_active?: boolean
}

// LLM 모델 연결 테스트 - 응답 (ModelTestRes)
export interface ModelTestResult {
  success: boolean
  latency_ms: number | null // 첫 응답까지 걸린 시간 (밀리초)
  message: string
}

// 테스트 대화 메시지의 역할 (system: 지시문 / user: 사용자 / assistant: 모델)
export type ChatRole = 'system' | 'user' | 'assistant'

// 테스트 대화 - 요청 (ChatReq)
export interface ChatRequest {
  llm_model_id: number
  messages: { role: ChatRole; content: string }[]
  temperature?: number
  max_tokens?: number
  top_p?: number
}

//  * 테스트 대화 - 스트리밍으로 받는 이벤트 1개
//  - type 값에 따라 들어있는 값이 다름 (TypeScript가 type으로 구분해 줌)
export type ChatStreamEvent =
  | { type: 'reasoning'; text: string } // 생각 과정 조각
  | { type: 'content'; text: string } // 답변 조각
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown> } // 도구 호출 요청
  | {
      type: 'done' // 답변 끝
      input_tokens: number
      output_tokens: number
      finish_reason: string | null // stop: 정상 종료 / length: 최대 토큰 수에 걸려 잘림
      latency_ms: number // 전체 걸린 시간
      first_token_ms: number | null // 첫 글자까지 걸린 시간
    }
  | { type: 'error'; message: string } // 오류


// 에이전트에 연결할 수 있는 도구 (ToolRes)
export interface AgentTool {
  name: string // 도구 이름 (에이전트에 저장되는 값, 예: calculator)
  label: string // 화면에 보여줄 이름 (예: 계산기)
  description: string
}

//  * 생각 과정 수준 (backend/src/core/llm.py 의 ReasoningEffort)
//  - none: 끄기 / low: 짧게 / medium: 보통 / high: 길게 (null이면 모델 기본값)
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'

// 에이전트에 연결된 LLM 모델 정보 (AgentModelRes)
//  - is_usable: 모델과 공급자가 모두 "사용" 상태인지 (false면 실행할 수 없음)
export interface AgentModel {
  id: number
  display_name: string
  model_id: string
  provider_name: string
  provider_type: LlmProviderType // 생각 과정 설정 적용 여부 판단용 
  supports_tools: boolean
  supports_reasoning: boolean // 생각 과정 지원 여부
  is_usable: boolean
}

// 에이전트 (AgentRes)
//  - llm_model: 연결된 모델이 삭제되었으면 null (모델을 다시 선택해야 함)
export interface Agent {
  id: number
  name: string
  description: string | null
  llm_model: AgentModel | null
  system_prompt: string
  temperature: number | null
  max_tokens: number | null
  top_p: number | null
  reasoning_effort: ReasoningEffort | null // 생각 과정 수준 (null: 모델 기본값) 
  max_iterations: number // 도구 호출 최대 반복 횟수
  tool_names: string[]
  is_active: boolean
  created_by_email: string | null
  created_at: string
  updated_at: string
}

// 에이전트 등록 - 요청 (AgentCreateReq)
export interface AgentCreateRequest {
  name: string
  description: string | null
  llm_model_id: number
  system_prompt: string
  temperature: number | null // null: 공급자 서버 기본값 사용
  max_tokens: number | null
  top_p: number | null
  reasoning_effort: ReasoningEffort | null // 생각 과정 수준 (null: 모델 기본값)
  max_iterations: number
  tool_names: string[]
}

//  * 에이전트 수정 - 요청 (AgentUpdateReq)
//  - 보내지 않은 값은 바뀌지 않음 / temperature 등은 null을 보내면 비움(기본값 사용)
export type AgentUpdateRequest = Partial<AgentCreateRequest> & { is_active?: boolean }

// 에이전트 실행 - 요청 (AgentRunReq) - 시스템 프롬프트는 에이전트에 저장된 값을 사용
export interface AgentRunRequest {
  messages: { role: 'user' | 'assistant'; content: string }[]
}

//  * 에이전트 실행 - 스트리밍으로 받는 이벤트 1개
//  - tool_call / tool_result 는 id로 짝을 맞춤 (예: "1-0" => 1번째 LLM 호출의 0번째 도구)
export type AgentRunEvent =
  | { type: 'reasoning'; text: string } // 생각 과정 조각
  | { type: 'content'; text: string } // 답변 조각
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> } // 도구 실행 시작
  | {
      type: 'tool_result' // 도구 실행 결과
      id: string
      name: string
      result: string
      is_error: boolean
      duration_ms: number
    }
  | {
      type: 'done' // 끝
      input_tokens: number // 모든 LLM 호출의 합계
      output_tokens: number
      // stop: 정상 / length: 최대 토큰 수에 걸려 잘림 / max_iterations: 최대 반복 횟수에 도달해 멈춤
      finish_reason: string | null
      steps: number // LLM을 호출한 횟수
      latency_ms: number
      first_token_ms: number | null
    }
  | { type: 'error'; message: string } // 오류
