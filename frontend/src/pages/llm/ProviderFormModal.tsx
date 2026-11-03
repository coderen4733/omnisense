import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { getErrorMessage } from '../../api/client'
import { createProvider, updateProvider } from '../../api/llm'
import type { LlmProvider, LlmProviderType } from '../../api/types'
import Modal from '../../components/common/Modal'
import PasswordInput from '../../components/common/PasswordInput'
import SelectBox from '../../components/common/SelectBox'
import {
  BASE_URL_PLACEHOLDER,
  PROVIDER_TYPE_LABEL,
  PROVIDER_TYPE_OPTIONS,
  REGION_PLACEHOLDER,
} from '../../constants/llm'
import { useToast } from '../../contexts/ToastContext'

interface ProviderFormModalProps {
  provider: LlmProvider | null // null이면 새로 등록, 값이 있으면 수정
  onClose: () => void
  onSaved: () => void // 저장 성공 후 호출 (목록 새로고침용)
}

//  * LLM 공급자 등록/수정 팝업 (admin 전용)
//  - 부모(LlmPage)가 열 때만 그리므로, 열 때마다 입력값이 처음 값으로 초기화됨
//  - API 키는 저장된 값을 보여주지 않음 (보안)
//    => 수정할 때 비워두면 기존 키 유지 / 새로 입력하면 교체 / "삭제" 체크 시 삭제
export default function ProviderFormModal({ provider, onClose, onSaved }: ProviderFormModalProps) {
  const { showToast } = useToast()
  const isEdit = provider !== null
  const formId = useId()

  // 입력값 (수정이면 기존 값으로 시작)
  const [name, setName] = useState(provider?.name ?? '')
  const [providerType, setProviderType] = useState<LlmProviderType>(
    provider?.provider_type ?? 'openai_compatible',
  )
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '')
  const [region, setRegion] = useState(provider?.region ?? '')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isOpenAiCompatible = providerType === 'openai_compatible'
  const isBedrock = providerType === 'bedrock'

  // 팝업 닫기 (요청 처리 중에는 닫지 않음)
  const handleClose = () => {
    if (!submitting) {
      onClose()
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)
    setSubmitting(true)
    try {
      if (isEdit) {
        // 1. 빈 API 키는 보내지 않음(undefined) => 기존 키 유지
        //    단, Bedrock이면 리전도 함께 보냄
        await updateProvider(provider.id, {
          name: name.trim(),
          base_url: isOpenAiCompatible ? baseUrl.trim() : undefined,
          region: isBedrock ? region.trim() : undefined,
          api_key: apiKey.trim() || undefined,
          clear_api_key: clearApiKey,
        })
        showToast(`'${name.trim()}' 공급자를 수정했습니다.`)
      } else {
        // 2. 새로 등록 - Bedrock이면 리전도 함께 보냄
        await createProvider({
          name: name.trim(),
          provider_type: providerType,
          base_url: isOpenAiCompatible ? baseUrl.trim() : undefined,
          region: isBedrock ? region.trim() : undefined,
          api_key: apiKey.trim() || undefined,
        })
        showToast(`'${name.trim()}' 공급자를 등록했습니다.`)
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
      title={isEdit ? 'LLM 공급자 수정' : 'LLM 공급자 등록'}
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
        <label className="field">
          <span className="field-label">공급자 이름</span>
          <input
            className="input"
            placeholder={isBedrock ? '예) AWS Bedrock 서울' : '예) 로컬 Ollama'}
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
          />
        </label>

        <div className="field">
          <span className="field-label">연결 방식</span>
          {isEdit ? (
            // 연결 방식은 등록 후 바꿀 수 없음 (모델 ID 형식이 방식마다 다르기 때문)
            <span className="field-static">{PROVIDER_TYPE_LABEL[providerType]}</span>
          ) : (
            <SelectBox
              value={providerType}
              options={PROVIDER_TYPE_OPTIONS}
              onChange={setProviderType}
              ariaLabel="연결 방식"
            />
          )}
          {/* 연결 방식별 안내 문구 */}
          <span className="field-hint">
            {isBedrock
              ? 'AWS Bedrock API 키로 Converse API를 호출합니다.'
              : 'Ollama(개발용)와 vLLM(납품용)은 같은 OpenAI 호환 방식이라 주소만 바꾸면 됩니다.'}
          </span>
        </div>

        {isOpenAiCompatible && (
          <label className="field">
            <span className="field-label">서버 주소</span>
            <input
              className="input"
              placeholder={BASE_URL_PLACEHOLDER}
              maxLength={500}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              required
            />
            <span className="field-hint">/v1 까지 입력해 주세요.</span>
          </label>
        )}

        {/* Bedrock 리전 입력칸 */}
        {isBedrock && (
          <label className="field">
            <span className="field-label">AWS 리전</span>
            <input
              className="input"
              placeholder={REGION_PLACEHOLDER}
              maxLength={50}
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              required
            />
            <span className="field-hint">
              API 키를 발급받은 리전과 같아야 합니다. (API 키는 발급한 리전에서만 동작)
            </span>
          </label>
        )}

        {/* API 키 입력칸 - Bedrock은 필수(등록 시 required), OpenAI 호환은 선택 */}
        <label className="field">
          <span className="field-label">{isBedrock ? 'API 키' : 'API 키 (선택)'}</span>
          <PasswordInput
            placeholder={
              isEdit && provider.has_api_key
                ? '변경하지 않으려면 비워두세요'
                : isBedrock
                  ? 'Bedrock API 키 (단기 키는 최대 12시간 유효)'
                  : '필요 없으면 비워두세요 (Ollama는 불필요)'
            }
            autoComplete="off"
            maxLength={4000}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={clearApiKey}
            required={isBedrock && !isEdit}
          />
          <span className="field-hint">
            API 키는 암호화되어 저장되며, 저장된 키는 다시 볼 수 없습니다.
            {isBedrock && ' 단기 키가 만료되면 새로 발급받아 여기서 교체해 주세요.'}
          </span>
        </label>

        {/* Bedrock은 API 키가 필수이므로 삭제 체크박스를 보여주지 않음 */}
        {isEdit && provider.has_api_key && !isBedrock && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.target.checked)}
            />
            <span>저장된 API 키 삭제</span>
          </label>
        )}

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
