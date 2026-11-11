import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { getErrorMessage } from '../../api/client'
import type { Workflow, WorkflowSummary } from '../../api/types'
import { createWorkflow, updateWorkflow } from '../../api/workflows'
import Modal from '../../components/common/Modal'
import { useToast } from '../../contexts/ToastContext'

interface WorkflowFormModalProps {
  workflow: WorkflowSummary | null // null이면 새로 만들기, 값이 있으면 이름/설명 수정
  onClose: () => void
  onSaved: (workflow: Workflow) => void // 저장 결과 (새로 만든 경우 편집 화면으로 이동하는 데 사용)
}

//  * 워크플로우 만들기 / 이름·설명 수정 팝업 (admin, manager)
//  - 노드와 연결선은 편집 화면에서 그림 (새로 만들면 "시작 => 끝" 기본 그래프로 만들어짐)
export default function WorkflowFormModal({ workflow, onClose, onSaved }: WorkflowFormModalProps) {
  const { showToast } = useToast()
  const isEdit = workflow !== null
  const formId = useId()

  const [name, setName] = useState(workflow?.name ?? '')
  const [description, setDescription] = useState(workflow?.description ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleClose = () => {
    if (!submitting) {
      onClose()
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)
    setSubmitting(true)
    const data = { name: name.trim(), description: description.trim() || null }
    try {
      const result = isEdit ? await updateWorkflow(workflow.id, data) : await createWorkflow(data)
      showToast(isEdit ? `'${data.name}' 워크플로우를 수정했습니다.` : `'${data.name}' 워크플로우를 만들었습니다.`)
      onSaved(result)
      onClose()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title={isEdit ? '워크플로우 이름·설명 수정' : '새 워크플로우'}
      onClose={handleClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={handleClose}>
            취소
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={submitting}>
            {submitting && <LoaderCircle size={18} className="spin" />}
            {isEdit ? '저장' : '만들고 편집하기'}
          </button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">이름</span>
          <input
            className="input"
            placeholder="예) 견적 금액 검토"
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
            placeholder="예) 견적 금액을 계산하고, 기준 이상이면 승인 요청 메시지를 만듭니다."
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {!isEdit && (
          <span className="field-hint">
            "시작 → 끝" 기본 흐름으로 만들어집니다. 만든 뒤 편집 화면에서 노드를 추가하고 연결하세요.
          </span>
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
