// [수정] * 생각 과정/도구 실행/답변 표시 부분을 공용 부품으로 옮김 [2026-11-10 16:55]
// [기존] RunPart 타입, applyEvent, ToolStep, toSeconds 와 조각 표시 코드가 이 파일 안에 있었습니다.
// [변경] components/agent/RunParts.tsx 로 옮기고 여기서는 가져다 씁니다.
//        (워크플로우 실행 패널에서도 같은 모양으로 보여주기 위함 - 화면 동작은 그대로)

import { ArrowLeft, CircleAlert, LoaderCircle, RotateCcw, Send, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import { getAgent, getAgentTools, streamAgentRun } from '../../api/agents'
import { getErrorMessage } from '../../api/client'
import type { Agent, AgentRunRequest, AgentTool } from '../../api/types'
import { applyRunEvent, RunPartList, toSeconds, type RunPart } from '../../components/agent/RunParts'
import PageHeader from '../../components/common/PageHeader'
import { REASONING_LABEL } from '../../constants/agent'
import { AgentModelLabel } from './AgentsPage'

//  * 에이전트 테스트 실행 화면 (/agents/:agentId)
//  - 왼쪽: 에이전트 정보 (모델, 도구, 시스템 프롬프트, 옵션)
//  - 오른쪽: 대화창 - 생각 과정, 도구 실행(입력값/결과), 답변을 진행되는 순서대로 보여줌
//  - 대화 내용은 저장하지 않음 (새로고침하면 사라짐)
//  - 생각 과정, 도구 실행, 답변 표시는 components/agent/RunParts.tsx 참고

// 대화 1건 (사용자 질문 또는 에이전트 답변)
interface RunTurn {
  id: number
  role: 'user' | 'assistant'
  text: string // 사용자 질문 (에이전트 답변은 parts 사용)
  parts: RunPart[]
  stats?: {
    inputTokens: number
    outputTokens: number
    finishReason: string | null
    steps: number
    latencyMs: number
    firstTokenMs: number | null
  }
  error?: string
  stopped?: boolean
}

// 에이전트 답변의 "답변 글"만 이어 붙이기 (다음 질문 때 대화 기록으로 보냄)
const answerText = (turn: RunTurn) =>
  turn.parts
    .filter((part) => part.kind === 'content')
    .map((part) => part.text)
    .join('\n')
    .trim()

// 에이전트를 실행할 수 없는 이유 (실행할 수 있으면 null)
function blockedReason(agent: Agent): string | null {
  if (!agent.is_active) {
    return "'사용 안 함' 상태인 에이전트입니다. 에이전트 목록에서 '사용'으로 바꿔야 실행할 수 있습니다."
  }
  if (!agent.llm_model) {
    return '연결된 LLM 모델이 삭제되었습니다. 에이전트 설정에서 모델을 다시 선택해 주세요.'
  }
  if (!agent.llm_model.is_usable) {
    return "연결된 LLM 모델(또는 공급자)이 '사용 안 함' 상태입니다. LLM 모델 관리에서 확인해 주세요."
  }
  return null
}

export default function AgentRunPage() {
  // 1. 주소의 에이전트 번호 (예: /agents/3 => "3")
  const { agentId } = useParams()
  const numericId = Number(agentId)
  const invalidId = !Number.isInteger(numericId) || numericId < 1 // 예) /agents/abc

  // 2. 에이전트 정보 + 도구 목록
  const [agent, setAgent] = useState<Agent | null>(null)
  const [tools, setTools] = useState<AgentTool[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // 3. 대화 상태
  const [turns, setTurns] = useState<RunTurn[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null) // 중지 버튼용
  const nextIdRef = useRef(1) // 대화마다 겹치지 않는 번호
  const messagesRef = useRef<HTMLDivElement>(null) // 대화창 (자동 스크롤용)

  // 에이전트 정보 + 도구 목록 불러오기
  useEffect(() => {
    let ignore = false
    if (invalidId) {
      return
    }
    Promise.all([getAgent(numericId), getAgentTools()])
      .then(([agentData, toolList]) => {
        if (!ignore) {
          setAgent(agentData)
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

  // 새 글자가 올 때마다 대화창을 맨 아래로 스크롤
  useEffect(() => {
    const container = messagesRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [turns])

  // 화면을 벗어나면 진행 중인 실행을 중단
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // 도구 이름 => 화면 이름
  const toolLabel = (toolName: string) => tools.find((tool) => tool.name === toolName)?.label ?? toolName

  const blocked = agent ? blockedReason(agent) : null

  // 4. 메시지 보내기
  const handleSend = async () => {
    const text = input.trim()
    if (!agent || !text || streaming || blocked) {
      return
    }

    // 4-1. 화면에 "내 질문" + "빈 답변(받는 중)" 추가
    const userTurn: RunTurn = { id: nextIdRef.current++, role: 'user', text, parts: [] }
    const assistantId = nextIdRef.current++
    const history = [...turns, userTurn]
    setTurns([...history, { id: assistantId, role: 'assistant', text: '', parts: [] }])
    setInput('')

    // 4-2. 보낼 대화 기록 만들기 (오류가 났거나 답변 글이 없는 답변은 빼고 보냄)
    //  - 이전 답변의 도구 실행 내용은 보내지 않고, 최종 답변 글만 보냄
    const messages: AgentRunRequest['messages'] = []
    for (const turn of history) {
      if (turn.role === 'user') {
        messages.push({ role: 'user', content: turn.text })
        continue
      }
      const answer = answerText(turn)
      if (!turn.error && answer) {
        messages.push({ role: 'assistant', content: answer })
      }
    }

    // 4-3. 이 답변(assistantId)만 골라서 바꾸는 함수
    const updateAssistant = (update: (turn: RunTurn) => RunTurn) => {
      setTurns((prev) => prev.map((turn) => (turn.id === assistantId ? update(turn) : turn)))
    }

    // 4-4. 스트리밍으로 실행 결과 받기
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    try {
      await streamAgentRun(
        agent.id,
        { messages },
        (event) => {
          if (event.type === 'done') {
            updateAssistant((turn) => ({
              ...turn,
              stats: {
                inputTokens: event.input_tokens,
                outputTokens: event.output_tokens,
                finishReason: event.finish_reason,
                steps: event.steps,
                latencyMs: event.latency_ms,
                firstTokenMs: event.first_token_ms,
              },
            }))
          } else if (event.type === 'error') {
            updateAssistant((turn) => ({ ...turn, error: event.message }))
          } else {
            updateAssistant((turn) => ({ ...turn, parts: applyRunEvent(turn.parts, event) }))
          }
        },
        controller.signal,
      )
    } catch (error) {
      if (controller.signal.aborted) {
        updateAssistant((turn) => ({ ...turn, stopped: true }))
      } else {
        updateAssistant((turn) => ({ ...turn, error: getErrorMessage(error) }))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  // Enter: 보내기 / Shift+Enter: 줄바꿈 (한글 조합 중에는 무시 - ChatPlayground.tsx 설명 참고)
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  const backButton = (
    <Link to="/agents" className="btn btn-outline">
      <ArrowLeft size={16} />
      에이전트 목록
    </Link>
  )

  // 잘못된 주소 / 불러오기 실패 / 불러오는 중
  if (invalidId || loadError || !agent) {
    const errorText = invalidId ? '잘못된 에이전트 주소입니다.' : loadError
    return (
      <div className="page">
        <PageHeader title="에이전트 테스트 실행" actions={backButton} />
        <section className={errorText ? 'card empty-state is-error' : 'card empty-state'}>
          {errorText ?? '불러오는 중...'}
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader title={agent.name} description={agent.description ?? undefined} actions={backButton} />

      <div className="chat-layout">
        {/* 왼쪽: 에이전트 정보 */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">에이전트 정보</h2>
          </div>
          <div className="card-body form-stack">
            <dl className="agent-meta agent-meta-plain">
              <div>
                <dt>모델</dt>
                <dd>
                  <AgentModelLabel agent={agent} />
                </dd>
              </div>
              <div>
                <dt>도구</dt>
                <dd>
                  {agent.tool_names.length > 0 ? (
                    <div className="tool-pills">
                      {agent.tool_names.map((toolName) => (
                        <span key={toolName} className="pill pill-sm pill-blue">
                          {toolLabel(toolName)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted">없음</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>최대 반복</dt>
                <dd>{agent.max_iterations}회</dd>
              </div>
              {/* 생각 과정 수준 표시 - 설정한 값(없으면 모델 기본값)을 보여줌 */}
              <div>
                <dt>생각 과정</dt>
                <dd>{agent.reasoning_effort ? REASONING_LABEL[agent.reasoning_effort] : '모델 기본값'}</dd>
              </div>
              <div>
                <dt>옵션</dt>
                <dd className="agent-params">
                  Temperature {agent.temperature ?? '기본값'} · Max Tokens {agent.max_tokens ?? '기본값'} · Top P{' '}
                  {agent.top_p ?? '기본값'}
                </dd>
              </div>
            </dl>

            <div className="field">
              <span className="field-label">시스템 프롬프트</span>
              {agent.system_prompt ? (
                <div className="prompt-preview">{agent.system_prompt}</div>
              ) : (
                <span className="text-muted">없음</span>
              )}
            </div>

            {blocked && (
              <div className="form-error" role="alert">
                <CircleAlert size={16} />
                <span>{blocked}</span>
              </div>
            )}
          </div>
        </section>

        {/* 오른쪽: 대화창 */}
        <section className="card chat-panel">
          <div className="card-header">
            <h2 className="card-title">테스트 실행</h2>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setTurns([])}
              disabled={streaming || turns.length === 0}
            >
              <RotateCcw size={16} />새 대화
            </button>
          </div>

          <div className="chat-messages" ref={messagesRef}>
            {turns.length === 0 ? (
              <div className="chat-empty">
                질문을 보내 에이전트가 도구를 어떻게 사용하는지 확인해 보세요.
                {agent.tool_names.length > 0 && (
                  <>
                    <br />
                    예) "1250원짜리 12개를 7명이 나누면 1인당 얼마야?", "오늘 무슨 요일이야?"
                  </>
                )}
              </div>
            ) : (
              turns.map((turn) =>
                turn.role === 'user' ? (
                  <div key={turn.id} className="chat-turn is-user">
                    <div className="chat-bubble">{turn.text}</div>
                  </div>
                ) : (
                  <AgentTurn
                    key={turn.id}
                    turn={turn}
                    toolLabel={toolLabel}
                    maxIterations={agent.max_iterations}
                  />
                ),
              )
            )}
          </div>

          <div className="chat-input-area">
            <textarea
              className="input textarea chat-input"
              rows={2}
              placeholder={blocked ? '지금은 실행할 수 없습니다.' : '메시지를 입력하세요. (Enter: 보내기, Shift+Enter: 줄바꿈)'}
              maxLength={20000}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={Boolean(blocked)}
              aria-label="메시지 입력"
            />
            {streaming ? (
              <button type="button" className="btn btn-outline" onClick={() => abortRef.current?.abort()}>
                <Square size={16} />
                중지
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSend}
                disabled={!input.trim() || Boolean(blocked)}
              >
                <Send size={16} />
                보내기
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

//  * 에이전트 답변 1건 - 조각(생각 과정, 도구 실행, 답변)을 도착한 순서대로 표시
interface AgentTurnProps {
  turn: RunTurn
  toolLabel: (toolName: string) => string
  maxIterations: number
}

function AgentTurn({ turn, toolLabel, maxIterations }: AgentTurnProps) {
  const finished = Boolean(turn.stats || turn.error || turn.stopped)
  const lastPart = turn.parts[turn.parts.length - 1]
  // 아직 아무것도 안 왔거나, 도구 실행이 끝나고 다음 생각을 기다리는 중
  const waiting = !finished && (!lastPart || (lastPart.kind === 'tool' && lastPart.result !== undefined))

  return (
    <div className="chat-turn is-assistant">
      <RunPartList parts={turn.parts} finished={finished} toolLabel={toolLabel} />

      {waiting && (
        <div className="chat-waiting">
          <LoaderCircle size={16} className="spin" />
          {lastPart ? '도구 결과를 보고 생각하는 중...' : '답변을 기다리는 중... (모델을 처음 불러올 때는 시간이 걸릴 수 있습니다)'}
        </div>
      )}

      {turn.error && (
        <div className="chat-notice is-error">
          <CircleAlert size={14} />
          {turn.error}
        </div>
      )}
      {turn.stopped && <div className="chat-notice">실행을 중지했습니다.</div>}
      {turn.stats?.finishReason === 'length' && (
        <div className="chat-notice is-warning">
          <TriangleAlert size={14} />
          최대 토큰 수(Max Tokens)에 도달해 답변이 잘렸습니다.
        </div>
      )}
      {turn.stats?.finishReason === 'max_iterations' && (
        <div className="chat-notice is-warning">
          <TriangleAlert size={14} />
          최대 반복 횟수({maxIterations}회)에 도달해 최종 답변 전에 멈췄습니다. 에이전트 설정에서 늘릴 수 있습니다.
        </div>
      )}
      {turn.stats && (
        <div className="chat-stats">
          LLM 호출 {turn.stats.steps}회 · 토큰 입력 {turn.stats.inputTokens.toLocaleString()} · 출력{' '}
          {turn.stats.outputTokens.toLocaleString()}
          {turn.stats.firstTokenMs !== null && ` · 첫 응답 ${toSeconds(turn.stats.firstTokenMs)}`}
          {` · 전체 ${toSeconds(turn.stats.latencyMs)}`}
        </div>
      )}
    </div>
  )
}
