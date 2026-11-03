import { CircleAlert, LoaderCircle, RotateCcw, Send, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { getErrorMessage } from '../../api/client'
import { streamChat } from '../../api/llm'
import type { ChatRequest, LlmProvider } from '../../api/types'
import SelectBox, { type SelectOption } from '../../components/common/SelectBox'

//  * 테스트 대화 화면
//  - 왼쪽: 모델 선택 + 시스템 프롬프트 + 생성 옵션(temperature 등)
//  - 오른쪽: 대화창 (답변이 만들어지는 대로 글자가 실시간으로 나타남)
//  - 대화 내용은 저장하지 않음 (연결 확인용 / 새로고침하면 사라짐)
//  - 모델은 대화를 기억하지 못하므로, 보낼 때마다 지금까지의 대화 전체를 함께 보냄
//  - 답변은 글자 그대로 표시함 (HTML로 해석하지 않으므로 답변 안의 코드가 실행될 위험이 없음)

// 대화 1건 (사용자 질문 또는 모델 답변)
interface ChatTurn {
  id: number
  role: 'user' | 'assistant'
  content: string // 답변(또는 질문) 내용
  reasoning: string // 생각 과정 (모델 답변만)
  stats?: {
    inputTokens: number
    outputTokens: number
    finishReason: string | null
    latencyMs: number
    firstTokenMs: number | null
  }
  error?: string // 오류 메시지
  stopped?: boolean // 사용자가 중지 버튼을 눌렀는지
}

// 생성 옵션 입력값 검사 결과 (값 또는 에러 메시지)
type ParsedParams = { ok: true; params: Partial<ChatRequest> } | { ok: false; message: string }

//  * 생성 옵션 입력값 검사 (비어 있으면 보내지 않음 => 공급자 서버 기본값 사용)
//  - 범위는 백엔드 ChatReq와 동일 (temperature 0~2 / max_tokens 1~32768 / top_p 0 초과~1)
function parseParams(temperature: string, maxTokens: string, topP: string): ParsedParams {
  const params: Partial<ChatRequest> = {}
  if (temperature.trim()) {
    const value = Number(temperature)
    if (Number.isNaN(value) || value < 0 || value > 2) {
      return { ok: false, message: 'Temperature는 0 ~ 2 사이 숫자여야 합니다.' }
    }
    params.temperature = value
  }
  if (maxTokens.trim()) {
    const value = Number(maxTokens)
    if (!Number.isInteger(value) || value < 1 || value > 32768) {
      return { ok: false, message: 'Max Tokens는 1 ~ 32768 사이 정수여야 합니다.' }
    }
    params.max_tokens = value
  }
  if (topP.trim()) {
    const value = Number(topP)
    if (Number.isNaN(value) || value <= 0 || value > 1) {
      return { ok: false, message: 'Top P는 0 초과 ~ 1 이하 숫자여야 합니다.' }
    }
    params.top_p = value
  }
  return { ok: true, params }
}

// 밀리초 => "1.23초"
const toSeconds = (ms: number) => `${(ms / 1000).toFixed(2)}초`

export default function ChatPlayground({ providers }: { providers: LlmProvider[] }) {
  // 1. 선택할 수 있는 모델 목록 ("사용" 상태인 공급자의 "사용" 상태인 모델만)
  //  - value는 모델 번호(id)를 문자열로 (select 값은 항상 문자열이기 때문)
  const modelOptions: SelectOption<string>[] = providers
    .filter((provider) => provider.is_active)
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.is_active)
        .map((model) => ({ value: String(model.id), label: `${provider.name} · ${model.display_name}` })),
    )

  // 2. 입력값
  const [selectedModelId, setSelectedModelId] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [topP, setTopP] = useState('')
  const [input, setInput] = useState('')

  // 3. 대화 상태
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [streaming, setStreaming] = useState(false) // 답변 받는 중
  const [formError, setFormError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null) // 중지 버튼용
  const nextIdRef = useRef(1) // 대화마다 겹치지 않는 번호
  const messagesRef = useRef<HTMLDivElement>(null) // 대화창 (자동 스크롤용)

  //  * 실제로 사용할 모델 번호
  //  - 선택한 모델이 목록에 없으면(처음 열었거나, 비활성화된 경우) 첫 번째 모델 사용
  const activeModelId = modelOptions.some((option) => option.value === selectedModelId)
    ? selectedModelId
    : (modelOptions[0]?.value ?? '')

  // 4. 새 글자가 올 때마다 대화창을 맨 아래로 스크롤
  useEffect(() => {
    const container = messagesRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [turns])

  // 5. 화면을 벗어나면(다른 탭/메뉴로 이동) 진행 중인 답변 요청을 중단
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // 6. 메시지 보내기
  const handleSend = async () => {
    const text = input.trim()
    if (!text || streaming || !activeModelId) {
      return
    }
    // 6-1. 생성 옵션 검사
    const parsed = parseParams(temperature, maxTokens, topP)
    if (!parsed.ok) {
      setFormError(parsed.message)
      return
    }
    setFormError(null)

    // 6-2. 화면에 "내 질문" + "빈 답변(받는 중)" 추가
    const userTurn: ChatTurn = { id: nextIdRef.current++, role: 'user', content: text, reasoning: '' }
    const assistantId = nextIdRef.current++
    const history = [...turns, userTurn]
    setTurns([...history, { id: assistantId, role: 'assistant', content: '', reasoning: '' }])
    setInput('')

    // 6-3. 보낼 메시지 만들기 (시스템 프롬프트 + 지금까지의 대화)
    //  - 오류가 났거나 내용이 비어 있는 답변은 빼고 보냄
    const messages: ChatRequest['messages'] = []
    if (systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() })
    }
    for (const turn of history) {
      if (turn.error || !turn.content.trim()) {
        continue
      }
      messages.push({ role: turn.role, content: turn.content })
    }

    // 6-4. 이 답변(assistantId)만 골라서 바꾸는 함수
    const updateAssistant = (update: (turn: ChatTurn) => ChatTurn) => {
      setTurns((prev) => prev.map((turn) => (turn.id === assistantId ? update(turn) : turn)))
    }

    // 6-5. 스트리밍으로 답변 받기
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    try {
      await streamChat(
        { llm_model_id: Number(activeModelId), messages, ...parsed.params },
        (event) => {
          if (event.type === 'reasoning') {
            updateAssistant((turn) => ({ ...turn, reasoning: turn.reasoning + event.text }))
          } else if (event.type === 'content') {
            updateAssistant((turn) => ({ ...turn, content: turn.content + event.text }))
          } else if (event.type === 'done') {
            updateAssistant((turn) => ({
              ...turn,
              stats: {
                inputTokens: event.input_tokens,
                outputTokens: event.output_tokens,
                finishReason: event.finish_reason,
                latencyMs: event.latency_ms,
                firstTokenMs: event.first_token_ms,
              },
            }))
          } else if (event.type === 'error') {
            updateAssistant((turn) => ({ ...turn, error: event.message }))
          }
          // tool_call: 테스트 대화에서는 도구를 보내지 않으므로 오지 않음 (에이전트 단계에서 사용)
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

  // 7. Enter: 보내기 / Shift+Enter: 줄바꿈
  //  - isComposing: 한글 입력 중(글자 조합 중)에는 Enter를 무시 (마지막 글자가 두 번 보내지는 문제 방지)
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  // 8. 새 대화 (대화 내용 지우기)
  const handleReset = () => {
    setTurns([])
    setFormError(null)
  }

  return (
    <div className="chat-layout">
      {/* 왼쪽: 설정 */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">대화 설정</h2>
        </div>
        <div className="card-body form-stack">
          <div className="field">
            <span className="field-label">모델</span>
            {modelOptions.length > 0 ? (
              <SelectBox
                value={activeModelId}
                options={modelOptions}
                onChange={setSelectedModelId}
                ariaLabel="모델 선택"
                className="select-block"
              />
            ) : (
              <span className="field-hint">
                사용할 수 있는 모델이 없습니다. '공급자·모델' 탭에서 먼저 등록해 주세요.
              </span>
            )}
          </div>

          <label className="field">
            <span className="field-label">시스템 프롬프트 (선택)</span>
            <textarea
              className="input textarea"
              rows={4}
              placeholder="예) 당신은 친절한 사내 AI 어시스턴트입니다. 항상 한국어로 답하세요."
              maxLength={20000}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </label>

          <div className="param-grid">
            <label className="field">
              <span className="field-label">Temperature</span>
              <input
                className="input"
                type="number"
                step="0.1"
                min="0"
                max="2"
                placeholder="기본값"
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Max Tokens</span>
              <input
                className="input"
                type="number"
                step="1"
                min="1"
                max="32768"
                placeholder="기본값"
                value={maxTokens}
                onChange={(event) => setMaxTokens(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Top P</span>
              <input
                className="input"
                type="number"
                step="0.05"
                min="0"
                max="1"
                placeholder="기본값"
                value={topP}
                onChange={(event) => setTopP(event.target.value)}
              />
            </label>
          </div>
          <span className="field-hint">
            비워두면 모델 서버의 기본값을 사용합니다. 생각 과정을 출력하는 모델은 Max Tokens를 너무
            작게 하면 답변 전에 잘릴 수 있습니다.
          </span>

          {formError && (
            <div className="form-error" role="alert">
              <CircleAlert size={16} />
              <span>{formError}</span>
            </div>
          )}
        </div>
      </section>

      {/* 오른쪽: 대화창 */}
      <section className="card chat-panel">
        <div className="card-header">
          <h2 className="card-title">대화</h2>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleReset}
            disabled={streaming || turns.length === 0}
          >
            <RotateCcw size={16} />새 대화
          </button>
        </div>

        <div className="chat-messages" ref={messagesRef}>
          {turns.length === 0 ? (
            <div className="chat-empty">
              모델을 선택하고 메시지를 보내 연결 상태를 확인해 보세요.
            </div>
          ) : (
            turns.map((turn) =>
              turn.role === 'user' ? (
                <div key={turn.id} className="chat-turn is-user">
                  <div className="chat-bubble">{turn.content}</div>
                </div>
              ) : (
                <AssistantTurn key={turn.id} turn={turn} />
              ),
            )
          )}
        </div>

        <div className="chat-input-area">
          <textarea
            className="input textarea chat-input"
            rows={2}
            placeholder={
              activeModelId ? '메시지를 입력하세요. (Enter: 보내기, Shift+Enter: 줄바꿈)' : '먼저 모델을 등록해 주세요.'
            }
            maxLength={20000}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!activeModelId}
            aria-label="메시지 입력"
          />
          {streaming ? (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => abortRef.current?.abort()}
            >
              <Square size={16} />
              중지
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSend}
              disabled={!input.trim() || !activeModelId}
            >
              <Send size={16} />
              보내기
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

//  * 모델 답변 1건
//  - 생각 과정: 접었다 펼 수 있는 상자 (생각하는 동안은 펼쳐져 있다가 답변이 시작되면 자동으로 접힘)
//  - 답변 아래: 토큰 사용량, 첫 응답 시간, 전체 시간
function AssistantTurn({ turn }: { turn: ChatTurn }) {
  const finished = Boolean(turn.stats || turn.error || turn.stopped)
  const thinking = !finished && !turn.content && Boolean(turn.reasoning) // 생각 과정을 받는 중
  const waiting = !finished && !turn.content && !turn.reasoning // 아직 아무 글자도 안 옴

  return (
    <div className="chat-turn is-assistant">
      {turn.reasoning && (
        // open={true}: 펼침 / undefined: React가 open 속성을 지움 => 접힘 (이후에는 직접 열고 닫을 수 있음)
        <details className="reasoning" open={thinking ? true : undefined}>
          <summary>
            {thinking ? '생각하는 중...' : `생각 과정 보기 (${turn.reasoning.length.toLocaleString()}자)`}
          </summary>
          <div className="reasoning-body">{turn.reasoning}</div>
        </details>
      )}

      {waiting && (
        <div className="chat-waiting">
          <LoaderCircle size={16} className="spin" />
          답변을 기다리는 중... (모델을 처음 불러올 때는 시간이 걸릴 수 있습니다)
        </div>
      )}

      {turn.content && <div className="chat-bubble">{turn.content}</div>}

      {turn.error && (
        <div className="chat-notice is-error">
          <CircleAlert size={14} />
          {turn.error}
        </div>
      )}
      {turn.stopped && <div className="chat-notice">답변을 중지했습니다.</div>}
      {turn.stats?.finishReason === 'length' && (
        <div className="chat-notice is-warning">
          <TriangleAlert size={14} />
          최대 토큰 수(Max Tokens)에 도달해 답변이 잘렸습니다.
        </div>
      )}
      {turn.stats && (
        <div className="chat-stats">
          토큰 입력 {turn.stats.inputTokens.toLocaleString()} · 출력{' '}
          {turn.stats.outputTokens.toLocaleString()}
          {turn.stats.firstTokenMs !== null && ` · 첫 응답 ${toSeconds(turn.stats.firstTokenMs)}`}
          {` · 전체 ${toSeconds(turn.stats.latencyMs)}`}
        </div>
      )}
    </div>
  )
}
