import { MarkerType, type Edge, type Node } from '@xyflow/react'

import type {
  AgentNodeData,
  ConditionNodeData,
  EndNodeData,
  StartNodeData,
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowNodeType,
} from '../../../api/types'
import { AGENT_OUTPUT_FIELD } from '../../../constants/workflow'

//  * 워크플로우 편집 화면에서 쓰는 도우미 함수 모음
//  - 저장 형식(WorkflowGraph) <=> 캔버스 라이브러리(React Flow) 형식 변환
//  - 새 노드 ID 만들기, {{ }} 로 꺼내 쓸 수 있는 앞 노드 항목 찾기
//
// 📌 React Flow 노드/연결선에는 화면용 값(선택 여부, 크기, 드래그 중 여부 등)이 계속 붙음
//    => 저장할 때는 toGraph()로 필요한 값(id, type, position, data)만 골라서 보냄

// 캔버스 노드 타입 (Node<설정값 타입, 노드 종류>)
export type StartFlowNode = Node<StartNodeData, 'start'>
export type AgentFlowNode = Node<AgentNodeData, 'agent'>
export type ConditionFlowNode = Node<ConditionNodeData, 'condition'>
export type EndFlowNode = Node<EndNodeData, 'end'>
export type WorkflowFlowNode = StartFlowNode | AgentFlowNode | ConditionFlowNode | EndFlowNode

// 조건 분기 출구 이름 => 연결선에 표시할 글자
const HANDLE_LABEL: Record<string, string> = { true: '참', false: '거짓' }

//  * 연결선 만들기
//  - id: "e_출발노드_출구_도착노드" (같은 선을 두 번 만들지 않도록 규칙적으로 만듦)
//  - 조건 분기에서 나가는 선은 "참" / "거짓" 글자와 색을 붙임 (className => styles/workflow.css)
//  - type: 'smoothstep' => 직각으로 꺾이는 선 / markerEnd: 끝에 화살표 (진행 방향 표시)
export function makeEdge(source: string, sourceHandle: string | null | undefined, target: string): Edge {
  const handle = sourceHandle ?? null
  return {
    id: `e_${source}_${handle ?? 'next'}_${target}`,
    source,
    target,
    sourceHandle: handle,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
    label: handle ? HANDLE_LABEL[handle] : undefined,
    className: handle ? `wf-edge-${handle}` : undefined,
  }
}

//  * source 노드에서 출발해서 target 노드까지 갈 수 있는지 (연결선을 따라감)
//  - 새 선(target => source)을 이었을 때 되돌아오는 고리(순환)가 생기는지 확인할 때 사용
export function canReach(from: string, to: string, edges: Edge[]): boolean {
  const visited = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === to) {
      return true
    }
    if (visited.has(current)) {
      continue
    }
    visited.add(current)
    stack.push(...edges.filter((edge) => edge.source === current).map((edge) => edge.target))
  }
  return false
}

// 저장 형식 => 캔버스 노드 (시작 노드는 지울 수 없게 deletable: false)
export function toFlowNodes(graph: WorkflowGraph): WorkflowFlowNode[] {
  return graph.nodes.map(
    (node) => ({ ...node, deletable: node.type !== 'start' }) as WorkflowFlowNode,
  )
}

// 저장 형식 => 캔버스 연결선
export function toFlowEdges(graph: WorkflowGraph): Edge[] {
  return graph.edges.map((edge) => makeEdge(edge.source, edge.sourceHandle, edge.target))
}

//  * 캔버스 => 저장 형식 (화면용 값은 버리고 필요한 값만)
//  - Math.round: 위치는 정수로 저장 (드래그하면 소수점이 길게 붙음)
export function toGraph(nodes: WorkflowFlowNode[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map(
      (node) =>
        ({
          id: node.id,
          type: node.type,
          position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
          data: node.data,
        }) as WorkflowGraphNode,
    ),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle === 'true' || edge.sourceHandle === 'false' ? edge.sourceHandle : null,
    })),
  }
}

//  * 새 노드 ID 만들기 (예: agent_1, agent_2 ...)
//  - 같은 종류 중 가장 큰 번호 + 1 (중간 번호를 지웠다가 다시 만들어도 겹치지 않도록)
export function nextNodeId(type: WorkflowNodeType, nodes: WorkflowFlowNode[]): string {
  const prefix = `${type}_`
  const numbers = nodes
    .filter((node) => node.id.startsWith(prefix))
    .map((node) => Number(node.id.slice(prefix.length)))
    .filter((value) => Number.isInteger(value))
  return `${prefix}${Math.max(0, ...numbers) + 1}`
}

// 노드 카드의 대략적인 크기 (겹침 확인용 - styles/workflow.css 의 .wf-node 폭과 맞춤)
const NODE_WIDTH = 240
const NODE_HEIGHT = 110

//  * 다른 노드와 겹치지 않는 위치 찾기
//  - 원하는 위치에 이미 노드가 있으면 아래로 한 칸씩 내려가며 빈자리를 찾음 (최대 20칸)
export function findFreePosition(
  position: { x: number; y: number },
  nodes: WorkflowFlowNode[],
): { x: number; y: number } {
  let candidate = position
  for (let step = 0; step < 20; step += 1) {
    const overlapped = nodes.some(
      (node) =>
        Math.abs(node.position.x - candidate.x) < NODE_WIDTH &&
        Math.abs(node.position.y - candidate.y) < NODE_HEIGHT,
    )
    if (!overlapped) {
      return candidate
    }
    candidate = { x: candidate.x, y: candidate.y + NODE_HEIGHT + 20 }
  }
  return candidate
}

// {{ }} 로 꺼내 쓸 수 있는 항목 1개 (예: { ref: "{{start.question}}", label: "질문", nodeLabel: "시작" })
export interface TemplateVariable {
  ref: string
  label: string
  nodeLabel: string
}

//  * 어떤 노드에서 {{ }} 로 꺼내 쓸 수 있는 앞 노드 항목 목록
//  - 연결선을 거꾸로 따라가며 "이 노드보다 앞에서 실행되는" 노드를 찾음 (backend graph.py 와 같은 규칙)
//  - 시작 노드: 입력 칸 / 에이전트 노드: 답변(answer)
export function availableVariables(nodeId: string, nodes: WorkflowFlowNode[], edges: Edge[]): TemplateVariable[] {
  // 1. 앞 노드 찾기 (너비 우선 탐색 - 가까운 노드부터)
  const found = new Set<string>()
  const queue = edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source)
  while (queue.length > 0) {
    const current = queue.shift()!
    if (found.has(current)) {
      continue
    }
    found.add(current)
    queue.push(...edges.filter((edge) => edge.target === current).map((edge) => edge.source))
  }

  // 2. 앞 노드들의 항목 모으기
  const variables: TemplateVariable[] = []
  for (const node of nodes) {
    if (!found.has(node.id)) {
      continue
    }
    if (node.type === 'start') {
      for (const input of node.data.inputs) {
        variables.push({ ref: `{{${node.id}.${input.key}}}`, label: input.label, nodeLabel: node.data.label })
      }
    } else if (node.type === 'agent') {
      variables.push({ ref: `{{${node.id}.${AGENT_OUTPUT_FIELD}}}`, label: '답변', nodeLabel: node.data.label })
    }
  }
  return variables
}
