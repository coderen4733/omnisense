import { CircleAlert, LoaderCircle, Mail } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { getErrorMessage } from '../../api/client'
import type { UserRole } from '../../api/types'
import { createUser } from '../../api/users'
import Modal from '../../components/common/Modal'
import PasswordInput from '../../components/common/PasswordInput'
import SelectBox from '../../components/common/SelectBox'
import { ROLE_LABEL } from '../../constants/user'
import { useToast } from '../../contexts/ToastContext'

// 비밀번호 길이 규칙 (백엔드 UserCreateBase와 동일)
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

// 권한 선택지
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'user', label: ROLE_LABEL.user },
  { value: 'manager', label: ROLE_LABEL.manager },
  { value: 'admin', label: ROLE_LABEL.admin },
]

// 입력창 초기값 (팝업을 닫으면 이 값으로 되돌림)
const EMPTY_FORM = {
  email: '',
  password: '',
  passwordConfirm: '',
  role: 'user' as UserRole,
}

interface CreateUserModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void // 생성 성공 후 호출 (목록 새로고침용)
}

//  * 사용자 생성 팝업 (POST /users/) - 관리자(admin) 전용
//  - 관리자가 만든 계정은 승인 절차 없이 바로 "활성화" 상태로 생성됨
export default function CreateUserModal({ open, onClose, onCreated }: CreateUserModalProps) {
  const { showToast } = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // 팝업 아래쪽 "생성" 버튼이 form 바깥에 있으므로, form id로 연결해서 제출되도록 함
  const formId = useId()

  // 입력값 하나만 바꾸기 (예: updateField('email', 'a@b.com'))
  //  - keyof typeof EMPTY_FORM: 'email' | 'password' | 'passwordConfirm' | 'role' 중 하나
  const updateField = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // 팝업 닫기 (요청 처리 중에는 닫지 않음) + 입력값 초기화
  const handleClose = () => {
    if (submitting) {
      return
    }
    setForm(EMPTY_FORM)
    setErrorMessage(null)
    onClose()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)

    // 1. 비밀번호 확인 (백엔드에서도 한 번 더 확인함)
    if (form.password !== form.passwordConfirm) {
      setErrorMessage('두 비밀번호가 일치하지 않습니다.')
      return
    }

    // 2. 사용자 생성 요청
    setSubmitting(true)
    try {
      const created = await createUser({
        email: form.email.trim(),
        password: form.password,
        password_confirm: form.passwordConfirm,
        role: form.role,
      })
      showToast(`${created.email} 계정을 생성했습니다.`)
      setForm(EMPTY_FORM)
      onCreated()
      onClose()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="사용자 생성"
      onClose={handleClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={handleClose}>
            취소
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={submitting}>
            {submitting && <LoaderCircle size={18} className="spin" />}
            생성
          </button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">이메일</span>
          <div className="input-with-icon">
            <Mail size={18} className="input-icon" aria-hidden="true" />
            <input
              className="input"
              type="email"
              placeholder="name@example.com"
              autoComplete="off"
              maxLength={50}
              value={form.email}
              onChange={(event) => updateField('email', event.target.value)}
              required
              autoFocus
            />
          </div>
        </label>

        <label className="field">
          <span className="field-label">비밀번호</span>
          <PasswordInput
            placeholder={`${PASSWORD_MIN_LENGTH}자 이상`}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            value={form.password}
            onChange={(event) => updateField('password', event.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">비밀번호 확인</span>
          <PasswordInput
            placeholder="비밀번호를 다시 입력해 주세요"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            value={form.passwordConfirm}
            onChange={(event) => updateField('passwordConfirm', event.target.value)}
            required
          />
        </label>

        <div className="field">
          <span className="field-label">권한</span>
          <SelectBox
            value={form.role}
            options={ROLE_OPTIONS}
            onChange={(role) => updateField('role', role)}
            ariaLabel="권한"
          />
          <span className="field-hint">관리자가 생성한 계정은 바로 활성화됩니다.</span>
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
