import { CircleAlert, CircleCheck, CircleSlash, Copy, LoaderCircle, TriangleAlert } from 'lucide-react'

import type { StartInput } from '../../../api/types'
import { RunPartList, toSeconds } from '../../../components/agent/RunParts'
import MarkdownView from '../../../components/common/MarkdownView'
import { NODE_META, OPERATOR_SYMBOL, UNARY_OPERATORS } from '../../../constants/workflow'
import type { NodeRunStep, WorkflowRunState } from './run'

//  * 실행 기록을 보여주는 부품 모음
//  - 편집 화면의 실행 패널(RunPanel.tsx)과 실행 기록 상세 화면(pages/runs/RunDetailPage.tsx)에서 함께 사용
//  - RunStepCard: 실행한 노드 1개의 기록 / RunResultBox: 최종 결과 상자

//  * 실행한 노드 1개의 기록
//  - id="wf-run-step-노드ID": 캔버스에서 노드를 누르면 이 기록으로 스크롤하기 위함
//  - inputs: 시작 노드의 입력 칸 (입력값 옆에 화면 이름을 보여주기 위함)
interface RunStepCardProps {
  step: NodeRunStep
  inputs: StartInput[]
  toolLabel: (toolName: string) => string
}

export function RunStepCard({ step, inputs, toolLabel }: RunStepCardProps) {
  const meta = NODE_META[step.nodeType]
  const Icon = meta.icon
  const { result } = step
  const finished = step.status !== 'running'
  const lastPart = step.parts[step.parts.length - 1]
  // 에이전트 노드: 아직 아무것도 안 왔거나, 도구 실행이 끝나고 다음 생각을 기다리는 중
  const waiting =
    step.nodeType === 'agent' && !finished && (!lastPart || (lastPart.kind === 'tool' && lastPart.result !== undefined))

  return (
    <section id={`wf-run-step-${step.nodeId}`} className={`wf-run-step tone-${meta.tone} is-${step.status}`}>
      <header className="wf-run-step-header">
        <span className="wf-node-icon">
          <Icon size={14} />
        </span>
        <strong>{step.label || meta.label}</strong>
        <RunStatus step={step} />
      </header>

      <div className="wf-run-step-body">
        {/*
          * 시작: 입력값 (시작 노드의 입력 칸 순서대로)
          *  - 저장된 기록(DB의 JSONB)은 이름 순서가 바뀌어 있을 수 있으므로, 입력 칸 목록의 순서를 따름
          */}
        {result?.node_type === 'start' &&
          (inputs.length > 0 ? (
            <dl className="wf-run-values">
              {inputs.map((input) => (
                <div key={input.key}>
                  <dt>{input.label}</dt>
                  <dd>{result.inputs[input.key] || <span className="text-muted">(비어 있음)</span>}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <span className="text-muted">입력 없음</span>
          ))}

        {/* 에이전트: 보낸 내용 + 진행 상황 + 사용량 */}
        {step.nodeType === 'agent' && (
          <>
            {result?.node_type === 'agent' && (
              <details className="tool-step">
                <summary>
                  <strong>보낸 내용</strong>
                  <span className="tool-step-status">{result.prompt.length.toLocaleString()}자</span>
                </summary>
                <div className="tool-step-body">
                  <pre className="tool-step-code">{result.prompt}</pre>
                </div>
              </details>
            )}
            <RunPartList parts={step.parts} finished={finished} toolLabel={toolLabel} />
            {waiting && (
              <div className="chat-waiting">
                <LoaderCircle size={16} className="spin" />
                {lastPart ? '도구 결과를 보고 생각하는 중...' : '답변을 기다리는 중...'}
              </div>
            )}
            {result?.node_type === 'agent' && (
              <>
                {result.finish_reason === 'length' && (
                  <div className="chat-notice is-warning">
                    <TriangleAlert size={14} />
                    최대 토큰 수(Max Tokens)에 도달해 답변이 잘렸습니다.
                  </div>
                )}
                <div className="chat-stats">
                  LLM 호출 {result.steps}회 · 토큰 입력 {result.input_tokens.toLocaleString()} · 출력{' '}
                  {result.output_tokens.toLocaleString()}
                </div>
              </>
            )}
          </>
        )}

        {/* 조건 분기: 실제 값으로 바꾼 비교식 => 참/거짓 */}
        {result?.node_type === 'condition' && (
          <div className="wf-run-condition">
            <code className="wf-node-code">
              {result.left || '(빈 값)'} {OPERATOR_SYMBOL[result.operator]}{' '}
              {UNARY_OPERATORS.includes(result.operator) ? '' : result.right || '(빈 값)'}
            </code>
            <span className={result.result ? 'pill pill-sm wf-branch-true' : 'pill pill-sm wf-branch-false'}>
              {result.result ? '참' : '거짓'} 쪽으로 이동
            </span>
          </div>
        )}

        {/* 끝: 최종 결과는 아래 "최종 결과" 상자에 표시 */}
        {result?.node_type === 'end' && <span className="text-muted">최종 결과를 만들었습니다.</span>}

        {step.error && (
          <div className="chat-notice is-error">
            <CircleAlert size={14} />
            {step.error}
          </div>
        )}
      </div>
    </section>
  )
}

//  * 노드 기록 오른쪽 위 상태 표시 (실행 중... / 완료 (1.23초) / 오류 / 중지됨)
//  - 걸린 시간은 에이전트 노드만 표시 (나머지 노드는 거의 0초라 의미가 없음)
function RunStatus({ step }: { step: NodeRunStep }) {
  if (step.status === 'running') {
    return (
      <span className="tool-step-status">
        <LoaderCircle size={14} className="spin" />
        실행 중...
      </span>
    )
  }
  if (step.status === 'error') {
    return (
      <span className="tool-step-status is-error">
        <CircleAlert size={14} />
        오류
      </span>
    )
  }
  if (step.status === 'stopped') {
    return (
      <span className="tool-step-status">
        <CircleSlash size={14} />
        중지됨
      </span>
    )
  }
  return (
    <span className="tool-step-status is-success">
      <CircleCheck size={14} />
      완료{step.nodeType === 'agent' && step.durationMs !== undefined && ` (${toSeconds(step.durationMs)})`}
    </span>
  )
}

//  * 최종 결과 상자 (마크다운으로 표시 + 복사 버튼 + 사용량)
interface RunResultBoxProps {
  run: WorkflowRunState
  onCopy: (text: string) => void
}

export function RunResultBox({ run, onCopy }: RunResultBoxProps) {
  return (
    <section className="wf-run-result">
      <div className="wf-run-result-header">
        <strong>
          <CircleCheck size={16} />
          최종 결과
        </strong>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => onCopy(run.output ?? '')}
          disabled={!run.output}
        >
          <Copy size={14} />
          복사
        </button>
      </div>
      {run.output ? <MarkdownView text={run.output} /> : <span className="text-muted">(비어 있음)</span>}
      {run.stats && (
        <div className="chat-stats">
          토큰 입력 {run.stats.inputTokens.toLocaleString()} · 출력 {run.stats.outputTokens.toLocaleString()} · 전체{' '}
          {toSeconds(run.stats.latencyMs)}
        </div>
      )}
    </section>
  )
}
