import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'

import { createAgent, updateAgent } from '../../api/agents'
import { getErrorMessage } from '../../api/client'
import { getProviders } from '../../api/llm'
import type { Agent, AgentCreateRequest, AgentTool, LlmModel, LlmProviderType } from '../../api/types'
import Modal from '../../components/common/Modal'
import SelectBox, { type SelectOption } from '../../components/common/SelectBox'
import {
  DEFAULT_MAX_ITERATIONS,
  MAX_ITERATIONS_LIMIT,
  REASONING_OPTIONS,
  SYSTEM_PROMPT_PLACEHOLDER,
  type ReasoningChoice,
} from '../../constants/agent'
import { useToast } from '../../contexts/ToastContext'

interface AgentFormModalProps {
  agent: Agent | null // null이면 새로 등록, 값이 있으면 수정
  tools: AgentTool[] // 연결할 수 있는 도구 목록
  onClose: () => void
  onSaved: () => void
}

// 선택할 수 있는 모델 1개 (선택 상자 + 도구 지원 여부 확인용)
interface ModelChoice {
  model: LlmModel
  label: string // 예) "로컬 Ollama · qwen3.5:9b"
  providerType: LlmProviderType // 생각 과정 설정 적용 여부 판단용 
}

// 생성 옵션 입력값 검사 결과 (값 또는 에러 메시지)
type ParsedParams =
  | { ok: true; params: Pick<AgentCreateRequest, 'temperature' | 'max_tokens' | 'top_p' | 'max_iterations'> }
  | { ok: false; message: string }

//  * 생성 옵션 입력값 검사 (비어 있으면 null => 공급자 서버 기본값 사용)
//  - 범위는 백엔드 AgentCreateReq와 동일
function parseParams(temperature: string, maxTokens: string, topP: string, maxIterations: string): ParsedParams {
  let temperatureValue: number | null = null
  let maxTokensValue: number | null = null
  let topPValue: number | null = null
  if (temperature.trim()) {
    temperatureValue = Number(temperature)
    if (Number.isNaN(temperatureValue) || temperatureValue < 0 || temperatureValue > 2) {
      return { ok: false, message: 'Temperature는 0 ~ 2 사이 숫자여야 합니다.' }
    }
  }
  if (maxTokens.trim()) {
    maxTokensValue = Number(maxTokens)
    if (!Number.isInteger(maxTokensValue) || maxTokensValue < 1 || maxTokensValue > 32768) {
      return { ok: false, message: 'Max Tokens는 1 ~ 32768 사이 정수여야 합니다.' }
    }
  }
  if (topP.trim()) {
    topPValue = Number(topP)
    if (Number.isNaN(topPValue) || topPValue <= 0 || topPValue > 1) {
      return { ok: false, message: 'Top P는 0 초과 ~ 1 이하 숫자여야 합니다.' }
    }
  }
  const iterations = Number(maxIterations)
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS_LIMIT) {
    return { ok: false, message: `최대 반복 횟수는 1 ~ ${MAX_ITERATIONS_LIMIT} 사이 정수여야 합니다.` }
  }
  return {
    ok: true,
    params: { temperature: temperatureValue, max_tokens: maxTokensValue, top_p: topPValue, max_iterations: iterations },
  }
}

// 숫자 => 입력창 값 (null이면 빈 칸)
const toInputValue = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))

//  * 에이전트 등록/수정 팝업 (admin, manager)
//  - 모델 목록은 팝업을 열 때 LLM 공급자 목록에서 불러옴 ("사용" 상태인 공급자의 "사용" 상태인 모델)
//  - 도구 호출을 지원하지 않는 모델을 고르면 도구를 선택할 수 없음
export default function AgentFormModal({ agent, tools, onClose, onSaved }: AgentFormModalProps) {
  const { showToast } = useToast()
  const isEdit = agent !== null
  const formId = useId()

  // 1. 입력값 (수정이면 기존 값으로 시작)
  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  // 선택한 모델 번호 (select 값은 문자열 / 모델이 삭제된 에이전트는 '' => 다시 선택해야 함)
  const [modelId, setModelId] = useState(agent?.llm_model ? String(agent.llm_model.id) : '')
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? '')
  const [temperature, setTemperature] = useState(toInputValue(agent?.temperature))
  const [maxTokens, setMaxTokens] = useState(toInputValue(agent?.max_tokens))
  const [topP, setTopP] = useState(toInputValue(agent?.top_p))
  const [maxIterations, setMaxIterations] = useState(String(agent?.max_iterations ?? DEFAULT_MAX_ITERATIONS))
  const [toolNames, setToolNames] = useState<string[]>(agent?.tool_names ?? [])
  //  * 생각 과정 수준 입력값
  //  - 저장된 값이 없으면(null) 'default'(모델 기본값)로 시작
  const [reasoning, setReasoning] = useState<ReasoningChoice>(agent?.reasoning_effort ?? 'default')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 2. 선택할 수 있는 모델 목록 (null: 불러오는 중)
  const [modelChoices, setModelChoices] = useState<ModelChoice[] | null>(null)

  useEffect(() => {
    let ignore = false
    getProviders()
      .then((providers) => {
        if (ignore) {
          return
        }
        //  * "사용" 상태인 모델만 선택지로
        //  - 단, 수정 중인 에이전트가 지금 쓰는 모델은 "사용 안 함"이어도 목록에 남김
        //    (목록에서 빠지면 저장할 때 모르는 사이에 다른 모델로 바뀔 수 있기 때문)
        const choices: ModelChoice[] = []
        for (const provider of providers) {
          for (const model of provider.models) {
            const usable = provider.is_active && model.is_active
            if (usable || model.id === agent?.llm_model?.id) {
              choices.push({
                model,
                label: `${provider.name} · ${model.display_name}${usable ? '' : ' (사용 안 함)'}`,
                providerType: provider.provider_type, // 연결 방식 함께 저장
              })
            }
          }
        }
        setModelChoices(choices)
        // 새로 등록할 때는 첫 번째 모델을 미리 선택
        if (!agent && choices.length > 0) {
          setModelId((prev) => prev || String(choices[0].model.id))
        }
      })
      .catch((error) => {
        if (!ignore) {
          setModelChoices([])
          setErrorMessage(getErrorMessage(error))
        }
      })
    return () => {
      ignore = true
    }
  }, [agent])

  // 3. 선택한 모델 + 도구 호출 지원 여부
  // "생각 과정 출력" 모델 + OpenAI 호환 공급자(Ollama, vLLM)일 때만 생각 과정 선택 상자를 보여줌
  // (Bedrock은 아직 생각 과정 설정을 보내지 않음 - core/llm.py 의 ReasoningEffort 참고)
  const selectedChoice = modelChoices?.find((choice) => String(choice.model.id) === modelId)
  const selectedModel = selectedChoice?.model
  const toolsSupported = selectedModel?.supports_tools ?? false
  const reasoningApplicable =
    selectedChoice !== undefined &&
    selectedChoice.providerType === 'openai_compatible' &&
    selectedChoice.model.supports_reasoning

  // 선택 상자 선택지 (모델이 선택되지 않은 경우 안내 문구를 맨 위에)
  const modelOptions: SelectOption<string>[] = [
    ...(modelId ? [] : [{ value: '', label: '모델을 선택해 주세요', disabled: true }]),
    ...(modelChoices ?? []).map((choice) => ({ value: String(choice.model.id), label: choice.label })),
  ]

  const handleClose = () => {
    if (!submitting) {
      onClose()
    }
  }

  // 도구 체크박스 켜기/끄기
  const toggleTool = (toolName: string, checked: boolean) => {
    setToolNames((prev) => (checked ? [...prev, toolName] : prev.filter((item) => item !== toolName)))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)

    // 1. 입력값 검사
    if (!modelId) {
      setErrorMessage('에이전트가 사용할 LLM 모델을 선택해 주세요.')
      return
    }
    const parsed = parseParams(temperature, maxTokens, topP, maxIterations)
    if (!parsed.ok) {
      setErrorMessage(parsed.message)
      return
    }

    // 2. 보낼 값 만들기 (도구를 지원하지 않는 모델이면 도구는 빈 목록으로)
    const data: AgentCreateRequest = {
      name: name.trim(),
      description: description.trim() || null,
      llm_model_id: Number(modelId),
      system_prompt: systemPrompt.trim(),
      tool_names: toolsSupported ? toolNames : [],
      // 생각 과정 수준 ('default' 이거나 적용되지 않는 모델이면 null = 모델 기본값) 
      reasoning_effort: reasoningApplicable && reasoning !== 'default' ? reasoning : null,
      ...parsed.params,
    }

    // 3. 저장 (수정은 모든 값을 보내서 한 번에 바꿈 - 비운 옵션은 null로 보내 기본값으로 되돌림)
    setSubmitting(true)
    try {
      if (isEdit) {
        await updateAgent(agent.id, data)
        showToast(`'${data.name}' 에이전트를 수정했습니다.`)
      } else {
        await createAgent(data)
        showToast(`'${data.name}' 에이전트를 등록했습니다.`)
      }
      onSaved()
      onClose()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={isEdit ? '에이전트 수정' : '에이전트 만들기'}
      onClose={handleClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={handleClose}>
            취소
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={submitting || modelChoices === null}
          >
            {submitting && <LoaderCircle size={18} className="spin" />}
            {isEdit ? '저장' : '만들기'}
          </button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">이름</span>
          <input
            className="input"
            placeholder="예) 사내 계산 도우미"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field-label">설명 (선택)</span>
          <input
            className="input"
            placeholder="예) 견적, 단가 계산을 도와주는 에이전트"
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className="field">
          <span className="field-label">LLM 모델</span>
          {modelChoices === null ? (
            <span className="field-hint">모델 목록을 불러오는 중...</span>
          ) : modelChoices.length === 0 ? (
            <span className="field-hint">
              사용할 수 있는 모델이 없습니다. 설정 &gt; LLM 모델 관리에서 먼저 모델을 등록해 주세요.
            </span>
          ) : (
            <SelectBox
              value={modelId}
              options={modelOptions}
              onChange={setModelId}
              ariaLabel="LLM 모델 선택"
              className="select-block"
            />
          )}
          {isEdit && !agent.llm_model && (
            <span className="field-hint is-warning">연결된 모델이 삭제되었습니다. 모델을 다시 선택해 주세요.</span>
          )}
        </div>

        <label className="field">
          <span className="field-label">시스템 프롬프트</span>
          <textarea
            className="input textarea"
            rows={6}
            placeholder={SYSTEM_PROMPT_PLACEHOLDER}
            maxLength={20000}
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
          <span className="field-hint">에이전트의 역할, 말투, 지켜야 할 규칙을 적습니다.</span>
        </label>

        {/* 생각 과정 수준 선택
            "생각 과정 출력" + OpenAI 호환 모델일 때만 선택 상자를 보여줌 */}
        {reasoningApplicable && (
          <div className="field">
            <span className="field-label">생각 과정</span>
            <SelectBox
              value={reasoning}
              options={REASONING_OPTIONS}
              onChange={setReasoning}
              ariaLabel="생각 과정 수준 선택"
              className="select-block"
            />
            <span className="field-hint">
              단순한 일(계산, 조회 등)은 '끄기'를 고르면 답변이 훨씬 빨라집니다. 여러 단계로 판단해야 하는 일은
              생각을 켜야 정확합니다. (gpt-oss는 완전히 꺼지지 않고 짧게 생각합니다)
            </span>
          </div>
        )}

        <div className="field">
          <span className="field-label">도구</span>
          <div className="tool-check-list">
            {tools.map((tool) => (
              <label key={tool.name} className={toolsSupported ? 'checkbox' : 'checkbox is-disabled'}>
                <input
                  type="checkbox"
                  checked={toolsSupported && toolNames.includes(tool.name)}
                  onChange={(event) => toggleTool(tool.name, event.target.checked)}
                  disabled={!toolsSupported}
                />
                <span>
                  <strong>{tool.label}</strong>
                  <span className="tool-check-desc">{tool.description}</span>
                </span>
              </label>
            ))}
          </div>
          <span className="field-hint">
            {selectedModel && !toolsSupported
              ? '선택한 모델은 도구 호출을 지원하지 않아 도구를 연결할 수 없습니다.'
              : '모델이 질문을 보고 필요한 도구를 스스로 골라 사용합니다. 외부 도구는 MCP 연동 후 추가됩니다.'}
          </span>
        </div>

        <div className="param-grid param-grid-4">
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
          <label className="field">
            <span className="field-label">최대 반복</span>
            <input
              className="input"
              type="number"
              step="1"
              min="1"
              max={MAX_ITERATIONS_LIMIT}
              value={maxIterations}
              onChange={(event) => setMaxIterations(event.target.value)}
              required
            />
          </label>
        </div>
        <span className="field-hint">
          비워두면 모델 서버의 기본값을 사용합니다. 최대 반복은 "도구 실행 후 다시 생각하기"를 몇 번까지 허용할지
          정합니다. (1 ~ {MAX_ITERATIONS_LIMIT})
        </span>

        {errorMessage && (
          <div className="form-error" role="alert">
            <CircleAlert size={16} />
            <span>{errorMessage}</span>
          </div>
        )}
      </form>
    </Modal>
  )
}
