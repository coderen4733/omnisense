import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import type { UserRole } from '../../api/types'
import { useAuth } from '../../contexts/AuthContext'
import PageLoader from '../common/PageLoader'

//  * 화면 접근 제어 컴포넌트 모음 (App.tsx의 라우트 설정에서 사용)
//  - <Outlet />: 이 컴포넌트 아래에 등록된 하위 화면이 그려지는 자리
//  - <Navigate />: 다른 주소로 이동시키는 컴포넌트 (replace: 뒤로가기 기록을 남기지 않음)

// 로그인 화면에서 넘겨주는 "원래 가려던 주소" 정보
interface FromState {
  from?: string
}

// 1. 로그인한 사용자만 들어갈 수 있는 화면
//  - 로그인 안 됨 => 로그인 화면으로 이동 (로그인 후 원래 가려던 주소로 돌아오도록 from 전달)
export function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <PageLoader />
  }
  if (status === 'unauthenticated') {
    const from = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from } satisfies FromState} />
  }
  return <Outlet />
}

// 2. 로그인하지 않은 사용자만 들어갈 수 있는 화면 (로그인, 회원가입)
//  - 이미 로그인됨 => 원래 가려던 주소(없으면 첫 화면)로 이동
//  - 로그인에 성공하면 이 컴포넌트가 자동으로 화면을 이동시켜 줌
export function PublicOnlyRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <PageLoader />
  }
  if (status === 'authenticated') {
    const from = (location.state as FromState | null)?.from ?? '/'
    return <Navigate to={from} replace />
  }
  return <Outlet />
}

// 3. 특정 권한만 들어갈 수 있는 화면 (예: 사용자·권한 관리 => admin, manager)
//  - 권한이 없으면 첫 화면으로 이동
//  - ⚠️ 화면만 막는 것이고, 실제 보안은 백엔드 API의 권한 검사(403)가 담당함
interface RoleRouteProps {
  roles: UserRole[]
  children: ReactNode
}

export function RoleRoute({ roles, children }: RoleRouteProps) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }
  return children
}
