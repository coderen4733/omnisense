import { Bot, Flag, Play, Split, type LucideIcon } from 'lucide-react'

import type {
  AgentNodeData,
  ConditionNodeData,
  ConditionOperator,
  EndNodeData,
  StartNodeData,
  UserRole,
  WorkflowNodeType,
} from '../api/types'
import type { SelectOption } from '../components/common/SelectBox'

// 워크플로우를 만들기·수정·삭제할 수 있는 권한 (백엔드 workflow/router.py 권한과 동일)
export const WORKFLOW_MANAGER_ROLES: UserRole[] = ['admin', 'manager']

// 에이전트 노드가 내보내는 항목 이름 (backend workflow/graph.py 의 AGENT_OUTPUT_FIELD) => {{agent_1.answer}}
export const AGENT_OUTPUT_FIELD = 'answer'

//  * 노드 종류별 화면 정보
//  - label: 노드 종류 이름 / description: 왼쪽 노드 목록의 설명 / icon: 아이콘
//  - tone: 색상 (styles/workflow.css 의 .wf-node.tone-xxx 와 연결)
export const NODE_META: Record<
  WorkflowNodeType,
  { label: string; description: string; icon: LucideIcon; tone: string }
> = {
  start: { label: '시작', description: '워크플로우가 받을 입력', icon: Play, tone: 'green' },
  agent: { label: '에이전트', description: '등록된 에이전트 실행', icon: Bot, tone: 'purple' },
  condition: { label: '조건 분기', description: '값에 따라 길을 나눔', icon: Split, tone: 'orange' },
  end: { label: '끝', description: '최종 결과 출력', icon: Flag, tone: 'blue' },
}

// 왼쪽 노드 목록에서 추가할 수 있는 노드 (시작 노드는 워크플로우마다 1개라서 목록에서 빼둠)
export const ADDABLE_NODE_TYPES: WorkflowNodeType[] = ['agent', 'condition', 'end']

// 새로 추가한 노드의 기본 설정값 (backend graph.py 의 기본값과 같게)
export const DEFAULT_NODE_DATA = {
  start: (): StartNodeData => ({ label: '시작', inputs: [] }),
  agent: (): AgentNodeData => ({ label: '에이전트', agent_id: null, prompt: '' }),
  condition: (): ConditionNodeData => ({ label: '조건 분기', left: '', operator: 'equals', right: '' }),
  end: (): EndNodeData => ({ label: '끝', output: '' }),
}

// 조건 분기의 비교 방법 선택지 (숫자 비교는 두 값을 숫자로 바꿔서 비교)
export const OPERATOR_OPTIONS: SelectOption<ConditionOperator>[] = [
  { value: 'equals', label: '같음 (=)' },
  { value: 'not_equals', label: '같지 않음 (≠)' },
  { value: 'contains', label: '포함함' },
  { value: 'not_contains', label: '포함하지 않음' },
  { value: 'greater_than', label: '큼 (>) - 숫자' },
  { value: 'greater_or_equal', label: '크거나 같음 (≥) - 숫자' },
  { value: 'less_than', label: '작음 (<) - 숫자' },
  { value: 'less_or_equal', label: '작거나 같음 (≤) - 숫자' },
  { value: 'is_empty', label: '비어 있음' },
  { value: 'is_not_empty', label: '비어 있지 않음' },
]

// 노드 카드에 짧게 보여줄 비교 기호
export const OPERATOR_SYMBOL: Record<ConditionOperator, string> = {
  equals: '=',
  not_equals: '≠',
  contains: '포함',
  not_contains: '미포함',
  greater_than: '>',
  greater_or_equal: '≥',
  less_than: '<',
  less_or_equal: '≤',
  is_empty: '비어 있음',
  is_not_empty: '비어 있지 않음',
}

// 오른쪽 값(기준 값)이 필요 없는 비교 방법
export const UNARY_OPERATORS: ConditionOperator[] = ['is_empty', 'is_not_empty']

// 시작 노드 입력 칸 이름 규칙 (backend graph.py 의 INPUT_KEY_PATTERN 과 같게)
export const INPUT_KEY_PATTERN = /^[A-Za-z0-9_가-힣]{1,50}$/
