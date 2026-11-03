import { BrainCircuit, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { getErrorMessage } from '../../api/client'
import { getProviders } from '../../api/llm'
import type { LlmProvider } from '../../api/types'
import PageHeader from '../../components/common/PageHeader'
import { useAuth } from '../../contexts/AuthContext'
import ChatPlayground from './ChatPlayground'
import ProviderCard from './ProviderCard'
import ProviderFormModal from './ProviderFormModal'

// 화면 위쪽 탭 (공급자·모델 관리 / 테스트 대화)
type LlmTab = 'models' | 'chat'

const TABS: { value: LlmTab; label: string }[] = [
  { value: 'models', label: '공급자·모델' },
  { value: 'chat', label: '테스트 대화' },
]

//  * LLM 모델 관리 화면 (admin, manager)
//  - 공급자·모델 탭: 공급자/모델 목록, 사용 여부, 연결 테스트 (등록·수정·삭제는 admin만)
//  - 테스트 대화 탭: 등록된 모델을 골라 실제로 대화해 보며 동작 확인
//  - 탭 값은 주소(?tab=chat)에 저장 => 새로고침해도 같은 탭 유지
export default function LlmPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: LlmTab = searchParams.get('tab') === 'chat' ? 'chat' : 'models'

  const [providers, setProviders] = useState<LlmProvider[] | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0) // 값을 바꾸면 목록을 다시 불러옴
  //  * 공급자 등록/수정 팝업 상태
  //  - null: 닫힘 / { provider: null }: 새로 등록 / { provider: 공급자 }: 수정
  const [providerModal, setProviderModal] = useState<{ provider: LlmProvider | null } | null>(null)

  // 공급자 목록 불러오기 (모델 목록 포함)
  useEffect(() => {
    let ignore = false
    getProviders()
      .then((data) => {
        if (!ignore) {
          setProviders(data)
          setErrorMessage(null)
        }
      })
      .catch((error) => {
        if (!ignore) {
          setErrorMessage(getErrorMessage(error))
        }
      })
    return () => {
      ignore = true
    }
  }, [reloadKey])

  const reload = () => setReloadKey((prev) => prev + 1)

  const handleTabChange = (next: LlmTab) => {
    setSearchParams(next === 'models' ? {} : { tab: next })
  }

  // 공급자·모델 탭 내용 그리기 (에러 / 불러오는 중 / 목록 없음 / 목록)
  const renderProviders = () => {
    if (errorMessage) {
      return <section className="card empty-state is-error">{errorMessage}</section>
    }
    if (!providers) {
      return <section className="card empty-state">불러오는 중...</section>
    }
    if (providers.length === 0) {
      return (
        <section className="card empty-state">
          <BrainCircuit size={36} strokeWidth={1.6} />
          <strong>등록된 LLM 공급자가 없습니다.</strong>
          <span>
            {isAdmin
              ? "오른쪽 위 '공급자 등록' 버튼으로 Ollama 서버(예: http://localhost:11434/v1)를 등록해 보세요."
              : '관리자에게 LLM 공급자 등록을 요청해 주세요.'}
          </span>
        </section>
      )
    }
    return (
      <div className="provider-list">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            isAdmin={isAdmin}
            onEdit={(target) => setProviderModal({ provider: target })}
            onChanged={reload}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="LLM 모델 관리"
        description="LLM 공급자와 모델을 등록하고 연결 상태를 테스트합니다."
        actions={
          tab === 'models' &&
          isAdmin && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setProviderModal({ provider: null })}
            >
              <Plus size={18} />
              공급자 등록
            </button>
          )
        }
      />

      <div className="segmented page-tabs" role="tablist" aria-label="LLM 모델 관리 탭">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            className={tab === item.value ? 'is-active' : undefined}
            onClick={() => handleTabChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'models' ? renderProviders() : <ChatPlayground providers={providers ?? []} />}

      {/* 팝업은 열릴 때만 그림 => 열 때마다 입력값이 새로 초기화됨 */}
      {providerModal && (
        <ProviderFormModal
          provider={providerModal.provider}
          onClose={() => setProviderModal(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}
