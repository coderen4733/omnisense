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

// [수정] * 워크플로우 API 타입 추가 [2026-11-10 13:40]
// [기존] 에이전트까지의 타입만 있었습니다.
// [변경] 워크플로우 목록/상세/그래프(노드, 연결선) 타입을 추가했습니다.
//        (backend/src/services/workflow/graph.py, schemas.py 와 같은 모양)

// 노드 종류 (시작 / 에이전트 / 조건 분기 / 끝)
export type WorkflowNodeType = 'start' | 'agent' | 'condition' | 'end'

// 시작 노드의 입력 칸 1개 (key: {{start.key}} 로 꺼내 쓰는 이름 / label: 화면 표시 이름)
export interface StartInput {
  key: string
  label: string
  type: 'text' | 'number'
  required: boolean
}

// 조건 분기의 비교 방법
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'greater_or_equal'
  | 'less_than'
  | 'less_or_equal'
  | 'is_empty'
  | 'is_not_empty'

//  * 노드 종류별 설정값 (data)
//  - [key: string]: unknown => 캔버스 라이브러리(React Flow)가 요구하는 형식 (아무 값이나 더 들어올 수 있음)
export interface StartNodeData {
  [key: string]: unknown
  label: string
  inputs: StartInput[]
}

export interface AgentNodeData {
  [key: string]: unknown
  label: string
  agent_id: number | null // 실행할 에이전트 번호 (아직 고르지 않았으면 null)
  prompt: string // 에이전트에 보낼 내용 ({{ }} 사용 가능)
}

export interface ConditionNodeData {
  [key: string]: unknown
  label: string
  left: string // 비교할 값
  operator: ConditionOperator
  right: string // 기준 값
}

export interface EndNodeData {
  [key: string]: unknown
  label: string
  output: string // 최종 결과 ({{ }} 사용 가능)
}

// 저장되는 노드 1개 (type 값에 따라 data 모양이 다름)
export type WorkflowGraphNode =
  | { id: string; type: 'start'; position: { x: number; y: number }; data: StartNodeData }
  | { id: string; type: 'agent'; position: { x: number; y: number }; data: AgentNodeData }
  | { id: string; type: 'condition'; position: { x: number; y: number }; data: ConditionNodeData }
  | { id: string; type: 'end'; position: { x: number; y: number }; data: EndNodeData }

// 저장되는 연결선 1개 (sourceHandle: 조건 분기 노드에서 나가는 선만 'true' / 'false')
export interface WorkflowGraphEdge {
  id: string
  source: string
  target: string
  sourceHandle: 'true' | 'false' | null
}

// 워크플로우 그래프 전체
export interface WorkflowGraph {
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
}

// 실행 전에 고쳐야 할 문제 1건 (node_id: 문제가 있는 노드 / 워크플로우 전체 문제면 null)
export interface GraphIssue {
  node_id: string | null
  message: string
}

// 워크플로우 목록용 (WorkflowSummaryRes) - issue_count가 0이면 실행 가능
export interface WorkflowSummary {
  id: number
  name: string
  description: string | null
  node_count: number
  issue_count: number
  is_active: boolean
  created_by_email: string | null
  created_at: string
  updated_at: string
}

// 워크플로우 상세 (WorkflowRes) - 편집 화면용
export interface Workflow extends WorkflowSummary {
  graph: WorkflowGraph
  issues: GraphIssue[]
}

// 워크플로우 만들기 - 요청 (WorkflowCreateReq)
export interface WorkflowCreateRequest {
  name: string
  description: string | null
}

// 워크플로우 수정 - 요청 (WorkflowUpdateReq) - 보내지 않은 값은 바뀌지 않음
export type WorkflowUpdateRequest = {
  name?: string
  description?: string | null
  graph?: WorkflowGraph
  is_active?: boolean
}

// [수정] * 워크플로우 실행 타입 추가 [2026-11-10 16:50]
// [기존] 워크플로우 만들기/수정/조회 타입만 있었습니다.
// [변경] 실행 요청과 실행 중에 받는 이벤트 타입을 추가했습니다.
//        (backend/src/services/orchestration/workflow_runner.py 맨 위 설명과 같은 모양)

// 워크플로우 실행 - 요청 (WorkflowRunReq) - 시작 노드 입력값 {입력 칸 이름: 값} (숫자 칸도 글자로 보냄)
export interface WorkflowRunRequest {
  inputs: Record<string, string>
}

// 에이전트 실행 이벤트 중 "진행 상황" 4종류 (생각 과정, 답변 조각, 도구 실행 시작/결과)
export type AgentProgressEvent = Extract<AgentRunEvent, { type: 'reasoning' | 'content' | 'tool_call' | 'tool_result' }>

//  * 노드 1개의 실행 결과 (node_done 이벤트) - node_type 에 따라 들어 있는 값이 다름
//  - start    : 입력값
//  - agent    : 실제로 보낸 내용, 최종 답변, 사용량
//  - condition: {{ }} 를 바꾼 뒤의 비교할 값/기준 값, 비교 결과(true: 참 / false: 거짓)
//  - end      : 최종 출력
export type WorkflowNodeResult =
  | { node_type: 'start'; inputs: Record<string, string> }
  | {
      node_type: 'agent'
      prompt: string
      answer: string
      model?: string // 사용한 모델 이름 (실행 기록 기능부터 추가됨 - 그 전 기록에는 없음)
      input_tokens: number
      output_tokens: number
      steps: number // LLM을 호출한 횟수
      finish_reason: string | null
    }
  | { node_type: 'condition'; left: string; operator: ConditionOperator; right: string; result: boolean }
  | { node_type: 'end'; output: string }

//  * 워크플로우 실행 - 스트리밍으로 받는 이벤트 1개
//  - 에이전트 노드의 진행 상황은 에이전트 실행 이벤트에 node_id 만 붙어서 옴
//  - & : 두 타입을 합친 타입 (예: 진행 상황 이벤트 + node_id)
export type WorkflowRunEvent =
  | { type: 'run_start'; run_id: number } // 실행 기록 번호 (맨 처음 1번 - 실행 기록 상세로 이동할 때 사용)
  | { type: 'node_start'; node_id: string; node_type: WorkflowNodeType; label: string } // 노드 실행 시작
  | (AgentProgressEvent & { node_id: string }) // 에이전트 노드 진행 상황
  | ({ type: 'node_done'; node_id: string; duration_ms: number } & WorkflowNodeResult) // 노드 실행 끝
  | {
      type: 'done' // 워크플로우 끝
      output: string // 최종 결과 (끝 노드의 출력)
      end_node_id: string
      path: string[] // 실제로 실행한 노드 순서
      input_tokens: number // 모든 에이전트 노드의 합계
      output_tokens: number
      latency_ms: number
    }
  | { type: 'error'; node_id: string | null; message: string } // 오류 (워크플로우가 그 자리에서 멈춤)

// [수정] * 실행 기록 / 모니터링 타입 추가 [2026-11-11 12:10]
// [기존] 워크플로우 실행 이벤트 타입까지만 있었습니다.
// [변경] 실행 기록 목록/상세, 모니터링 통계 타입을 추가하고,
//        실행 이벤트에 run_start(실행 기록 번호), 에이전트 결과에 model(모델 이름)을 추가했습니다.
//        (backend/src/services/run/schemas.py 와 같은 모양)

// 실행 상태 (running: 실행 중 / succeeded: 성공 / failed: 실패 / stopped: 사용자가 중지)
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'stopped'

// 실행 기록 목록 조회 - 요청 (RunListQuery) - 보내지 않은 조건은 거르지 않음
export interface RunListQuery {
  workflow_id?: number
  status?: RunStatus
  page?: number
  size?: number
}

// 실행 기록 1건 - 목록용 (RunSummaryRes) - workflow_id: 워크플로우가 지워졌으면 null
export interface RunSummary {
  id: number
  workflow_id: number | null
  workflow_name: string
  status: RunStatus
  error: string | null
  input_tokens: number
  output_tokens: number
  latency_ms: number | null
  started_by_email: string | null
  started_at: string
  finished_at: string | null
}

// 실행 기록 목록 - 응답 (RunListRes)
export interface RunListResponse {
  items: RunSummary[]
  total: number
  page: number
  size: number
  total_pages: number
}

//  * 노드 기록 1개 (RunStepRes)
//  - result: 노드 종류별 결과 (끝나지 못한 노드는 null)
//  - parts: 에이전트 노드의 생각 과정, 도구 실행, 답변 조각 (components/agent/RunParts.tsx 의 RunPart 모양)
export interface RunStep {
  seq: number
  node_id: string
  node_type: WorkflowNodeType
  label: string
  status: 'done' | 'error' | 'stopped'
  result: Record<string, unknown> | null
  parts: unknown[]
  error: string | null
  model_name: string | null
  input_tokens: number
  output_tokens: number
  duration_ms: number | null
  started_at: string
}

// 실행 기록 상세 (RunDetailRes) - 실행 당시 그래프 + 입력/결과 + 노드 기록
export interface RunDetail extends RunSummary {
  graph: WorkflowGraph
  inputs: Record<string, string>
  output: string | null
  error_node_id: string | null
  steps: RunStep[]
}

//  * 모니터링 통계 (RunStatsRes)
//  - success_rate: 끝난 실행 중 성공 비율 (0~100, 끝난 실행이 없으면 null)
//  - daily: 날짜별 실행 수 (실행이 없는 날도 0으로 들어 있음, 날짜는 "2026-11-11" 형식)
export interface RunStats {
  days: number
  since: string
  summary: {
    total: number
    succeeded: number
    failed: number
    stopped: number
    running: number
    success_rate: number | null
    avg_latency_ms: number | null
    input_tokens: number
    output_tokens: number
  }
  daily: { date: string; total: number; succeeded: number; failed: number; stopped: number }[]
  workflows: {
    workflow_id: number | null
    workflow_name: string
    total: number
    succeeded: number
    failed: number
    avg_latency_ms: number | null
    tokens: number
    last_run_at: string
  }[]
  models: {
    model_name: string
    calls: number // 에이전트 노드 실행 횟수
    errors: number
    input_tokens: number
    output_tokens: number
    tokens: number
    avg_duration_ms: number | null
  }[]
}
