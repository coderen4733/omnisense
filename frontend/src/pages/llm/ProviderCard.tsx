import {
  CircleAlert,
  CircleCheck,
  Copy,
  LoaderCircle,
  Pencil,
  Plus,
  Server,
  Trash2,
  Zap,
} from 'lucide-react'
import { useState } from 'react'

import { getErrorMessage } from '../../api/client'
import { deleteModel, deleteProvider, testModel, updateModel, updateProvider } from '../../api/llm'
import type { LlmModel, LlmProvider } from '../../api/types'
import Modal from '../../components/common/Modal'
import PillSelect, { type PillOption } from '../../components/common/PillSelect'
import { PROVIDER_TYPE_LABEL } from '../../constants/llm'
import { useToast } from '../../contexts/ToastContext'
import ModelFormModal from './ModelFormModal'

// 사용 여부 알약 선택지 (공급자, 모델 공통)
type ActiveValue = 'active' | 'inactive'

const ACTIVE_OPTIONS: PillOption<ActiveValue>[] = [
  { value: 'active', label: '사용', tone: 'green' },
  { value: 'inactive', label: '사용 안 함', tone: 'gray' },
]

//  * 모델 1개의 연결 테스트 상태
//  - testing: 테스트 중 / success: 성공 / error: 실패 (message: 결과 설명)
type TestState =
  | { status: 'testing' }
  | { status: 'success' | 'error'; message: string; latencyMs: number | null }

interface ProviderCardProps {
  provider: LlmProvider
  isAdmin: boolean // 등록/수정/삭제 버튼을 보여줄지 (admin만)
  onEdit: (provider: LlmProvider) => void // 공급자 수정 팝업 열기
  onChanged: () => void // 공급자/모델이 바뀐 뒤 목록 다시 불러오기
}

//  * 공급자 1개 카드 (공급자 정보 + 등록된 모델 표)
export default function ProviderCard({ provider, isAdmin, onEdit, onChanged }: ProviderCardProps) {
  const { showToast } = useToast()
  //  * 모델 등록/수정 팝업 상태
  //  - null: 닫힘 / { model: null }: 새로 등록 / { model: 모델 }: 수정
  const [modelModal, setModelModal] = useState<{ model: LlmModel | null } | null>(null)
  // 모델별 연결 테스트 상태 (key: 모델 번호)
  const [testStates, setTestStates] = useState<Record<number, TestState>>({})
  // 사용 여부 변경/삭제 요청 처리 중 (중복 클릭 방지)
  const [busy, setBusy] = useState(false)
  // 연결 테스트 오류 자세히 보기 팝업
  // - 표에는 "오류"만 표시하고, "자세히 보기"를 누르면 이 팝업에 전체 메시지를 보여줌
  // - null: 닫힘 / { model, message }: 해당 모델의 오류 메시지를 보여주는 중
  const [errorDetail, setErrorDetail] = useState<{ model: LlmModel; message: string } | null>(null)

  // 오류 메시지 복사 (클립보드)
  // - navigator.clipboard: 브라우저의 복사/붙여넣기 기능 (http://localhost 또는 https 에서만 동작)
  const handleCopyError = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message)
      showToast('오류 메시지를 복사했습니다.', 'info')
    } catch {
      showToast('복사하지 못했습니다. 메시지를 직접 선택해서 복사해 주세요.', 'error')
    }
  }

  // 1. 공급자 사용 여부 변경
  const changeProviderActive = async (value: ActiveValue) => {
    setBusy(true)
    try {
      await updateProvider(provider.id, { is_active: value === 'active' })
      showToast(`'${provider.name}' 공급자를 ${value === 'active' ? '사용' : '사용 안 함'}으로 변경했습니다.`)
      onChanged()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  // 2. 공급자 삭제 (확인 창을 띄운 뒤 삭제)
  const handleDeleteProvider = async () => {
    const confirmed = window.confirm(
      `'${provider.name}' 공급자를 삭제할까요?\n등록된 모델 ${provider.models.length}개도 함께 삭제됩니다.`,
    )
    if (!confirmed) {
      return
    }
    setBusy(true)
    try {
      await deleteProvider(provider.id)
      showToast(`'${provider.name}' 공급자를 삭제했습니다.`)
      onChanged()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      setBusy(false)
    }
  }

  // 3. 모델 사용 여부 변경
  const changeModelActive = async (model: LlmModel, value: ActiveValue) => {
    setBusy(true)
    try {
      await updateModel(model.id, { is_active: value === 'active' })
      showToast(`'${model.display_name}' 모델을 ${value === 'active' ? '사용' : '사용 안 함'}으로 변경했습니다.`)
      onChanged()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  // 4. 모델 삭제
  const handleDeleteModel = async (model: LlmModel) => {
    if (!window.confirm(`'${model.display_name}' 모델을 삭제할까요?`)) {
      return
    }
    setBusy(true)
    try {
      await deleteModel(model.id)
      showToast(`'${model.display_name}' 모델을 삭제했습니다.`)
      onChanged()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  // 5. 모델 연결 테스트 (결과는 모델 옆에 표시)
  const handleTest = async (model: LlmModel) => {
    // prev => ({ ...prev, [키]: 값 }): 기존 상태는 그대로 두고 이 모델의 상태만 바꿈
    setTestStates((prev) => ({ ...prev, [model.id]: { status: 'testing' } }))
    try {
      const result = await testModel(model.id)
      setTestStates((prev) => ({
        ...prev,
        [model.id]: {
          status: result.success ? 'success' : 'error',
          message: result.message,
          latencyMs: result.latency_ms,
        },
      }))
    } catch (error) {
      setTestStates((prev) => ({
        ...prev,
        [model.id]: { status: 'error', message: getErrorMessage(error), latencyMs: null },
      }))
    }
  }

  return (
    <section className="card">
      {/* 카드 제목: 공급자 이름 + 연결 방식 + 사용 여부 + (admin) 버튼 */}
      <div className="card-header">
        <div className="provider-heading">
          <h2 className="card-title">
            <Server size={20} />
            {provider.name}
          </h2>
          <span className="pill pill-gray">{PROVIDER_TYPE_LABEL[provider.provider_type]}</span>
          <PillSelect
            value={provider.is_active ? 'active' : 'inactive'}
            options={ACTIVE_OPTIONS}
            editable={isAdmin}
            disabled={busy}
            onChange={changeProviderActive}
            ariaLabel={`${provider.name} 공급자 사용 여부 변경`}
          />
        </div>
        {isAdmin && (
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setModelModal({ model: null })}
            >
              <Plus size={16} />
              모델 추가
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => onEdit(provider)}
              aria-label="공급자 수정"
              title="공급자 수정"
            >
              <Pencil size={18} />
            </button>
            <button
              type="button"
              className="icon-btn is-danger"
              onClick={handleDeleteProvider}
              disabled={busy}
              aria-label="공급자 삭제"
              title="공급자 삭제"
            >
              <Trash2 size={18} />
            </button>
          </div>
        )}
      </div>

      {/* 접속 정보 (API 키 원문은 표시하지 않고 등록 여부만) */}
      <div className="provider-meta">
        {provider.base_url && (
          <span>
            주소 <code className="code">{provider.base_url}</code>
          </span>
        )}
        {provider.region && (
          <span>
            리전 <code className="code">{provider.region}</code>
          </span>
        )}
        <span>API 키 {provider.has_api_key ? '등록됨' : '없음'}</span>
      </div>

      {/* 모델 표 */}
      {provider.models.length === 0 ? (
        <p className="provider-empty">
          등록된 모델이 없습니다.{isAdmin && " '모델 추가' 버튼으로 모델을 등록해 주세요."}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>표시 이름</th>
                <th>모델 ID</th>
                <th>기능</th>
                <th className="col-center">사용 여부</th>
                <th>연결 테스트</th>
                {isAdmin && <th className="col-right">관리</th>}
              </tr>
            </thead>
            <tbody>
              {provider.models.map((model) => {
                const testState = testStates[model.id]
                const usable = provider.is_active && model.is_active
                return (
                  <tr key={model.id}>
                    <td className="cell-email">{model.display_name}</td>
                    <td>
                      <code className="code">{model.model_id}</code>
                    </td>
                    <td>
                      <div className="feature-badges">
                        {model.supports_tools && <span className="pill pill-sm pill-blue">도구 호출</span>}
                        {model.supports_reasoning && (
                          <span className="pill pill-sm pill-gray">생각 과정</span>
                        )}
                        {!model.supports_tools && !model.supports_reasoning && (
                          <span className="text-muted">-</span>
                        )}
                      </div>
                    </td>
                    <td className="col-center">
                      <PillSelect
                        value={model.is_active ? 'active' : 'inactive'}
                        options={ACTIVE_OPTIONS}
                        editable={isAdmin}
                        disabled={busy}
                        onChange={(value) => changeModelActive(model, value)}
                        ariaLabel={`${model.display_name} 모델 사용 여부 변경`}
                      />
                    </td>
                    <td>
                      <div className="test-cell">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => handleTest(model)}
                          disabled={!usable || testState?.status === 'testing'}
                          title={usable ? undefined : '사용 중인 공급자·모델만 테스트할 수 있습니다.'}
                        >
                          <Zap size={14} />
                          테스트
                        </button>
                        {/* 오류일 때 "자세히 보기" 버튼으로 전체 메시지 팝업 열기 */}
                        <TestResult
                          state={testState}
                          onShowDetail={(message) => setErrorDetail({ model, message })}
                        />
                      </div>
                    </td>
                    {isAdmin && (
                      <td className="col-right">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => setModelModal({ model })}
                            aria-label={`${model.display_name} 모델 수정`}
                            title="모델 수정"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn is-danger"
                            onClick={() => handleDeleteModel(model)}
                            disabled={busy}
                            aria-label={`${model.display_name} 모델 삭제`}
                            title="모델 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modelModal && (
        <ModelFormModal
          provider={provider}
          model={modelModal.model}
          onClose={() => setModelModal(null)}
          onSaved={onChanged}
        />
      )}

      {/* 연결 테스트 오류 자세히 보기 팝업
          오류 메시지는 글자 그대로 표시 (HTML로 해석하지 않으므로 메시지 안의 주소 등이 실행되지 않음) */}
      {errorDetail && (
        <Modal
          open
          title="연결 테스트 오류"
          onClose={() => setErrorDetail(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => handleCopyError(errorDetail.message)}
              >
                <Copy size={16} />
                복사
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setErrorDetail(null)}>
                닫기
              </button>
            </>
          }
        >
          <dl className="error-detail-meta">
            <div>
              <dt>모델</dt>
              <dd>{errorDetail.model.display_name}</dd>
            </div>
            <div>
              <dt>모델 ID</dt>
              <dd>
                <code className="code">{errorDetail.model.model_id}</code>
              </dd>
            </div>
          </dl>
          <div className="error-detail-message">{errorDetail.message}</div>
        </Modal>
      )}
    </section>
  )
}

// 오류 표시 방식
// 실패 시 "오류"와 "자세히 보기" 버튼만 표시하고, 버튼을 누르면 onShowDetail로 전체 메시지를 넘김
// 연결 테스트 결과 표시 (테스트 중 / 성공: 첫 응답까지 걸린 시간 / 실패: 오류 + 자세히 보기)
interface TestResultProps {
  state: TestState | undefined
  onShowDetail: (message: string) => void // "자세히 보기" 클릭 시 오류 메시지를 넘겨받는 함수
}

function TestResult({ state, onShowDetail }: TestResultProps) {
  if (!state) {
    return null
  }
  if (state.status === 'testing') {
    return (
      <span className="test-result">
        <LoaderCircle size={14} className="spin" />
        테스트 중...
      </span>
    )
  }
  if (state.status === 'success') {
    return (
      <span className="test-result is-success" title={state.message}>
        <CircleCheck size={14} />
        정상 ({((state.latencyMs ?? 0) / 1000).toFixed(2)}초)
      </span>
    )
  }
  return (
    <span className="test-result is-error">
      <CircleAlert size={14} />
      오류
      <button type="button" className="text-btn" onClick={() => onShowDetail(state.message)}>
        자세히 보기
      </button>
    </span>
  )
}
