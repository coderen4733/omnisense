import { CircleAlert, Download, LoaderCircle } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { getErrorMessage } from '../../api/client'
import { createModel, getAvailableModels, updateModel } from '../../api/llm'
import type { LlmModel, LlmProvider } from '../../api/types'
import Modal from '../../components/common/Modal'
import { MODEL_ID_PLACEHOLDER } from '../../constants/llm'
import { useToast } from '../../contexts/ToastContext'

interface ModelFormModalProps {
  provider: LlmProvider // 모델이 속한 공급자
  model: LlmModel | null // null이면 새로 등록, 값이 있으면 수정
  onClose: () => void
  onSaved: () => void
}

//  * LLM 모델 등록/수정 팝업 (admin 전용)
//  - "서버에서 불러오기": 공급자 서버(Ollama 등)에 설치된 모델 이름을 불러와서 클릭으로 입력
//  - 모델 ID는 등록 후 바꿀 수 없음 (다른 모델을 쓰려면 새로 등록)
export default function ModelFormModal({ provider, model, onClose, onSaved }: ModelFormModalProps) {
  const { showToast } = useToast()
  const isEdit = model !== null
  const formId = useId()

  // 입력값 (수정이면 기존 값으로 시작)
  const [modelId, setModelId] = useState(model?.model_id ?? '')
  const [displayName, setDisplayName] = useState(model?.display_name ?? '')
  const [supportsTools, setSupportsTools] = useState(model?.supports_tools ?? false)
  const [supportsReasoning, setSupportsReasoning] = useState(model?.supports_reasoning ?? false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 서버에서 불러온 모델 이름 목록 (null: 아직 불러오지 않음)
  const [available, setAvailable] = useState<string[] | null>(null)
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  // 이 공급자에 이미 등록된 모델 ID (불러온 목록에서 "등록됨" 표시용)
  //  - Set: 중복 없는 값 모음 (has()로 포함 여부를 빠르게 확인)
  const registeredIds = new Set(provider.models.map((item) => item.model_id))

  const handleClose = () => {
    if (!submitting) {
      onClose()
    }
  }

  // 공급자 서버에 설치된 모델 이름 불러오기
  const handleLoadAvailable = async () => {
    setLoadingAvailable(true)
    setErrorMessage(null)
    try {
      setAvailable(await getAvailableModels(provider.id))
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setLoadingAvailable(false)
    }
  }

  // 불러온 모델 이름 클릭 => 모델 ID 입력 (표시 이름이 비어 있으면 같은 값으로 채움)
  const handlePick = (pickedId: string) => {
    setModelId(pickedId)
    if (!displayName.trim()) {
      setDisplayName(pickedId)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)
    setSubmitting(true)
    try {
      if (isEdit) {
        await updateModel(model.id, {
          display_name: displayName.trim(),
          supports_tools: supportsTools,
          supports_reasoning: supportsReasoning,
        })
        showToast(`'${displayName.trim()}' 모델을 수정했습니다.`)
      } else {
        await createModel(provider.id, {
          model_id: modelId.trim(),
          display_name: displayName.trim(),
          supports_tools: supportsTools,
          supports_reasoning: supportsReasoning,
        })
        showToast(`'${displayName.trim()}' 모델을 등록했습니다.`)
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
      title={isEdit ? 'LLM 모델 수정' : `LLM 모델 추가 · ${provider.name}`}
      onClose={handleClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={handleClose}>
            취소
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={submitting}>
            {submitting && <LoaderCircle size={18} className="spin" />}
            {isEdit ? '저장' : '등록'}
          </button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={handleSubmit}>
        <div className="field">
          <span className="field-label">모델 ID</span>
          {isEdit ? (
            <code className="code field-static">{modelId}</code>
          ) : (
            <>
              <div className="input-row">
                <input
                  className="input"
                  placeholder={MODEL_ID_PLACEHOLDER[provider.provider_type]}
                  maxLength={200}
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  required
                  autoFocus
                  aria-label="모델 ID"
                />
                {provider.provider_type === 'openai_compatible' && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleLoadAvailable}
                    disabled={loadingAvailable}
                  >
                    {loadingAvailable ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Download size={16} />
                    )}
                    서버에서 불러오기
                  </button>
                )}
              </div>
              {/* 연결 방식별 모델 ID 안내
                  Bedrock은 교차 리전 추론 ID를 직접 입력하도록 안내 (불러오기 미지원) */}
              <span className="field-hint">
                {provider.provider_type === 'bedrock'
                  ? 'Bedrock 콘솔의 모델 카드에 있는 추론 ID를 입력합니다. 서울 리전은 global. 으로 시작하는 ID를 사용합니다.'
                  : '공급자 서버에서 사용하는 모델 이름 그대로 입력합니다.'}
              </span>
            </>
          )}

          {/* 불러온 모델 목록: 클릭하면 모델 ID에 입력됨 (이미 등록된 모델은 선택 불가) */}
          {available && (
            <div className="chip-list">
              {available.length === 0 && <span className="text-muted">설치된 모델이 없습니다.</span>}
              {available.map((id) => {
                const registered = registeredIds.has(id)
                return (
                  <button
                    key={id}
                    type="button"
                    className={id === modelId ? 'chip is-selected' : 'chip'}
                    onClick={() => handlePick(id)}
                    disabled={registered}
                    title={registered ? '이미 등록된 모델입니다.' : undefined}
                  >
                    {id}
                    {registered && ' (등록됨)'}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <label className="field">
          <span className="field-label">표시 이름</span>
          <input
            className="input"
            placeholder="예) Qwen 3.5 9B"
            maxLength={100}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>

        <div className="field">
          <span className="field-label">모델 기능</span>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={supportsTools}
              onChange={(event) => setSupportsTools(event.target.checked)}
            />
            <span>도구 호출 지원 (MCP 도구를 사용하는 에이전트에 연결 가능)</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={supportsReasoning}
              onChange={(event) => setSupportsReasoning(event.target.checked)}
            />
            <span>생각 과정 출력 (답변 전에 추론 내용을 출력하는 모델)</span>
          </label>
          <span className="field-hint">
            Ollama는 터미널에서 <code className="code">ollama show 모델이름</code> 의 Capabilities에서
            tools, thinking 지원 여부를 확인할 수 있습니다.
          </span>
        </div>

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
