import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './components/layout/AppLayout'
import { ProtectedRoute, PublicOnlyRoute, RoleRoute } from './components/route/RouteGuards'
import { COMING_SOON_MENUS } from './constants/menu'
import { USER_MANAGER_ROLES } from './constants/user'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
import AccountPage from './pages/account/AccountPage'
import LoginPage from './pages/auth/LoginPage'
import SignUpPage from './pages/auth/SignUpPage'
import ComingSoonPage from './pages/ComingSoonPage'
import UsersPage from './pages/users/UsersPage'

//  * 앱의 가장 바깥 컴포넌트
//  1. Provider(공급자): 테마 / 알림 / 로그인 상태를 모든 화면에서 꺼내 쓸 수 있게 감쌈
//  2. Routes: 주소(URL)마다 어떤 화면을 보여줄지 정함
//     - PublicOnlyRoute : 로그인 "안 한" 사용자만 (로그인, 회원가입)
//     - ProtectedRoute  : 로그인 "한" 사용자만 (나머지 모든 화면)
//     - AppLayout       : 헤더 + 사이드바가 있는 기본 틀
export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* 1. 로그인 전 화면 */}
              <Route element={<PublicOnlyRoute />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/sign-up" element={<SignUpPage />} />
              </Route>

              {/* 2. 로그인 후 화면 */}
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  {/* 2-1. 첫 화면(/) => 대시보드로 이동 */}
                  <Route index element={<Navigate to="/dashboard" replace />} />

                  {/* 2-2. 개발 완료된 화면 */}
                  <Route
                    path="/settings/users"
                    element={
                      <RoleRoute roles={USER_MANAGER_ROLES}>
                        <UsersPage />
                      </RoleRoute>
                    }
                  />
                  <Route path="/account" element={<AccountPage />} />

                  {/* 2-3. 개발 전 메뉴 => "준비중" 화면 (constants/menu.ts의 ready: false 메뉴) */}
                  {COMING_SOON_MENUS.map((item) => (
                    <Route key={item.key} path={item.path} element={<ComingSoonPage item={item} />} />
                  ))}
                </Route>
              </Route>

              {/* 3. 없는 주소 => 첫 화면으로 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
