import type { ReasoningEffort, UserRole } from '../api/types'
import type { SelectOption } from '../components/common/SelectBox'

// 에이전트를 등록·수정·삭제할 수 있는 권한 (백엔드 agent/router.py 권한과 동일)
export const AGENT_MANAGER_ROLES: UserRole[] = ['admin', 'manager']

// 도구 호출 최대 반복 횟수 (백엔드 AgentCreateReq 의 기본값, 범위와 동일)
export const DEFAULT_MAX_ITERATIONS = 5
export const MAX_ITERATIONS_LIMIT = 20

//  * 생각 과정 수준 선택지 
//  - 에이전트 등록 화면의 "생각 과정" 선택 상자에 쓸 선택지와 화면 이름을 추가
//  * 생각 과정 수준 선택지
//  - 'default': 선택 상자는 null을 값으로 쓸 수 없으므로, "모델 기본값"을 이 값으로 표시하고 저장할 때 null로 바꿈
export type ReasoningChoice = ReasoningEffort | 'default'

export const REASONING_OPTIONS: SelectOption<ReasoningChoice>[] = [
  { value: 'default', label: '모델 기본값' },
  { value: 'none', label: '끄기 (가장 빠름)' },
  { value: 'low', label: '낮음' },
  { value: 'medium', label: '보통' },
  { value: 'high', label: '높음 (가장 느림)' },
]

// 생각 과정 수준 => 화면에 보여줄 이름 (테스트 실행 화면의 에이전트 정보)
export const REASONING_LABEL: Record<ReasoningEffort, string> = {
  none: '끄기',
  low: '낮음',
  medium: '보통',
  high: '높음',
}

// 시스템 프롬프트 입력창의 예시 문구
export const SYSTEM_PROMPT_PLACEHOLDER =
  '예) 당신은 사내 업무를 돕는 AI 어시스턴트입니다. 항상 한국어로 간결하게 답하세요. 숫자 계산은 반드시 계산기 도구를 사용하세요.'
