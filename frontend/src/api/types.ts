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
