// [수정] * 실행 기록 번호(runId) + 저장된 실행 기록 => 실행 상태 변환 추가 [2026-11-11 12:20]
// [기존] 실행 중에 받은 이벤트로만 실행 상태를 만들었습니다.
// [변경] run_start 이벤트의 실행 기록 번호를 실행 상태에 담고,
//        저장된 실행 기록(RunDetail)을 같은 실행 상태로 바꾸는 runStateFromDetail 을 추가했습니다.
//        => 실행 기록 상세 화면에서 실행 패널과 같은 부품(RunStepCard)으로 보여주기 위함

import type { Edge } from '@xyflow/react'

import type {
  RunDetail,
  WorkflowNodeResult,
  WorkflowNodeType,
  WorkflowRunEvent,
} from '../../../api/types'
import { applyRunEvent, type RunPart } from '../../../components/agent/RunParts'

//  * 워크플로우 실행 화면에서 쓰는 상태와 도우미 함수 모음
//  - 서버가 보내는 이벤트(WorkflowRunEvent)를 하나씩 받아서 "실행 상태"를 만듦
//  - 실행 상태로 캔버스의 노드 색(실행 중/완료/오류/건너뜀)과 지나간 연결선을 정함

// 노드 1개의 실행 상태 (skipped: 실행이 끝났는데 거치지 않은 노드 - 조건 분기로 건너뛴 쪽 등)
export type NodeRunStatus = 'running' | 'done' | 'error' | 'stopped' | 'skipped'

// 실행한 노드 1개의 기록 (실행 순서대로 쌓임)
export interface NodeRunStep {
  nodeId: string
  nodeType: WorkflowNodeType
  label: string
  status: Exclude<NodeRunStatus, 'skipped'>
  parts: RunPart[] // 에이전트 노드의 생각 과정, 도구 실행, 답변 조각
  result?: WorkflowNodeResult // 실행이 끝나면 채워짐
  durationMs?: number
  error?: string
}

//  * 워크플로우 실행 1번의 상태
//  - status: running(실행 중) / done(끝) / error(오류로 멈춤) / stopped(사용자가 중지)
//  - output, stats: 끝까지 실행했을 때만 있음
//  - runId: 서버에 저장된 실행 기록 번호 (run_start 이벤트를 받기 전에는 없음)
export interface WorkflowRunState {
  status: 'running' | 'done' | 'error' | 'stopped'
  runId?: number
  steps: NodeRunStep[]
  output?: string
  stats?: { inputTokens: number; outputTokens: number; latencyMs: number }
  error?: string
}

// 실행 시작 상태
export const STARTED_RUN: WorkflowRunState = { status: 'running', steps: [] }

// 특정 노드의 기록만 바꾸기 (원래 상태는 바꾸지 않고 새 상태를 돌려줌)
function updateStep(state: WorkflowRunState, nodeId: string, update: (step: NodeRunStep) => NodeRunStep): WorkflowRunState {
  return { ...state, steps: state.steps.map((step) => (step.nodeId === nodeId ? update(step) : step)) }
}

//  * 받은 이벤트 1개를 실행 상태에 반영 (원래 상태는 바꾸지 않고 새 상태를 돌려줌)
//  - 이벤트 종류별 내용은 backend/src/services/orchestration/workflow_runner.py 맨 위 설명 참고
export function applyWorkflowEvent(state: WorkflowRunState, event: WorkflowRunEvent): WorkflowRunState {
  switch (event.type) {
    case 'run_start':
      return { ...state, runId: event.run_id }
    case 'node_start':
      return {
        ...state,
        steps: [
          ...state.steps,
          { nodeId: event.node_id, nodeType: event.node_type, label: event.label, status: 'running', parts: [] },
        ],
      }
    case 'node_done': {
      //  * 구조 분해 + 나머지(...result): type, node_id, duration_ms 를 뺀 나머지 = 노드 종류별 결과
      //  - type, node_id 는 빼내기만 하고 쓰지 않는 값이라 이름 앞에 _ 를 붙임
      const { type: _type, node_id: _nodeId, duration_ms: durationMs, ...result } = event
      return updateStep(state, event.node_id, (step) => ({
        ...step,
        status: 'done',
        result: result as WorkflowNodeResult,
        durationMs,
      }))
    }
    case 'done':
      return {
        ...state,
        status: 'done',
        output: event.output,
        stats: { inputTokens: event.input_tokens, outputTokens: event.output_tokens, latencyMs: event.latency_ms },
      }
    case 'error': {
      const failed = { ...state, status: 'error' as const, error: event.message }
      return event.node_id
        ? updateStep(failed, event.node_id, (step) => ({ ...step, status: 'error', error: event.message }))
        : failed
    }
    default:
      // 나머지 = 에이전트 노드의 진행 상황 (생각 과정, 답변 조각, 도구 실행)
      return updateStep(state, event.node_id, (step) => ({ ...step, parts: applyRunEvent(step.parts, event) }))
  }
}

//  * 실행을 끝내지 못하고 멈춘 경우 (사용자가 중지 / 연결 끊김)
//  - 실행 중이던 노드는 "중지됨"으로 바꿈
//  - 이미 끝난 실행(done, error)은 그대로 둠
//    (끝 이벤트를 받은 직후, 연결이 닫히기 전에 중지 버튼을 누른 경우 결과가 지워지지 않도록)
export function stopRun(state: WorkflowRunState, status: 'error' | 'stopped', error?: string): WorkflowRunState {
  if (state.status !== 'running') {
    return state
  }
  return {
    ...state,
    status,
    error,
    steps: state.steps.map((step) => (step.status === 'running' ? { ...step, status: 'stopped' } : step)),
  }
}

//  * 노드 ID => 실행 상태 (캔버스의 노드 카드 색에 사용)
//  - 실행이 끝났으면(실행 중이 아니면) 거치지 않은 노드는 skipped
export function nodeRunStatuses(run: WorkflowRunState | null, nodeIds: string[]): Map<string, NodeRunStatus> {
  const statuses = new Map<string, NodeRunStatus>()
  if (!run) {
    return statuses
  }
  for (const step of run.steps) {
    statuses.set(step.nodeId, step.status)
  }
  if (run.status !== 'running') {
    for (const nodeId of nodeIds) {
      if (!statuses.has(nodeId)) {
        statuses.set(nodeId, 'skipped')
      }
    }
  }
  return statuses
}

//  * 이번 실행에서 지나간 연결선 ID 모음
//  - 실행한 노드를 순서대로 두 개씩 짝지어(앞 노드 => 다음 노드) 그 사이의 연결선을 찾음
//  - 조건 분기에서 나가는 선은 비교 결과와 같은 출구(참/거짓)의 선만
export function passedEdgeIds(run: WorkflowRunState | null, edges: Edge[]): Set<string> {
  const ids = new Set<string>()
  if (!run) {
    return ids
  }
  for (let index = 0; index + 1 < run.steps.length; index += 1) {
    const from = run.steps[index]
    const to = run.steps[index + 1]
    const handle = from.result?.node_type === 'condition' ? String(from.result.result) : null
    const edge = edges.find(
      (item) => item.source === from.nodeId && item.target === to.nodeId && (item.sourceHandle ?? null) === handle,
    )
    if (edge) {
      ids.add(edge.id)
    }
  }
  return ids
}

// 저장된 실행 상태 => 화면의 실행 상태 (succeeded 만 이름이 다름)
const STATUS_FROM_RECORD = { running: 'running', succeeded: 'done', failed: 'error', stopped: 'stopped' } as const

//  * 저장된 실행 기록 => 실행 상태 (실행 기록 상세 화면용)
//  - 노드 기록의 모양을 실행 중에 쓰는 모양(NodeRunStep)으로 바꿈
//  - 노드 결과(result)에는 node_type 이 따로 저장되어 있지 않으므로 노드 기록의 node_type 을 붙임
export function runStateFromDetail(detail: RunDetail): WorkflowRunState {
  return {
    status: STATUS_FROM_RECORD[detail.status],
    runId: detail.id,
    steps: detail.steps.map((step) => ({
      nodeId: step.node_id,
      nodeType: step.node_type,
      label: step.label,
      status: step.status,
      parts: step.parts as RunPart[],
      result: step.result ? ({ ...step.result, node_type: step.node_type } as WorkflowNodeResult) : undefined,
      durationMs: step.duration_ms ?? undefined,
      error: step.error ?? undefined,
    })),
    output: detail.output ?? undefined,
    stats:
      detail.latency_ms !== null
        ? { inputTokens: detail.input_tokens, outputTokens: detail.output_tokens, latencyMs: detail.latency_ms }
        : undefined,
    error: detail.error ?? undefined,
  }
}
