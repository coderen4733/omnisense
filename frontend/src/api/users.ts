import { request } from './client'
import type {
  CreatedUser,
  CreateUserRequest,
  User,
  UserListQuery,
  UserListResponse,
  UserRole,
} from './types'

//  * 사용자(User) API 모음 - backend/src/services/iam/user/router.py 와 연결
//  - ⚠️ 백엔드 주소가 "/users/" 처럼 끝에 / 가 있으므로 그대로 맞춰야 함
//    (끝의 / 를 빼면 백엔드가 주소를 바꾸라는 응답(307)을 보내서 요청이 한 번 더 오가게 됨)

//  * 사용자 정보가 바뀌었음을 앱 전체에 알리는 이벤트 이름
//  - 사용자 생성/활성화/권한 변경에 성공하면 이 이벤트를 발생시킴
//  - 헤더의 알림(🔔) 숫자 등이 이 이벤트를 듣고 최신 값으로 다시 불러옴
export const USERS_CHANGED_EVENT = 'omnisense:users-changed'

function notifyUsersChanged() {
  window.dispatchEvent(new Event(USERS_CHANGED_EVENT))
}

// 내 정보 조회 (GET /users/me)
export function getMe() {
  return request<User>('/users/me')
}

// 사용자 목록 조회 (GET /users/) - admin, manager 전용
export function getUsers(query: UserListQuery) {
  return request<UserListResponse>('/users/', { query })
}

// 사용자 생성 (POST /users/) - admin 전용, 생성된 계정은 바로 활성화됨
export async function createUser(data: CreateUserRequest) {
  const created = await request<CreatedUser>('/users/', { method: 'POST', body: data })
  notifyUsersChanged()
  return created
}

// 사용자 활성화 상태 변경 (PATCH /users/{id}/active) - admin, manager 전용
export async function updateUserActive(userId: number, isActive: boolean) {
  const updated = await request<User>(`/users/${userId}/active`, {
    method: 'PATCH',
    body: { is_active: isActive },
  })
  notifyUsersChanged()
  return updated
}

// 사용자 권한 변경 (PATCH /users/{id}/role) - admin 전용
export async function updateUserRole(userId: number, role: UserRole) {
  const updated = await request<User>(`/users/${userId}/role`, {
    method: 'PATCH',
    body: { role },
  })
  notifyUsersChanged()
  return updated
}
