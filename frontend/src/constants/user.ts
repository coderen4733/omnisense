import type { UserRole } from '../api/types'

// 권한 값 => 화면에 보여줄 한국어 이름
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: '관리자',
  manager: '매니저',
  user: '사용자',
}

// 사용자·권한 관리 화면에 들어갈 수 있는 권한 (백엔드 GET /users/ 권한과 동일)
export const USER_MANAGER_ROLES: UserRole[] = ['admin', 'manager']
