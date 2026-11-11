import { CircleAlert, CircleCheck, Pencil, PenLine, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { getErrorMessage } from '../../api/client'
import type { WorkflowSummary } from '../../api/types'
import { deleteWorkflow, getWorkflows, updateWorkflow } from '../../api/workflows'
import PageHeader from '../../components/common/PageHeader'
import PillSelect, { type PillOption } from '../../components/common/PillSelect'
import { WORKFLOW_MANAGER_ROLES } from '../../constants/workflow'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { formatDateTime } from '../../utils/format'
import WorkflowFormModal from './WorkflowFormModal'

// 사용 여부 알약 선택지
type ActiveValue = 'active' | 'inactive'

const ACTIVE_OPTIONS: PillOption<ActiveValue>[] = [
  { value: 'active', label: '사용', tone: 'green' },
  { value: 'inactive', label: '사용 안 함', tone: 'gray' },
]

//  * 워크플로우 목록 화면 (/workflows)
//  - 모든 사용자: 목록 보기 + 열기 (일반 사용자에게는 "사용" 상태인 워크플로우만, 편집 화면은 보기 전용)
//  - admin, manager: 새 워크플로우, 이름·설명 수정, 삭제, 사용 여부 변경
//  - 주소에 ?new=1 이 있으면 "새 워크플로우" 팝업을 바로 엶 (사이드바의 "새 워크플로우" 버튼)
export default function WorkflowsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const canManage = user !== null && WORKFLOW_MANAGER_ROLES.includes(user.role)

  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  //  * 만들기/수정 팝업 상태
  //  - null: 닫힘 / { workflow: null }: 새로 만들기 / { workflow: 워크플로우 }: 이름·설명 수정
  const [formModal, setFormModal] = useState<{ workflow: WorkflowSummary | null } | null>(null)

  // 사이드바 "새 워크플로우" 버튼 (?new=1) => 팝업 열기 (권한이 있을 때만) + 주소에서 ?new=1 지우기
  //  - 다음 화면 그리기 때 팝업을 열도록 미뤄서(setTimeout 0) 화면 그리는 도중 상태를 바꾸지 않음
  const openNew = searchParams.get('new') === '1'
  useEffect(() => {
    if (!openNew) {
      return
    }
    const timer = setTimeout(() => {
      if (canManage) {
        setFormModal({ workflow: null })
      }
      setSearchParams({}, { replace: true })
    }, 0)
    return () => clearTimeout(timer)
  }, [openNew, canManage, setSearchParams])

  // 목록 불러오기
  useEffect(() => {
    let ignore = false
    getWorkflows()
      .then((data) => {
        if (!ignore) {
          setWorkflows(data)
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

  // 사용 여부 변경
  const changeActive = async (workflow: WorkflowSummary, value: ActiveValue) => {
    setBusy(true)
    try {
      await updateWorkflow(workflow.id, { is_active: value === 'active' })
      showToast(`'${workflow.name}' 워크플로우를 ${value === 'active' ? '사용' : '사용 안 함'}으로 변경했습니다.`)
      reload()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  // 삭제 (확인 창을 띄운 뒤 삭제)
  const handleDelete = async (workflow: WorkflowSummary) => {
    if (!window.confirm(`'${workflow.name}' 워크플로우를 삭제할까요?\n그려 둔 노드와 연결도 함께 삭제됩니다.`)) {
      return
    }
    setBusy(true)
    try {
      await deleteWorkflow(workflow.id)
      showToast(`'${workflow.name}' 워크플로우를 삭제했습니다.`)
      reload()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  // 목록 내용 그리기 (에러 / 불러오는 중 / 목록 없음 / 카드 목록)
  const renderWorkflows = () => {
    if (errorMessage) {
      return <section className="card empty-state is-error">{errorMessage}</section>
    }
    if (!workflows) {
      return <section className="card empty-state">불러오는 중...</section>
    }
    if (workflows.length === 0) {
      return (
        <section className="card empty-state">
          <WorkflowIcon size={36} strokeWidth={1.6} />
          <strong>등록된 워크플로우가 없습니다.</strong>
          <span>
            {canManage
              ? "오른쪽 위 '새 워크플로우' 버튼으로 첫 워크플로우를 만들어 보세요."
              : '관리자에게 워크플로우 등록을 요청해 주세요.'}
          </span>
        </section>
      )
    }
    return (
      <div className="agent-grid">
        {workflows.map((workflow) => (
          <section key={workflow.id} className="card agent-card">
            {/* 1. 이름 + 사용 여부 */}
            <div className="agent-card-header">
              <span className="agent-avatar">
                <WorkflowIcon size={22} />
              </span>
              <h2 className="agent-card-title" title={workflow.name}>
                {workflow.name}
              </h2>
              <PillSelect
                value={workflow.is_active ? 'active' : 'inactive'}
                options={ACTIVE_OPTIONS}
                editable={canManage}
                disabled={busy}
                onChange={(value) => changeActive(workflow, value)}
                ariaLabel={`${workflow.name} 워크플로우 사용 여부 변경`}
              />
            </div>

            {/* 2. 설명 */}
            <p className={workflow.description ? 'agent-card-desc' : 'agent-card-desc text-muted'}>
              {workflow.description ?? '설명이 없습니다.'}
            </p>

            {/* 3. 노드 수, 점검 상태, 수정 시각 */}
            <dl className="agent-meta">
              <div>
                <dt>노드</dt>
                <dd>{workflow.node_count}개</dd>
              </div>
              <div>
                <dt>상태</dt>
                <dd>
                  {workflow.issue_count === 0 ? (
                    <span className="wf-status is-ready">
                      <CircleCheck size={14} />
                      실행 가능
                    </span>
                  ) : (
                    <span className="wf-status">
                      <CircleAlert size={14} />
                      고쳐야 할 문제 {workflow.issue_count}개
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>수정</dt>
                <dd className="cell-date">{formatDateTime(workflow.updated_at)}</dd>
              </div>
            </dl>

            {/* 4. 버튼 (열기 / 이름·설명 수정, 삭제) */}
            <div className="agent-card-footer">
              <Link to={`/workflows/${workflow.id}`} className="btn btn-outline btn-sm">
                <PenLine size={14} />
                {canManage ? '편집' : '보기'}
              </Link>
              {canManage && (
                <div className="row-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setFormModal({ workflow })}
                    aria-label={`${workflow.name} 이름·설명 수정`}
                    title="이름·설명 수정"
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn is-danger"
                    onClick={() => handleDelete(workflow)}
                    disabled={busy}
                    aria-label={`${workflow.name} 워크플로우 삭제`}
                    title="워크플로우 삭제"
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
        title="워크플로우"
        description="드래그 앤 드롭으로 AI 에이전트 워크플로우를 설계하고 실행합니다."
        actions={
          canManage && (
            <button type="button" className="btn btn-primary" onClick={() => setFormModal({ workflow: null })}>
              <Plus size={18} />새 워크플로우
            </button>
          )
        }
      />

      {renderWorkflows()}

      {formModal && (
        <WorkflowFormModal
          workflow={formModal.workflow}
          onClose={() => setFormModal(null)}
          onSaved={(saved) => {
            // 새로 만든 경우 바로 편집 화면으로, 수정한 경우 목록 새로고침
            if (formModal.workflow === null) {
              navigate(`/workflows/${saved.id}`)
            } else {
              reload()
            }
          }}
        />
      )}
    </div>
  )
}
