import { CircleAlert, CircleCheck, LoaderCircle, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { signUp } from '../../api/auth'
import { getErrorMessage } from '../../api/client'
import PasswordInput from '../../components/common/PasswordInput'
import AuthLayout from '../../components/layout/AuthLayout'

// 비밀번호 길이 규칙 (백엔드 UserCreateBase와 동일: 8자 이상 128자 이하)
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

//  * 회원가입 화면 (POST /auth/sign-up)
//  - 가입한 계정은 "비활성화" 상태로 만들어지며, 관리자(admin/manager)가 승인해야 로그인 가능
export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false) // 가입 완료 여부

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)

    // 1. 서버에 보내기 전에 화면에서 먼저 확인 (백엔드에서도 똑같이 한 번 더 확인함)
    if (password !== passwordConfirm) {
      setErrorMessage('두 비밀번호가 일치하지 않습니다.')
      return
    }

    // 2. 회원가입 요청
    setSubmitting(true)
    try {
      await signUp({ email: email.trim(), password, password_confirm: passwordConfirm })
      setCompleted(true)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  // 가입 완료 화면
  if (completed) {
    return (
      <AuthLayout>
        <div className="auth-success">
          <CircleCheck size={48} className="auth-success-icon" />
          <h1 className="auth-title">회원가입 신청 완료</h1>
          <p className="auth-desc">
            관리자 승인 후 로그인할 수 있습니다.
            <br />
            승인이 완료될 때까지 잠시 기다려 주세요.
          </p>
          <Link to="/login" className="btn btn-primary btn-block btn-lg">
            로그인 화면으로
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className="auth-title">회원가입</h1>
      <p className="auth-desc">가입 후 관리자 승인이 완료되면 로그인할 수 있습니다.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">이메일</span>
          <div className="input-with-icon">
            <Mail size={18} className="input-icon" aria-hidden="true" />
            <input
              className="input"
              type="email"
              placeholder="name@example.com"
              autoComplete="username"
              maxLength={50}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            required
          />
        </label>

        {errorMessage && (
          <div className="form-error" role="alert">
            <CircleAlert size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
          {submitting && <LoaderCircle size={18} className="spin" />}
          회원가입
        </button>
      </form>

      <p className="auth-footer">
        이미 계정이 있으신가요? <Link to="/login">로그인</Link>
      </p>
    </AuthLayout>
  )
}
