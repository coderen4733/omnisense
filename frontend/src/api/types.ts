//  * 백엔드 API의 요청/응답 형식(타입) 모음
//  - 백엔드의 schemas.py(Pydantic)와 똑같은 모양으로 맞춰야 함
//  - 백엔드 스키마가 바뀌면 이 파일도 함께 수정할 것

// 계정 권한 (backend/src/services/iam/user/enums.py 의 UserRole 값)
export type UserRole = 'admin' | 'manager' | 'user'

// 모든 API 응답의 공통 형식 (backend/src/common/response.py 의 ResponseSchema)
//  - <T>: data 안에 들어올 데이터의 타입을 나중에 정하겠다는 뜻 (제네릭)
export interface ApiResponse<T> {
  message: string
  data: T | null
}

// 사용자 정보 (UserReadRes / UserUpdateRes)
//  - 날짜는 ISO 형식 문자열로 옴 (예: "2026-10-08T08:53:39Z")
export interface User {
  id: number
  email: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

// 사용자 생성 응답 (UserCreateRes / SignUpRes) - updated_at이 없음
export type CreatedUser = Omit<User, 'updated_at'>

// 사용자 목록 조회 - 요청(Query) (UserReadListQuery)
//  - ?(물음표): 보내지 않아도 되는 값 (보내지 않으면 백엔드 기본값 사용)
export type UserListQuery = {
  is_active?: boolean
  role?: UserRole
  email?: string
  sort_by?: 'created_at' | 'updated_at' | 'email' | 'id'
  order?: 'asc' | 'desc'
  page?: number
  size?: number
}

// 사용자 목록 조회 - 응답 (UserReadListRes)
export interface UserListResponse {
  items: User[]
  total: number
  page: number
  size: number
  total_pages: number
}

// 사용자 생성(관리자 전용) - 요청 (UserCreateReq)
export interface CreateUserRequest {
  email: string
  password: string
  password_confirm: string
  role: UserRole
}

// 회원가입 - 요청 (SignUpReq)
export interface SignUpRequest {
  email: string
  password: string
  password_confirm: string
}

// 로그인 - 응답 (SignInRes)
export interface SignInResponse {
  access_token: string
  refresh_token: string
}

// 토큰재발급 - 응답 (ReTokenRes)
export interface ReTokenResponse {
  access_token: string
  token_type: string
}

// 비밀번호 변경 - 요청 (ChangePasswordReq)
export interface ChangePasswordRequest {
  current_password: string
  new_password: string
  new_password_confirm: string
}

// 비밀번호 변경 - 응답 (ChangePasswordRes)
export interface ChangePasswordResponse {
  success: boolean
  signed_out_sessions: number
}
