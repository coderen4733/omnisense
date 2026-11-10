import { Bot, Pencil, Play, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { deleteAgent, getAgents, getAgentTools, updateAgent } from '../../api/agents'
import { getErrorMessage } from '../../api/client'
import type { Agent, AgentTool } from '../../api/types'
import PageHeader from '../../components/common/PageHeader'
import PillSelect, { type PillOption } from '../../components/common/PillSelect'
import { AGENT_MANAGER_ROLES } from '../../constants/agent'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import AgentFormModal from './AgentFormModal'

// 사용 여부 알약 선택지
type ActiveValue = 'active' | 'inactive'

const ACTIVE_OPTIONS: PillOption<ActiveValue>[] = [
  { value: 'active', label: '사용', tone: 'green' },
  { value: 'inactive', label: '사용 안 함', tone: 'gray' },
]

//  * 에이전트 목록 화면
//  - 모든 사용자: 에이전트 목록 보기 + 테스트 실행 (일반 사용자에게는 "사용" 상태인 에이전트만 보임)
//  - admin, manager: 에이전트 만들기, 수정, 삭제, 사용 여부 변경
export default function AgentsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const canManage = user !== null && AGENT_MANAGER_ROLES.includes(user.role)

  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [tools, setTools] = useState<AgentTool[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0) // 값을 바꾸면 목록을 다시 불러옴
  const [busy, setBusy] = useState(false) // 사용 여부 변경/삭제 처리 중 (중복 클릭 방지)
  //  * 에이전트 만들기/수정 팝업 상태
  //  - null: 닫힘 / { agent: null }: 새로 만들기 / { agent: 에이전트 }: 수정
  const [formModal, setFormModal] = useState<{ agent: Agent | null } | null>(null)

  // 에이전트 목록 + 도구 목록 불러오기
  //  - Promise.all: 두 요청을 동시에 보내고 둘 다 끝날 때까지 기다림
  useEffect(() => {
    let ignore = false
    Promise.all([getAgents(), getAgentTools()])
      .then(([agentList, toolList]) => {
        if (!ignore) {
          setAgents(agentList)
          setTools(toolList)
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

  // 도구 이름 => 화면 이름 (예: calculator => 계산기 / 목록에 없으면 이름 그대로)
  const toolLabel = (toolName: string) => tools.find((tool) => tool.name === toolName)?.label ?? toolName

  // 사용 여부 변경
  const changeActive = async (agent: Agent, value: ActiveValue) => {
    setBusy(true)
    try {
      await updateAgent(agent.id, { is_active: value === 'active' })
      showToast(`'${agent.name}' 에이전트를 ${value === 'active' ? '사용' : '사용 안 함'}으로 변경했습니다.`)
      reload()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  // 삭제 (확인 창을 띄운 뒤 삭제)
  const handleDelete = async (agent: Agent) => {
    if (!window.confirm(`'${agent.name}' 에이전트를 삭제할까요?`)) {
      return
    }
    setBusy(true)
    try {
      await deleteAgent(agent.id)
      showToast(`'${agent.name}' 에이전트를 삭제했습니다.`)
      reload()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  // 목록 내용 그리기 (에러 / 불러오는 중 / 목록 없음 / 카드 목록)
  const renderAgents = () => {
    if (errorMessage) {
      return <section className="card empty-state is-error">{errorMessage}</section>
    }
    if (!agents) {
      return <section className="card empty-state">불러오는 중...</section>
    }
    if (agents.length === 0) {
      return (
        <section className="card empty-state">
          <Bot size={36} strokeWidth={1.6} />
          <strong>등록된 에이전트가 없습니다.</strong>
          <span>
            {canManage
              ? "오른쪽 위 '에이전트 만들기' 버튼으로 첫 에이전트를 만들어 보세요."
              : '관리자에게 에이전트 등록을 요청해 주세요.'}
          </span>
        </section>
      )
    }
    return (
      <div className="agent-grid">
        {agents.map((agent) => (
          <section key={agent.id} className="card agent-card">
            {/* 1. 이름 + 사용 여부 */}
            <div className="agent-card-header">
              <span className="agent-avatar">
                <Bot size={22} />
              </span>
              <h2 className="agent-card-title" title={agent.name}>
                {agent.name}
              </h2>
              <PillSelect
                value={agent.is_active ? 'active' : 'inactive'}
                options={ACTIVE_OPTIONS}
                editable={canManage}
                disabled={busy}
                onChange={(value) => changeActive(agent, value)}
                ariaLabel={`${agent.name} 에이전트 사용 여부 변경`}
              />
            </div>

            {/* 2. 설명 */}
            <p className={agent.description ? 'agent-card-desc' : 'agent-card-desc text-muted'}>
              {agent.description ?? '설명이 없습니다.'}
            </p>

            {/* 3. 모델, 도구, 최대 반복 */}
            <dl className="agent-meta">
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
            </dl>

            {/* 4. 버튼 (테스트 실행 / 수정, 삭제) */}
            <div className="agent-card-footer">
              <Link to={`/agents/${agent.id}`} className="btn btn-outline btn-sm">
                <Play size={14} />
                테스트 실행
              </Link>
              {canManage && (
                <div className="row-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setFormModal({ agent })}
                    aria-label={`${agent.name} 에이전트 수정`}
                    title="에이전트 수정"
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn is-danger"
                    onClick={() => handleDelete(agent)}
                    disabled={busy}
                    aria-label={`${agent.name} 에이전트 삭제`}
                    title="에이전트 삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="에이전트"
        description="LLM, 프롬프트, 도구를 조합해 업무별 AI 에이전트를 만들고 관리합니다."
        actions={
          canManage && (
            <button type="button" className="btn btn-primary" onClick={() => setFormModal({ agent: null })}>
              <Plus size={18} />
              에이전트 만들기
            </button>
          )
        }
      />

      {renderAgents()}

      {/* 팝업은 열릴 때만 그림 => 열 때마다 입력값이 새로 초기화됨 */}
      {formModal && (
        <AgentFormModal
          agent={formModal.agent}
          tools={tools}
          onClose={() => setFormModal(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}

//  * 에이전트에 연결된 모델 표시 (목록 카드, 테스트 실행 화면에서 함께 사용)
//  - 모델이 삭제되었거나 "사용 안 함"이면 경고 표시 (이 상태에서는 실행할 수 없음)
export function AgentModelLabel({ agent }: { agent: Agent }) {
  if (!agent.llm_model) {
    return (
      <span className="agent-warning">
        <TriangleAlert size={14} />
        모델이 삭제됨 (다시 선택 필요)
      </span>
    )
  }
  return (
    <span className="agent-model">
      {agent.llm_model.provider_name} · {agent.llm_model.display_name}
      {!agent.llm_model.is_usable && (
        <span className="agent-warning">
          <TriangleAlert size={14} />
          사용 안 함
        </span>
      )}
    </span>
  )
}
