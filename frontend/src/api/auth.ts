import { request } from './client'
import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  CreatedUser,
  SignInResponse,
  SignUpRequest,
} from './types'

//  * 인증(Auth) API 모음 - backend/src/services/iam/auth/router.py 와 연결
//  - auth: false => 로그인 전에 호출하는 API라서 액세스 토큰을 붙이지 않음

// 로그인 (POST /auth/sign-in)
export function signIn(email: string, password: string) {
  return request<SignInResponse>('/auth/sign-in', {
    method: 'POST',
    body: { email, password },
    auth: false,
  })
}

// 회원가입 (POST /auth/sign-up) - 가입 후 관리자 승인(활성화)이 필요함
export function signUp(data: SignUpRequest) {
  return request<CreatedUser>('/auth/sign-up', {
    method: 'POST',
    body: data,
    auth: false,
  })
}

// 로그아웃 (POST /auth/sign-out) - 서버에 저장된 리프레시 토큰을 삭제
export function signOut(refreshToken: string) {
  return request<{ success: boolean }>('/auth/sign-out', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    auth: false,
  })
}

// 비밀번호 변경 (PATCH /auth/password) - 성공하면 모든 기기에서 로그아웃됨
export function changePassword(data: ChangePasswordRequest) {
  return request<ChangePasswordResponse>('/auth/password', {
    method: 'PATCH',
    body: data,
  })
}
