// [수정] * 노드 카드에 실행 상태 표시 추가 [2026-11-10 17:05]
// [기존] 노드 카드에 문제(⚠)만 표시했습니다.
// [변경] 실행 중에는 노드 카드 테두리 색과 아이콘으로 실행 상태(실행 중/완료/오류/중지/건너뜀)를 보여줍니다.
//        (색은 styles/workflow.css 의 .wf-node.run-xxx)

import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react'
import { CircleAlert, CircleCheck, CircleSlash, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import type { WorkflowNodeType } from '../../../api/types'
import { NODE_META, OPERATOR_SYMBOL, UNARY_OPERATORS } from '../../../constants/workflow'
import { useEditorContext } from './EditorContext'
import type { AgentFlowNode, ConditionFlowNode, EndFlowNode, StartFlowNode } from './flow'

//  * 캔버스에 그려지는 노드 카드 (노드 종류별 4가지)
//  - Handle: 연결선을 잇는 동그란 점
//    - target(왼쪽): 들어오는 선 / source(오른쪽): 나가는 선
//    - 시작 노드는 들어오는 점이 없고, 끝 노드는 나가는 점이 없음
//    - 조건 분기 노드는 나가는 점이 2개 (id="true": 참 / id="false": 거짓)
//  - 노드 카드에는 짧은 요약만 보여주고, 자세한 설정은 오른쪽 설정 패널에서 함

// 긴 글은 앞부분만 (카드가 너무 커지지 않도록)
const shorten = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max)}…` : text)

// 실행 상태별 아이콘과 설명 (건너뜀은 카드를 흐리게만 하고 아이콘은 없음)
const RUN_STATUS_ICON = {
  running: { icon: <LoaderCircle size={16} className="spin" />, title: '실행 중' },
  done: { icon: <CircleCheck size={16} />, title: '완료' },
  error: { icon: <CircleAlert size={16} />, title: '오류' },
  stopped: { icon: <CircleSlash size={16} />, title: '중지됨' },
}

// 노드 카드 공통 틀 (아이콘 + 종류 + 이름 + 문제/실행 상태 표시 + 본문)
interface NodeCardProps {
  id: string
  type: WorkflowNodeType
  label: string
  selected: boolean
  children: ReactNode
}

function NodeCard({ id, type, label, selected, children }: NodeCardProps) {
  const { issuesByNode, runStatusByNode } = useEditorContext()
  const meta = NODE_META[type]
  const Icon = meta.icon
  const issues = issuesByNode.get(id)
  const runStatus = runStatusByNode.get(id)
  const runIcon = runStatus && runStatus !== 'skipped' ? RUN_STATUS_ICON[runStatus] : null

  const classNames = ['wf-node', `tone-${meta.tone}`]
  if (selected) {
    classNames.push('is-selected')
  }
  if (issues) {
    classNames.push('has-issue')
  }
  if (runStatus) {
    classNames.push(`run-${runStatus}`)
  }

  return (
    <div className={classNames.join(' ')}>
      <div className="wf-node-header">
        <span className="wf-node-icon">
          <Icon size={16} />
        </span>
        <div className="wf-node-heading">
          <span className="wf-node-type">{meta.label}</span>
          <span className="wf-node-title">{label || meta.label}</span>
        </div>
        {/* 문제가 있으면 경고 아이콘 (마우스를 올리면 문제 내용) */}
        {issues && (
          <span className="wf-node-issue" title={issues.join('\n')}>
            <TriangleAlert size={16} />
          </span>
        )}
        {runIcon && (
          <span className="wf-node-run" title={runIcon.title}>
            {runIcon.icon}
          </span>
        )}
      </div>
      <div className="wf-node-body">{children}</div>
    </div>
  )
}

// 1. 시작 노드 - 입력 칸 목록
function StartNodeView({ id, data, selected }: NodeProps<StartFlowNode>) {
  return (
    <>
      <NodeCard id={id} type="start" label={data.label} selected={selected}>
        {data.inputs.length > 0 ? (
          <ul className="wf-node-list">
            {data.inputs.map((input) => (
              <li key={input.key}>
                {input.label}
                <span className="wf-node-muted">
                  {' '}
                  {input.type === 'number' ? '숫자' : '글자'}
                  {input.required ? '' : ', 선택'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="wf-node-muted">입력 칸 없음</span>
        )}
      </NodeCard>
      <Handle type="source" position={Position.Right} />
    </>
  )
}

// 2. 에이전트 노드 - 선택한 에이전트 이름 + 보낼 내용 미리보기
function AgentNodeView({ id, data, selected }: NodeProps<AgentFlowNode>) {
  const { agentsById } = useEditorContext()
  const agent = data.agent_id !== null ? agentsById.get(data.agent_id) : undefined

  return (
    <>
      <Handle type="target" position={Position.Left} />
      <NodeCard id={id} type="agent" label={data.label} selected={selected}>
        <div className="wf-node-strong">
          {agent ? agent.name : data.agent_id !== null ? '(삭제된 에이전트)' : '에이전트를 선택하세요'}
        </div>
        {data.prompt && <div className="wf-node-muted">{shorten(data.prompt)}</div>}
      </NodeCard>
      <Handle type="source" position={Position.Right} />
    </>
  )
}

// 3. 조건 분기 노드 - 비교식 + 참/거짓 출구 2개
function ConditionNodeView({ id, data, selected }: NodeProps<ConditionFlowNode>) {
  const unary = UNARY_OPERATORS.includes(data.operator)
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <NodeCard id={id} type="condition" label={data.label} selected={selected}>
        {data.left ? (
          <code className="wf-node-code">
            {shorten(data.left, 30)} {OPERATOR_SYMBOL[data.operator]} {unary ? '' : shorten(data.right, 20)}
          </code>
        ) : (
          <span className="wf-node-muted">조건을 입력하세요</span>
        )}
        {/* 출구 이름표 (오른쪽 점 옆) */}
        <div className="wf-node-branches">
          <span className="wf-branch-true">참</span>
          <span className="wf-branch-false">거짓</span>
        </div>
      </NodeCard>
      {/* style.top: 점의 세로 위치 (참은 위쪽, 거짓은 아래쪽) */}
      <Handle type="source" id="true" position={Position.Right} className="wf-handle-true" style={{ top: '62%' }} />
      <Handle type="source" id="false" position={Position.Right} className="wf-handle-false" style={{ top: '84%' }} />
    </>
  )
}

// 4. 끝 노드 - 출력 미리보기
function EndNodeView({ id, data, selected }: NodeProps<EndFlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <NodeCard id={id} type="end" label={data.label} selected={selected}>
        {data.output ? (
          <div className="wf-node-muted">{shorten(data.output)}</div>
        ) : (
          <span className="wf-node-muted">출력할 내용을 입력하세요</span>
        )}
      </NodeCard>
    </>
  )
}

//  * 노드 종류 => 그릴 컴포넌트 (React Flow의 nodeTypes)
//  - ⚠️ 컴포넌트 밖에 한 번만 만들어야 함 (화면을 다시 그릴 때마다 새로 만들면 React Flow가 경고를 냄)
export const WORKFLOW_NODE_TYPES: NodeTypes = {
  start: StartNodeView,
  agent: AgentNodeView,
  condition: ConditionNodeView,
  end: EndNodeView,
}
