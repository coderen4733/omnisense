// [수정] * 노드별 실행 상태(runStatusByNode) 추가 [2026-11-10 17:05]
// [기존] 에이전트 목록과 문제 목록만 넘겼습니다.
// [변경] 실행 중/완료/오류/건너뜀 상태를 노드 카드에 표시하기 위해 실행 상태도 넘깁니다.

import { createContext, useContext } from 'react'

import type { Agent } from '../../../api/types'
import type { NodeRunStatus } from './run'

//  * 편집 화면 전체에서 함께 쓰는 값
//  - 캔버스의 노드 카드는 React Flow가 그려서 props로 값을 직접 넘기기 어려움
//    => Context로 넘겨서 노드 카드에서 꺼내 씀 (AuthContext 설명 참고)
//  - agentsById: 에이전트 번호 => 에이전트 (노드 카드에 에이전트 이름 표시)
//  - issuesByNode: 노드 ID => 문제 메시지 목록 (마지막 저장 기준, 노드 카드에 경고 표시)
//  - runStatusByNode: 노드 ID => 실행 상태 (실행한 적이 없으면 비어 있음)
interface EditorContextValue {
  agentsById: Map<number, Agent>
  issuesByNode: Map<string, string[]>
  runStatusByNode: Map<string, NodeRunStatus>
}

export const EditorContext = createContext<EditorContextValue>({
  agentsById: new Map(),
  issuesByNode: new Map(),
  runStatusByNode: new Map(),
})

export function useEditorContext(): EditorContextValue {
  return useContext(EditorContext)
}
