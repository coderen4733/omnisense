import '@xyflow/react/dist/style.css' // 캔버스 라이브러리 기본 모양 (빌드 결과에 포함됨 - 폐쇄망 대비)

import { Background, Controls, ReactFlow } from '@xyflow/react'
import { CircleAlert, ExternalLink, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { getAgents, getAgentTools } from '../../api/agents'
import { getErrorMessage } from '../../api/client'
import { getRun } from '../../api/runs'
import type { Agent, AgentTool, RunDetail } from '../../api/types'
import PageHeader from '../../components/common/PageHeader'
import { formatDuration, MONITORING_ROLES, RUN_STATUS_META } from '../../constants/run'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useToast } from '../../contexts/ToastContext'
import { formatDateTime } from '../../utils/format'
import { EditorContext } from '../workflows/editor/EditorContext'
import { toFlowEdges, toFlowNodes } from '../workflows/editor/flow'
import { nodeRunStatuses, passedEdgeIds, runStateFromDetail } from '../workflows/editor/run'
import { RunResultBox, RunStepCard } from '../workflows/editor/RunStepCard'
import { WORKFLOW_NODE_TYPES } from '../workflows/editor/WorkflowNodes'

//  * 실행 기록 상세 화면 (/monitoring/runs/:runId)
//  - 왼쪽: 실행 당시의 워크플로우 그림 + 지나간 경로 (노드 색: 완료/오류/중지/건너뜀)
//  - 오른쪽: 노드별 기록 (편집 화면의 실행 패널과 같은 모양) + 최종 결과
//  - 일반 사용자(user)도 자기가 실행한 기록은 볼 수 있음 (편집 화면의 "실행 기록 보기"로 열림)
//  - 캔버스 라이브러리를 쓰므로 편집 화면처럼 처음 열 때 따로 내려받음 (App.tsx 의 lazy 참고)

export default function RunDetailPage() {
  // 1. 주소의 실행 기록 번호 (예: /monitoring/runs/12 => "12")
  const { runId } = useParams()
  const numericId = Number(runId)
  const invalidId = !Number.isInteger(numericId) || numericId < 1

  const { user } = useAuth()
  const { theme } = useTheme()
  const { showToast } = useToast()
  const canMonitor = Boolean(user && MONITORING_ROLES.includes(user.role))

  // 2. 실행 기록 + 에이전트 목록(노드 카드에 이름 표시) + 도구 목록(도구 화면 이름) 불러오기
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [tools, setTools] = useState<AgentTool[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    if (invalidId) {
      return
    }
    setLoading(true)
    Promise.all([getRun(numericId), getAgents(), getAgentTools()])
      .then(([runData, agentList, toolList]) => {
        setDetail(runData)
        setAgents(agentList)
        setTools(toolList)
        setLoadError(null)
      })
      .catch((error) => setLoadError(getErrorMessage(error)))
      .finally(() => setLoading(false))
  }, [numericId, invalidId])

  useEffect(() => {
    load()
  }, [load])

  //  3. 화면에 쓰는 값 (기록이 바뀔 때만 다시 계산)
  //  - run: 실행 패널과 같은 모양의 실행 상태 / nodes, edges: 캔버스에 그릴 노드와 연결선
  const run = useMemo(() => (detail ? runStateFromDetail(detail) : null), [detail])
  const nodes = useMemo(() => (detail ? toFlowNodes(detail.graph) : []), [detail])
  const edges = useMemo(() => {
    if (!detail || !run) {
      return []
    }
    // 지나간 연결선 강조 (편집 화면과 같은 방식 - styles/workflow.css 의 .wf-edge-passed)
    const flowEdges = toFlowEdges(detail.graph)
    const passed = passedEdgeIds(run, flowEdges)
    return flowEdges.map((edge) =>
      passed.has(edge.id) ? { ...edge, className: `${edge.className ?? ''} wf-edge-passed`.trim() } : edge,
    )
  }, [detail, run])
  const editorContext = useMemo(
    () => ({
      agentsById: new Map(agents.map((agent) => [agent.id, agent])),
      issuesByNode: new Map<string, string[]>(),
      runStatusByNode: nodeRunStatuses(run, nodes.map((node) => node.id)),
    }),
    [agents, run, nodes],
  )

  // 잘못된 주소 / 불러오기 실패 / 불러오는 중
  if (invalidId || loadError || !detail || !run) {
    const errorText = invalidId ? '잘못된 실행 기록 주소입니다.' : loadError
    return (
      <div className="page">
        <PageHeader title="실행 기록" />
        <section className={errorText ? 'card empty-state is-error' : 'card empty-state'}>
          {errorText ?? '불러오는 중...'}
        </section>
      </div>
    )
  }

  const meta = RUN_STATUS_META[detail.status]
  const startNode = detail.graph.nodes.find((node) => node.type === 'start')
  const inputs = startNode?.type === 'start' ? startNode.data.inputs : []
  const toolLabel = (toolName: string) => tools.find((tool) => tool.name === toolName)?.label ?? toolName

  // 최종 결과 복사 (편집 화면과 같은 방식)
  const copyText = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast('최종 결과를 복사했습니다.', 'success'))
      .catch(() => showToast('복사하지 못했습니다. 직접 선택해서 복사해 주세요.', 'error'))
  }

  // 노드 클릭 => 오른쪽의 그 노드 기록으로 스크롤
  const scrollToStep = (nodeId: string) => {
    document.getElementById(`wf-run-step-${nodeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <div className="page">
      <PageHeader
        title={`실행 기록 #${detail.id}`}
        description={detail.workflow_name}
        actions={
          <>
            {canMonitor && (
              <Link to="/monitoring" className="btn btn-outline">
                모니터링
              </Link>
            )}
            {detail.workflow_id !== null && (
              <Link to={`/workflows/${detail.workflow_id}`} className="btn btn-outline">
                <ExternalLink size={16} />
                워크플로우 열기
              </Link>
            )}
          </>
        }
      />

      <div className="monitor-stack">
        {/* 1. 요약 (상태, 시각, 걸린 시간, 토큰, 실행한 사용자) */}
        <section className="card run-detail-summary">
          <dl>
            <div>
              <dt>상태</dt>
              <dd>
                <span className={`pill pill-sm pill-${meta.tone}`}>{meta.label}</span>
              </dd>
            </div>
            <div>
              <dt>시작 시각</dt>
              <dd className="cell-date">{formatDateTime(detail.started_at)}</dd>
            </div>
            <div>
              <dt>걸린 시간</dt>
              <dd className="cell-date">{formatDuration(detail.latency_ms)}</dd>
            </div>
            <div>
              <dt>토큰</dt>
              <dd className="cell-date">
                입력 {detail.input_tokens.toLocaleString()} · 출력 {detail.output_tokens.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>실행한 사용자</dt>
              <dd>{detail.started_by_email ?? '-'}</dd>
            </div>
          </dl>
          {/* 아직 실행 중인 기록 => 새로고침으로 최신 상태 확인 */}
          {detail.status === 'running' && (
            <button type="button" className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'spin' : undefined} />
              새로고침
            </button>
          )}
        </section>

        {/* 2. 캔버스 (왼쪽) + 노드 기록 (오른쪽) */}
        <EditorContext.Provider value={editorContext}>
          <div className="run-detail-body">
            <div className="wf-canvas run-detail-canvas">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={WORKFLOW_NODE_TYPES}
                onNodeClick={(_, node) => scrollToStep(node.id)}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                deleteKeyCode={null}
                colorMode={theme}
                fitView
                fitViewOptions={{ maxZoom: 1, minZoom: 0.5 }}
              >
                <Background gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>

            <aside className="wf-panel run-detail-panel" aria-label="노드별 기록">
              <div className="wf-run">
                {run.steps.map((step) => (
                  <RunStepCard key={step.nodeId} step={step} inputs={inputs} toolLabel={toolLabel} />
                ))}
                {run.steps.length === 0 && <span className="text-muted">실행한 노드가 없습니다.</span>}

                {/* 노드와 상관없는 오류 / 중지 / 최종 결과 */}
                {run.status === 'error' && run.error && !run.steps.some((step) => step.error) && (
                  <div className="chat-notice is-error">
                    <CircleAlert size={14} />
                    {run.error}
                  </div>
                )}
                {run.status === 'stopped' && <div className="chat-notice">사용자가 실행을 중지했습니다.</div>}
                {run.status === 'running' && (
                  <div className="chat-notice">아직 실행 중이거나, 서버가 중간에 멈춰 마무리되지 않은 기록입니다.</div>
                )}
                {run.status === 'done' && <RunResultBox run={run} onCopy={copyText} />}
              </div>
            </aside>
          </div>
        </EditorContext.Provider>
      </div>
    </div>
  )
}
