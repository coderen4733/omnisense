import { CircleAlert, KeyRound, LoaderCircle, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { changePassword } from '../../api/auth'
import { getErrorMessage } from '../../api/client'
import PageHeader from '../../components/common/PageHeader'
import PasswordInput from '../../components/common/PasswordInput'
import { ACCOUNT_MENU } from '../../constants/menu'
import { ROLE_LABEL } from '../../constants/user'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { formatDateTime } from '../../utils/format'

// 비밀번호 길이 규칙 (백엔드 ChangePasswordReq와 동일)
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

// 권한별 알약 색상 (사용자·권한 관리 화면과 동일)
const ROLE_TONE = {
  admin: 'red',
  manager: 'blue',
  user: 'gray',
} as const

//  * 내 계정 화면
//  - 내 정보 표시 (GET /users/me 결과 = 로그인할 때 불러온 정보)
//  - 비밀번호 변경 (PATCH /auth/password)
//    => 성공하면 백엔드가 모든 기기의 로그인을 끊으므로, 이 화면도 로그아웃 후 로그인 화면으로 이동
export default function AccountPage() {
  const { user, logout } = useAuth()
  const { showToast } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 로그인한 사용자만 들어오는 화면이지만, 타입 검사를 위해 한 번 더 확인
  if (!user) {
    return null
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)

    // 1. 화면에서 먼저 확인 (백엔드에서도 똑같이 한 번 더 확인함)
    if (newPassword !== newPasswordConfirm) {
      setErrorMessage('새 비밀번호가 서로 일치하지 않습니다.')
      return
    }
    if (newPassword === currentPassword) {
      setErrorMessage('새 비밀번호는 현재 비밀번호와 달라야 합니다.')
      return
    }

    // 2. 비밀번호 변경 요청
    setSubmitting(true)
    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirm: newPasswordConfirm,
      })
      // 3. 성공 => 로그아웃 (ProtectedRoute가 로그인 화면으로 이동시킴)
      showToast('비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.')
      await logout()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <PageHeader title={ACCOUNT_MENU.label} description={ACCOUNT_MENU.description} />

      <div className="account-grid">
        {/* 1. 계정 정보 */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              <UserRound size={20} />
              계정 정보
            </h2>
          </div>
          <dl className="info-list">
            <div className="info-row">
              <dt>이메일</dt>
              <dd className="cell-email">{user.email}</dd>
            </div>
            <div className="info-row">
              <dt>권한</dt>
              <dd>
                <span className={`pill pill-${ROLE_TONE[user.role]}`}>{ROLE_LABEL[user.role]}</span>
              </dd>
            </div>
            <div className="info-row">
              <dt>계정 상태</dt>
              <dd>
                <span className={user.is_active ? 'pill pill-green' : 'pill pill-orange'}>
                  {user.is_active ? '활성화' : '비활성화'}
                </span>
              </dd>
            </div>
            <div className="info-row">
              <dt>가입일</dt>
              <dd className="cell-date">{formatDateTime(user.created_at)}</dd>
            </div>
            <div className="info-row">
              <dt>수정일</dt>
              <dd className="cell-date">{formatDateTime(user.updated_at)}</dd>
            </div>
          </dl>
        </section>

        {/* 2. 비밀번호 변경 */}
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              <KeyRound size={20} />
              비밀번호 변경
            </h2>
          </div>
          <form className="card-body form-stack" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field-label">현재 비밀번호</span>
              <PasswordInput
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">새 비밀번호</span>
              <PasswordInput
                placeholder={`${PASSWORD_MIN_LENGTH}자 이상`}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">새 비밀번호 확인</span>
              <PasswordInput
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                value={newPasswordConfirm}
                onChange={(event) => setNewPasswordConfirm(event.target.value)}
                required
              />
              <span className="field-hint">
                비밀번호를 변경하면 모든 기기에서 로그아웃됩니다.
              </span>
            </label>

            {errorMessage && (
              <div className="form-error" role="alert">
                <CircleAlert size={16} />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting && <LoaderCircle size={18} className="spin" />}
                비밀번호 변경
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
