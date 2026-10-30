import { CircleAlert, LoaderCircle, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { getErrorMessage } from '../../api/client'
import PasswordInput from '../../components/common/PasswordInput'
import AuthLayout from '../../components/layout/AuthLayout'
import { useAuth } from '../../contexts/AuthContext'

//  * 로그인 화면 (POST /auth/sign-in)
//  - 로그인에 성공하면 PublicOnlyRoute(RouteGuards.tsx)가 자동으로 화면을 이동시킴
//    => 이 화면에서는 직접 navigate 하지 않음
//  - 실패 메시지는 백엔드가 보내준 메시지를 그대로 보여줌
//    (예: "아이디 또는 비밀번호가 일치하지 않습니다.", "관리자 승인 대기 중인 계정입니다.")
export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    // preventDefault: form 제출 시 브라우저가 페이지를 새로고침하는 기본 동작을 막음
    event.preventDefault()
    setSubmitting(true)
    setErrorMessage(null)
    try {
      await login(email.trim(), password)
      // 성공 => PublicOnlyRoute가 화면을 이동시키므로 여기서는 할 일이 없음
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <h1 className="auth-title">로그인</h1>
      <p className="auth-desc">계정 정보를 입력해 주세요.</p>

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
            placeholder="비밀번호"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
          로그인
        </button>
      </form>

      <p className="auth-footer">
        계정이 없으신가요? <Link to="/sign-up">회원가입</Link>
      </p>
    </AuthLayout>
  )
}
