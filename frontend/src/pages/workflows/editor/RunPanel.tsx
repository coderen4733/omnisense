// [수정] * 실행 기록 연결 [2026-11-11 12:30]
// [기존] 실행 기록을 저장하지 않아서 패널을 닫거나 새로고침하면 사라졌고,
//        노드 기록/최종 결과 상자 부품이 이 파일 안에 있었습니다.
// [변경] - 실행이 끝나면 "실행 기록 보기" 링크를 보여줍니다. (서버에 자동 저장된 기록의 상세 화면)
//        - 실행 중이 아닐 때 이 워크플로우의 "최근 실행 기록" 5건을 보여줍니다.
//        - 노드 기록(RunStepCard)과 최종 결과 상자(RunResultBox)는 실행 기록 상세 화면에서도 쓰도록
//          RunStepCard.tsx 로 옮겼습니다.

import { CircleAlert, ExternalLink, LoaderCircle, Play, RefreshCw, Square, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { getErrorMessage } from '../../../api/client'
import { getRuns } from '../../../api/runs'
import type { RunSummary, StartInput } from '../../../api/types'
import { formatDuration, RUN_STATUS_META } from '../../../constants/run'
import { formatDateTime } from '../../../utils/format'
import type { WorkflowRunState } from './run'
import { RunResultBox, RunStepCard } from './RunStepCard'

//  * 워크플로우 실행 패널 (편집 화면 오른쪽 - 위쪽 "실행" 버튼으로 열림)
//  - 위: 시작 노드의 입력 칸 + 실행/중지 버튼
//  - 아래: 실행한 노드 기록 (실행 순서대로) + 최종 결과
//    - 에이전트 노드: 생각 과정, 도구 실행, 답변을 에이전트 테스트 실행 화면과 같은 모양으로 보여줌
//    - 조건 분기 노드: {{ }} 를 실제 값으로 바꾼 비교식과 결과(참/거짓)
//  - 실행 기록은 서버가 자동으로 저장함 => "실행 기록 보기", "최근 실행 기록"에서 다시 볼 수 있음
//    (기록 상세 화면은 새 탭으로 열어서, 편집 중인 내용이 사라지지 않도록 함)

// 최근 실행 기록을 몇 건 보여줄지
const RECENT_RUN_COUNT = 5

interface RunPanelProps {
  workflowId: number
  inputs: StartInput[] // 시작 노드의 입력 칸
  values: Record<string, string> // 입력한 값 {입력 칸 이름: 값}
  onValuesChange: (values: Record<string, string>) => void
  run: WorkflowRunState | null
  blockedReason: string | null // 실행할 수 없는 이유 (실행할 수 있으면 null)
  needsSave: boolean // 저장하지 않은 변경사항이 있음 => 실행하면 먼저 저장
  saving: boolean // 저장 중 (실행 전 저장 포함)
  toolLabel: (toolName: string) => string
  onRun: () => void
  onStop: () => void
  onClose: () => void
  onCopy: (text: string) => void
}

export default function RunPanel({
  workflowId,
  inputs,
  values,
  onValuesChange,
  run,
  blockedReason,
  needsSave,
  saving,
  toolLabel,
  onRun,
  onStop,
  onClose,
  onCopy,
}: RunPanelProps) {
  const running = run?.status === 'running'
  const endRef = useRef<HTMLDivElement>(null) // 기록 맨 아래 (자동 스크롤용)

  // 실행 중에는 새 기록이 올 때마다 맨 아래로 스크롤 (block: 'nearest' => 패널 안에서만 움직임)
  useEffect(() => {
    if (running) {
      endRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [run, running])

  //  * 이 워크플로우의 최근 실행 기록 (일반 사용자는 자기 기록만 옴)
  //  - 패널을 열 때, 그리고 실행이 끝날 때마다 다시 불러옴
  const [recentRuns, setRecentRuns] = useState<RunSummary[] | null>(null)
  const [recentError, setRecentError] = useState<string | null>(null)
  const loadRecentRuns = useCallback(() => {
    getRuns({ workflow_id: workflowId, size: RECENT_RUN_COUNT })
      .then((data) => {
        setRecentRuns(data.items)
        setRecentError(null)
      })
      .catch((error) => setRecentError(getErrorMessage(error)))
  }, [workflowId])

  useEffect(() => {
    if (!running) {
      loadRecentRuns()
    }
  }, [running, loadRecentRuns])

  // Enter(입력칸) 또는 실행 버튼 => 실행
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!running && !saving && !blockedReason) {
      onRun()
    }
  }

  return (
    <div className="wf-run">
      <div className="wf-settings-header">
        <span className="wf-node-icon tone-green">
          <Play size={16} />
        </span>
        <div className="wf-settings-heading">
          <strong>워크플로우 실행</strong>
          <span className="wf-node-muted">마지막으로 저장한 내용으로 실행합니다</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          disabled={running}
          aria-label="실행 패널 닫기"
          title={running ? '실행 중에는 닫을 수 없습니다' : '닫기'}
        >
          <X size={18} />
        </button>
      </div>

      {/* 1. 입력 칸 + 실행 버튼 */}
      <form className="wf-run-form" onSubmit={handleSubmit}>
        <fieldset className="wf-fieldset" disabled={running}>
          {inputs.length === 0 && <span className="field-hint">시작 노드에 입력 칸이 없습니다. 바로 실행할 수 있습니다.</span>}
          {inputs.map((input) => (
            <label key={input.key} className="field">
              <span className="field-label">
                {input.label}
                {input.required && <span className="wf-required"> *</span>}
                <span className="wf-node-muted"> {input.type === 'number' ? '숫자' : '글자'}</span>
              </span>
              {input.type === 'number' ? (
                // 숫자 칸: type="text" + inputMode="decimal" => 쉼표(1,000,000)도 입력 가능, 휴대폰은 숫자 키패드
                <input
                  className="input"
                  inputMode="decimal"
                  value={values[input.key] ?? ''}
                  onChange={(event) => onValuesChange({ ...values, [input.key]: event.target.value })}
                  placeholder="예) 1500000"
                />
              ) : (
                <textarea
                  className="input textarea"
                  rows={3}
                  maxLength={20000}
                  value={values[input.key] ?? ''}
                  onChange={(event) => onValuesChange({ ...values, [input.key]: event.target.value })}
                />
              )}
            </label>
          ))}
        </fieldset>

        {blockedReason ? (
          <div className="form-error" role="alert">
            <CircleAlert size={16} />
            <span>{blockedReason}</span>
          </div>
        ) : (
          needsSave && <span className="field-hint">저장하지 않은 변경사항이 있습니다. 실행하면 먼저 저장합니다.</span>
        )}

        {/*
          * 중지 / 실행 버튼
          *  - key 를 다르게 줘서 두 버튼을 서로 다른 HTML 요소로 만듦
          *    (같은 요소를 다시 쓰면, 중지를 누르는 순간 버튼이 "실행(submit)"으로 바뀌면서
          *     브라우저가 그 클릭을 폼 제출로 처리해 실행이 곧바로 다시 시작됨)
          */}
        {running ? (
          <button key="stop" type="button" className="btn btn-outline" onClick={onStop}>
            <Square size={16} />
            중지
          </button>
        ) : (
          <button key="run" type="submit" className="btn btn-primary" disabled={Boolean(blockedReason) || saving}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}
            {saving ? '저장 중...' : needsSave ? '저장 후 실행' : run ? '다시 실행' : '실행'}
          </button>
        )}
      </form>

      {/* 2. 실행 기록 */}
      {run && (
        <div className="wf-run-steps">
          {run.steps.length === 0 && running && (
            <div className="chat-waiting">
              <LoaderCircle size={16} className="spin" />
              실행을 준비하는 중...
            </div>
          )}
          {run.steps.map((step) => (
            <RunStepCard key={step.nodeId} step={step} inputs={inputs} toolLabel={toolLabel} />
          ))}

          {/* 워크플로우 전체 오류 (노드와 상관없는 오류 - 실행 시작 전 확인 실패, 연결 끊김 등) */}
          {run.status === 'error' && run.error && !run.steps.some((step) => step.error) && (
            <div className="chat-notice is-error">
              <CircleAlert size={14} />
              {run.error}
            </div>
          )}
          {run.status === 'stopped' && <div className="chat-notice">실행을 중지했습니다.</div>}

          {/* 3. 최종 결과 */}
          {run.status === 'done' && <RunResultBox run={run} onCopy={onCopy} />}

          {/* 4. 저장된 실행 기록 상세 화면으로 (실행이 끝난 뒤, 새 탭) */}
          {run.status !== 'running' && run.runId !== undefined && (
            <Link to={`/monitoring/runs/${run.runId}`} target="_blank" rel="noreferrer" className="text-btn wf-run-link">
              <ExternalLink size={14} />
              실행 기록 보기 (#{run.runId})
            </Link>
          )}
          <div ref={endRef} />
        </div>
      )}

      {/* 5. 최근 실행 기록 (실행 중에는 숨김) */}
      {!running && (
        <section className="wf-run-recent">
          <div className="wf-run-recent-header">
            <strong>최근 실행 기록</strong>
            <button type="button" className="icon-btn" onClick={loadRecentRuns} aria-label="새로고침" title="새로고침">
              <RefreshCw size={14} />
            </button>
          </div>
          {recentError ? (
            <span className="chat-notice is-error">{recentError}</span>
          ) : recentRuns === null ? (
            <span className="text-muted">불러오는 중...</span>
          ) : recentRuns.length === 0 ? (
            <span className="text-muted">아직 실행한 기록이 없습니다.</span>
          ) : (
            <ul>
              {recentRuns.map((item) => {
                const meta = RUN_STATUS_META[item.status]
                return (
                  <li key={item.id}>
                    <Link to={`/monitoring/runs/${item.id}`} target="_blank" rel="noreferrer">
                      <span className={`pill pill-sm pill-${meta.tone}`}>{meta.label}</span>
                      <span className="wf-run-recent-time">{formatDateTime(item.started_at)}</span>
                      <span className="text-muted">{formatDuration(item.latency_ms)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
