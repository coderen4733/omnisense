// [수정] * 워크플로우 실행 기능 추가 [2026-11-10 17:15]
// [기존] 편집(노드 추가/연결/설정)과 저장만 할 수 있었습니다.
// [변경] 위쪽 "실행" 버튼 => 오른쪽에 실행 패널(editor/RunPanel.tsx)이 열리고,
//        입력값을 넣어 실행하면 노드별 진행 상황을 패널과 캔버스(노드 색, 지나간 연결선)에 실시간으로 보여줍니다.
//        - 저장하지 않은 변경사항이 있으면 먼저 저장한 뒤 실행 (서버는 저장된 그래프로 실행하므로)
//        - 실행 중에는 편집(노드 이동/연결/삭제/추가)을 잠금
//        - 에이전트 노드의 도구 이름을 화면 이름으로 보여주기 위해 도구 목록도 함께 불러옴

import '@xyflow/react/dist/style.css' // 캔버스 라이브러리 기본 모양 (빌드 결과에 포함됨 - 폐쇄망 대비)

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
} from '@xyflow/react'
import { ArrowLeft, CircleAlert, CircleCheck, LoaderCircle, Play, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { getAgents, getAgentTools } from '../../api/agents'
import { getErrorMessage } from '../../api/client'
import type { Agent, AgentTool, Workflow, WorkflowNodeType } from '../../api/types'
import { getWorkflow, streamWorkflowRun, updateWorkflow } from '../../api/workflows'
import PageHeader from '../../components/common/PageHeader'
import { ADDABLE_NODE_TYPES, DEFAULT_NODE_DATA, NODE_META, WORKFLOW_MANAGER_ROLES } from '../../constants/workflow'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useToast } from '../../contexts/ToastContext'
import { formatDateTime } from '../../utils/format'
import { EditorContext } from './editor/EditorContext'
import {
  availableVariables,
  canReach,
  findFreePosition,
  makeEdge,
  nextNodeId,
  toFlowEdges,
  toFlowNodes,
  toGraph,
  type WorkflowFlowNode,
} from './editor/flow'
import NodeSettings from './editor/NodeSettings'
import {
  applyWorkflowEvent,
  nodeRunStatuses,
  passedEdgeIds,
  STARTED_RUN,
  stopRun,
  type WorkflowRunState,
} from './editor/run'
import RunPanel from './editor/RunPanel'
import { WORKFLOW_NODE_TYPES } from './editor/WorkflowNodes'

//  * 워크플로우 편집 화면 (/workflows/:workflowId)
//  - 왼쪽: 노드 목록 (캔버스로 끌어다 놓거나, 눌러서 추가)
//  - 가운데: 캔버스 (노드 이동, 점과 점을 이어서 연결, 선택 후 Delete/Backspace로 삭제)
//  - 오른쪽: 선택한 노드의 설정 (아무것도 선택하지 않으면 사용법 안내)
//           / 위쪽 "실행" 버튼을 누르면 실행 패널
//  - 저장: 위쪽 "저장" 버튼 또는 Ctrl+S (Mac: ⌘+S)
//    - 저장하면 서버가 "실행 전에 고쳐야 할 문제"를 점검해서 알려줌 (노드에 ⚠ 표시)
//  - 일반 사용자(user)는 보기만 가능
//  - 이 화면은 캔버스 라이브러리가 커서, 처음 열 때 따로 내려받음 (App.tsx 의 lazy 참고)

// 왼쪽 노드 목록에서 캔버스로 끌어다 놓을 때 쓰는 데이터 이름
const DRAG_DATA_TYPE = 'application/omnisense-node'

export default function WorkflowEditorPage() {
  // 1. 주소의 워크플로우 번호 (예: /workflows/3 => "3")
  const { workflowId } = useParams()
  const numericId = Number(workflowId)
  const invalidId = !Number.isInteger(numericId) || numericId < 1

  const { user } = useAuth()
  const readOnly = !user || !WORKFLOW_MANAGER_ROLES.includes(user.role)

  // 2. 워크플로우 + 에이전트 목록 + 도구 목록 불러오기
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [tools, setTools] = useState<AgentTool[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    if (invalidId) {
      return
    }
    Promise.all([getWorkflow(numericId), getAgents(), getAgentTools()])
      .then(([workflowData, agentList, toolList]) => {
        if (!ignore) {
          setWorkflow(workflowData)
          setAgents(agentList)
          setTools(toolList)
        }
      })
      .catch((error) => {
        if (!ignore) {
          setLoadError(getErrorMessage(error))
        }
      })
    return () => {
      ignore = true
    }
  }, [numericId, invalidId])

  // 잘못된 주소 / 불러오기 실패 / 불러오는 중
  if (invalidId || loadError || !workflow) {
    const errorText = invalidId ? '잘못된 워크플로우 주소입니다.' : loadError
    return (
      <div className="page">
        <PageHeader title="워크플로우 편집" />
        <section className={errorText ? 'card empty-state is-error' : 'card empty-state'}>
          {errorText ?? '불러오는 중...'}
        </section>
      </div>
    )
  }

  //  * ReactFlowProvider: 편집기 안에서 useReactFlow()(화면 좌표 => 캔버스 좌표 변환 등)를 쓰기 위해 감쌈
  //  - key: 다른 워크플로우로 이동하면 편집기를 새로 만들어 이전 내용이 남지 않도록
  return (
    <ReactFlowProvider key={workflow.id}>
      <WorkflowEditor initialWorkflow={workflow} agents={agents} tools={tools} readOnly={readOnly} />
    </ReactFlowProvider>
  )
}

interface WorkflowEditorProps {
  initialWorkflow: Workflow
  agents: Agent[]
  tools: AgentTool[]
  readOnly: boolean
}

function WorkflowEditor({ initialWorkflow, agents, tools, readOnly }: WorkflowEditorProps) {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const { showToast } = useToast()
  const { screenToFlowPosition, fitView } = useReactFlow()
  const canvasRef = useRef<HTMLDivElement>(null)

  // 1. 캔버스 상태 (노드, 연결선) - React Flow가 제공하는 상태 관리 도구 사용
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowFlowNode>(toFlowNodes(initialWorkflow.graph))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toFlowEdges(initialWorkflow.graph))
  const [selectedId, setSelectedId] = useState<string | null>(null)

  //  2. 저장 상태
  //  - saved: 마지막으로 저장한(또는 불러온) 워크플로우 (문제 목록, 수정 시각)
  //  - savedSnapshot: 마지막 저장 시점의 그래프를 글자(JSON)로 바꾼 것
  //    => 지금 그래프와 비교해서 다르면 "저장되지 않은 변경사항"
  const [saved, setSaved] = useState(initialWorkflow)
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(toGraph(toFlowNodes(initialWorkflow.graph), toFlowEdges(initialWorkflow.graph))),
  )
  const currentGraph = useMemo(() => toGraph(nodes, edges), [nodes, edges])
  const dirty = JSON.stringify(currentGraph) !== savedSnapshot
  const [saving, setSaving] = useState(false)
  const [showIssues, setShowIssues] = useState(false)

  //  * 실행 상태
  //  - panelMode: 오른쪽 패널에 무엇을 보여줄지 (settings: 노드 설정 / run: 실행 패널)
  //  - run: 마지막 실행 기록 (실행한 적이 없으면 null)
  //  - runInputs: 실행 패널에 입력한 값 (패널을 닫았다 열어도 유지)
  //  - editable: 편집할 수 있는지 (보기 전용이거나 실행 중이면 편집 잠금)
  const [panelMode, setPanelMode] = useState<'settings' | 'run'>('settings')
  const [run, setRun] = useState<WorkflowRunState | null>(null)
  const [runInputs, setRunInputs] = useState<Record<string, string>>({})
  const runAbortRef = useRef<AbortController | null>(null) // 중지 버튼용
  const running = run?.status === 'running'
  const editable = !readOnly && !running

  // 3. 노드별 문제 목록 (마지막 저장 기준) - 노드 카드와 설정 패널에 표시
  const issuesByNode = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const issue of saved.issues) {
      if (issue.node_id) {
        map.set(issue.node_id, [...(map.get(issue.node_id) ?? []), issue.message])
      }
    }
    return map
  }, [saved.issues])
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  // 노드별 실행 상태 (노드 카드 색) - 노드 ID 목록이 바뀔 때도 다시 계산 (건너뛴 노드 표시)
  const nodeIdsKey = nodes.map((node) => node.id).join(',')
  const runStatusByNode = useMemo(() => nodeRunStatuses(run, nodeIdsKey.split(',')), [run, nodeIdsKey])
  const editorContext = useMemo(
    () => ({ agentsById, issuesByNode, runStatusByNode }),
    [agentsById, issuesByNode, runStatusByNode],
  )

  //  * 캔버스에 그릴 연결선 = 저장용 연결선 + 이번 실행에서 지나간 선 강조
  //  - 강조는 화면에만 적용 (저장용 edges 는 그대로 => 저장할 내용에 섞이지 않음)
  //  - animated: 실행 중에는 선이 흐르듯 움직임
  const displayEdges = useMemo(() => {
    const passed = passedEdgeIds(run, edges)
    if (passed.size === 0) {
      return edges
    }
    return edges.map((edge) =>
      passed.has(edge.id)
        ? { ...edge, animated: running, className: `${edge.className ?? ''} wf-edge-passed`.trim() }
        : edge,
    )
  }, [run, edges, running])

  const selectedNode = nodes.find((node) => node.id === selectedId)

  // 4. 저장 (실행 전 저장에서도 쓰기 위해 저장한 결과를 돌려줌 - 실패하면 null)
  const handleSave = useCallback(async (): Promise<Workflow | null> => {
    if (readOnly || saving) {
      return null
    }
    setSaving(true)
    try {
      const result = await updateWorkflow(saved.id, { graph: currentGraph })
      setSaved(result)
      // 보낸 그래프를 기준으로 저장 상태 갱신 (저장하는 동안 더 고친 내용이 있으면 계속 "변경사항"으로 표시됨)
      setSavedSnapshot(JSON.stringify(currentGraph))
      showToast(
        result.issues.length === 0
          ? '저장했습니다. 실행할 수 있는 상태입니다.'
          : `저장했습니다. 실행 전에 고쳐야 할 문제가 ${result.issues.length}개 있습니다.`,
        result.issues.length === 0 ? 'success' : 'info',
      )
      return result
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      return null
    } finally {
      setSaving(false)
    }
  }, [readOnly, saving, saved.id, currentGraph, showToast])

  // 5. Ctrl+S / ⌘+S 로 저장 (브라우저의 "페이지 저장" 대신)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty) {
          handleSave()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dirty, handleSave])

  // 6. 저장하지 않고 창을 닫거나 새로고침하면 브라우저가 확인 창을 띄움
  useEffect(() => {
    if (!dirty) {
      return
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  //  * 실행
  //  - 저장하지 않은 변경사항이 있으면 먼저 저장 (서버는 마지막으로 저장한 그래프로 실행함)
  //  - 고쳐야 할 문제가 남아 있으면 실행하지 않고 문제 목록을 열어 줌
  const handleRun = async () => {
    if (running || saving) {
      return
    }
    let target = saved
    if (dirty && !readOnly) {
      const result = await handleSave()
      if (!result) {
        return
      }
      target = result
    }
    if (target.issues.length > 0) {
      setShowIssues(true)
      return
    }

    // 스트리밍으로 실행 결과 받기 (이벤트가 올 때마다 실행 상태에 반영)
    const controller = new AbortController()
    runAbortRef.current = controller
    setRun(STARTED_RUN)
    try {
      await streamWorkflowRun(
        target.id,
        { inputs: runInputs },
        (event) => setRun((prev) => (prev ? applyWorkflowEvent(prev, event) : prev)),
        controller.signal,
      )
      // 끝(done)이나 오류(error) 이벤트 없이 응답이 끝남 = 중간에 연결이 끊김
      setRun((prev) =>
        prev?.status === 'running' ? stopRun(prev, 'error', '실행이 중간에 끊겼습니다. 다시 실행해 주세요.') : prev,
      )
    } catch (error) {
      // 사용자가 중지 / 실행 전 확인 실패(입력값 누락 등) 또는 서버 연결 실패
      setRun((prev) =>
        prev && controller.signal.aborted ? stopRun(prev, 'stopped') : stopRun(prev ?? STARTED_RUN, 'error', getErrorMessage(error)),
      )
    } finally {
      runAbortRef.current = null
    }
  }

  //  * 실행 패널을 열고 닫으면 오른쪽 패널 폭이 바뀌어 캔버스 크기도 바뀜
  //  => 노드가 가려지지 않도록 다시 모든 노드가 보이게 맞춤
  //  - 실행 패널이 열려 있으면 50%까지 줄여서라도 전체 흐름이 보이게 (진행 상황을 한눈에 보기 위함)
  //    편집할 때는 처음 열 때와 같이 75%까지만 줄임 (글자가 읽기 어려울 만큼 작아지지 않도록)
  //  - setTimeout: 바뀐 패널 폭이 캔버스 크기에 반영될 때까지 잠깐(0.1초) 기다린 뒤에 맞춤
  //    (캔버스 라이브러리는 화면 크기가 바뀐 것을 한 박자 늦게 알아차리므로, 바로 맞추면 예전 크기 기준이 됨)
  useEffect(() => {
    const minZoom = panelMode === 'run' ? 0.5 : 0.75
    const timer = setTimeout(() => fitView({ maxZoom: 1, minZoom, duration: 200 }), 100)
    return () => clearTimeout(timer)
  }, [panelMode, fitView])

  // 화면을 벗어나면 진행 중인 실행을 중단
  useEffect(() => {
    return () => runAbortRef.current?.abort()
  }, [])

  // 최종 결과 복사 (클립보드 사용이 막힌 환경이면 안내)
  const copyText = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast('최종 결과를 복사했습니다.', 'success'))
      .catch(() => showToast('복사하지 못했습니다. 직접 선택해서 복사해 주세요.', 'error'))
  }

  // 실행할 수 없는 이유 (마지막 저장 기준 - 저장하지 않은 변경사항이 있으면 실행할 때 저장 후 다시 확인)
  const runBlockedReason = !saved.is_active
    ? "'사용 안 함' 상태인 워크플로우입니다. 목록에서 '사용'으로 바꿔야 실행할 수 있습니다."
    : !dirty && saved.issues.length > 0
      ? `실행 전에 고쳐야 할 문제가 ${saved.issues.length}개 있습니다. 위쪽 문제 목록을 확인해 주세요.`
      : null
  const startNode = nodes.find((node) => node.type === 'start')
  const toolLabel = (toolName: string) => tools.find((tool) => tool.name === toolName)?.label ?? toolName

  // 노드 클릭 => 선택 / 실행 패널이 열려 있으면 그 노드의 실행 기록으로 스크롤
  const handleNodeClick = (nodeId: string) => {
    setSelectedId(nodeId)
    if (panelMode === 'run') {
      document.getElementById(`wf-run-step-${nodeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  // 목록으로 돌아가기 (저장하지 않은 변경사항이 있으면 확인)
  const handleBack = () => {
    if (dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 저장하지 않고 나갈까요?')) {
      return
    }
    navigate('/workflows')
  }

  //  7. 노드 추가 (position: 캔버스 좌표)
  //  - 새 노드만 선택 상태로 (selected: 캔버스의 선택 표시 - 기존에 선택돼 있던 노드는 선택 해제)
  const addNode = (type: WorkflowNodeType, position: { x: number; y: number }) => {
    const id = nextNodeId(type, nodes)
    const node = { id, type, position, data: DEFAULT_NODE_DATA[type](), selected: true } as WorkflowFlowNode
    setNodes((prev) => [...prev.map((item) => ({ ...item, selected: false })), node])
    setSelectedId(id)
  }

  // 7-1. 왼쪽 목록에서 끌어다 놓기 => 놓은 자리에 추가
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const type = event.dataTransfer.getData(DRAG_DATA_TYPE) as WorkflowNodeType
    if (!ADDABLE_NODE_TYPES.includes(type)) {
      return
    }
    // screenToFlowPosition: 화면(마우스) 좌표 => 캔버스 좌표 (확대/이동 상태 반영)
    addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }

  // 7-2. 왼쪽 목록에서 클릭 => 캔버스 가운데에 추가 (이미 노드가 있으면 아래쪽 빈자리에)
  const handleClickAdd = (type: WorkflowNodeType) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    const center = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    addNode(type, findFreePosition({ x: center.x - 120, y: center.y - 40 }, nodes))
  }

  //  8. 연결선 잇기
  //  - 같은 출구에서 이미 나가는 선이 있으면 새 선으로 바꿈
  //    (조건 분기를 뺀 노드는 다음 노드를 하나만 가질 수 있음 - 조건 분기는 참/거짓 출구마다 하나)
  const handleConnect = (connection: Connection) => {
    setEdges((prev) => [
      ...prev.filter(
        (edge) => !(edge.source === connection.source && (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null)),
      ),
      makeEdge(connection.source, connection.sourceHandle, connection.target),
    ])
  }

  //  * 이어도 되는 연결인지 확인 (안 되면 선이 이어지지 않음)
  //  - 자기 자신과 연결 불가 / 되돌아오는 고리(순환)가 생기는 연결 불가
  const isValidConnection: IsValidConnection = (connection) =>
    connection.source !== connection.target && !canReach(connection.target, connection.source, edges)

  // 9. 선택한 노드의 설정값 바꾸기 / 노드 삭제
  const updateSelectedData = (patch: Record<string, unknown>) => {
    setNodes((prev) =>
      prev.map((node) => (node.id === selectedId ? ({ ...node, data: { ...node.data, ...patch } } as WorkflowFlowNode) : node)),
    )
  }

  const deleteSelected = () => {
    if (!selectedId) {
      return
    }
    setNodes((prev) => prev.filter((node) => node.id !== selectedId))
    setEdges((prev) => prev.filter((edge) => edge.source !== selectedId && edge.target !== selectedId))
    setSelectedId(null)
  }

  // 10. 문제 목록에서 클릭 => 해당 노드 선택 + 화면 가운데로
  const focusNode = (nodeId: string) => {
    setSelectedId(nodeId)
    setNodes((prev) => prev.map((node) => ({ ...node, selected: node.id === nodeId })))
    fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.2 })
  }

  const issueCount = saved.issues.length

  return (
    <EditorContext.Provider value={editorContext}>
      <div className="wf-editor">
        {/* 위쪽: 이름 + 저장 상태 + 문제 + 저장 버튼 */}
        <div className="wf-toolbar">
          <button type="button" className="icon-btn" onClick={handleBack} aria-label="워크플로우 목록" title="워크플로우 목록">
            <ArrowLeft size={20} />
          </button>
          <div className="wf-toolbar-title">
            <h1>{saved.name}</h1>
            <span className="wf-toolbar-meta">
              {readOnly
                ? '보기 전용'
                : dirty
                  ? '저장되지 않은 변경사항이 있습니다'
                  : `저장됨 · ${formatDateTime(saved.updated_at)}`}
            </span>
          </div>
          <button
            type="button"
            className={issueCount > 0 ? 'wf-issue-btn has-issue' : 'wf-issue-btn'}
            onClick={() => setShowIssues((prev) => !prev)}
            aria-expanded={showIssues}
            title="마지막으로 저장한 내용 기준"
          >
            {issueCount > 0 ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
            {issueCount > 0 ? `고쳐야 할 문제 ${issueCount}` : '실행 가능'}
          </button>
          {/* 실행 패널 열기 (실행 중이면 진행 상황 표시) */}
          <button
            type="button"
            className={panelMode === 'run' ? 'btn btn-outline is-active' : 'btn btn-outline'}
            onClick={() => setPanelMode('run')}
            aria-pressed={panelMode === 'run'}
          >
            {running ? <LoaderCircle size={18} className="spin" /> : <Play size={18} />}
            {running ? '실행 중' : '실행'}
          </button>
          {!readOnly && (
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!dirty || saving || running}>
              {saving ? <LoaderCircle size={18} className="spin" /> : <Save size={18} />}
              저장
            </button>
          )}
        </div>

        {/* 문제 목록 (위쪽 버튼으로 열고 닫음 / 마지막 저장 기준) */}
        {showIssues && (
          <div className="wf-issues">
            {issueCount === 0 ? (
              <span>실행 전에 고쳐야 할 문제가 없습니다.</span>
            ) : (
              <ul>
                {saved.issues.map((issue, index) => (
                  <li key={index}>
                    {issue.node_id ? (
                      <button type="button" className="text-btn" onClick={() => focusNode(issue.node_id!)}>
                        {nodes.find((node) => node.id === issue.node_id)?.data.label ?? issue.node_id}
                      </button>
                    ) : (
                      <strong>워크플로우</strong>
                    )}
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {dirty && <span className="field-hint">저장하면 다시 점검합니다.</span>}
          </div>
        )}

        <div className={panelMode === 'run' ? 'wf-body is-run' : 'wf-body'}>
          {/* 왼쪽: 노드 목록 (보기 전용이면 숨김) */}
          {!readOnly && (
            <aside className="wf-palette" aria-label="노드 목록">
              <span className="wf-palette-title">노드</span>
              {ADDABLE_NODE_TYPES.map((type) => {
                const meta = NODE_META[type]
                const Icon = meta.icon
                return (
                  <button
                    key={type}
                    type="button"
                    className="wf-palette-item"
                    disabled={running}
                    draggable={!running}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_DATA_TYPE, type)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => handleClickAdd(type)}
                    title="캔버스로 끌어다 놓거나 클릭해서 추가"
                  >
                    <span className={`wf-node-icon tone-${meta.tone}`}>
                      <Icon size={16} />
                    </span>
                    <span>
                      <strong>{meta.label}</strong>
                      <span className="wf-palette-desc">{meta.description}</span>
                    </span>
                  </button>
                )
              })}
              <span className="field-hint wf-palette-hint">
                끌어다 놓거나 클릭해서 추가합니다. 노드 오른쪽 점을 다음 노드 왼쪽 점으로 끌어서 연결합니다.
              </span>
            </aside>
          )}

          {/* 가운데: 캔버스 */}
          <div className="wf-canvas" ref={canvasRef}>
            <ReactFlow
              nodes={nodes}
              edges={displayEdges}
              nodeTypes={WORKFLOW_NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={handleConnect}
              isValidConnection={isValidConnection}
              onNodeClick={(_, node) => handleNodeClick(node.id)}
              onPaneClick={() => setSelectedId(null)}
              onNodesDelete={(deleted) => {
                if (deleted.some((node) => node.id === selectedId)) {
                  setSelectedId(null)
                }
              }}
              onDrop={handleDrop}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              nodesDraggable={editable}
              nodesConnectable={editable}
              deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
              colorMode={theme}
              //  * 처음 열 때 모든 노드가 보이도록 확대/축소 (fitView)
              //  - 단, 75%보다 작게 줄이지 않음 (글자가 읽기 어려울 만큼 작아지지 않도록)
              //    => 노드가 많아 화면을 넘치면 가운데 부분이 보이고, 왼쪽 아래 "전체 보기" 버튼으로 모두 볼 수 있음
              fitView
              fitViewOptions={{ maxZoom: 1, minZoom: 0.75 }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
              {/* 오른쪽 아래 작은 지도 (노드 종류별 색 - styles/workflow.css 의 .wf-mini-xxx) */}
              <MiniMap
                pannable
                zoomable
                nodeClassName={(node) => `wf-mini-${node.type}`}
                nodeBorderRadius={6}
                style={{ width: 160, height: 100 }}
              />
            </ReactFlow>
          </div>

          {/* 오른쪽: 실행 패널 / 선택한 노드 설정 / 안내 */}
          <aside className="wf-panel" aria-label={panelMode === 'run' ? '실행' : '노드 설정'}>
            {panelMode === 'run' ? (
              <RunPanel
                workflowId={saved.id}
                inputs={startNode?.type === 'start' ? startNode.data.inputs : []}
                values={runInputs}
                onValuesChange={setRunInputs}
                run={run}
                blockedReason={runBlockedReason}
                needsSave={dirty && !readOnly}
                saving={saving}
                toolLabel={toolLabel}
                onRun={handleRun}
                onStop={() => runAbortRef.current?.abort()}
                onClose={() => setPanelMode('settings')}
                onCopy={copyText}
              />
            ) : selectedNode ? (
              <NodeSettings
                key={selectedNode.id}
                node={selectedNode}
                variables={availableVariables(selectedNode.id, nodes, edges)}
                agents={agents}
                issues={issuesByNode.get(selectedNode.id) ?? []}
                readOnly={!editable}
                onChange={updateSelectedData}
                onDelete={deleteSelected}
              />
            ) : (
              <div className="wf-guide">
                <strong>{saved.name}</strong>
                {saved.description && <p>{saved.description}</p>}
                <ul>
                  <li>노드를 클릭하면 여기에서 설정을 바꿀 수 있습니다.</li>
                  <li>
                    노드 사이 값 전달: 설정 칸 아래 <b>앞 노드 값 넣기</b>를 누르면 {'{{노드ID.항목}}'} 이 들어갑니다.
                  </li>
                  <li>조건 분기는 '참' / '거짓' 점에서 각각 다음 노드로 연결합니다.</li>
                  <li>노드나 연결선을 선택하고 Delete(또는 Backspace)를 누르면 삭제됩니다.</li>
                  <li>Ctrl+S (Mac: ⌘+S)로 저장합니다.</li>
                  <li>위쪽 실행 버튼을 누르면 입력값을 넣어 실행해 볼 수 있습니다.</li>
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </EditorContext.Provider>
  )
}
