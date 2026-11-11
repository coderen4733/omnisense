import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import PageLoader from './components/common/PageLoader'
import AppLayout from './components/layout/AppLayout'
import { ProtectedRoute, PublicOnlyRoute, RoleRoute } from './components/route/RouteGuards'
import { COMING_SOON_MENUS } from './constants/menu'
import { MONITORING_ROLES } from './constants/run'
import { USER_MANAGER_ROLES } from './constants/user'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
import AccountPage from './pages/account/AccountPage'
import AgentRunPage from './pages/agents/AgentRunPage'
import AgentsPage from './pages/agents/AgentsPage'
import LoginPage from './pages/auth/LoginPage'
import SignUpPage from './pages/auth/SignUpPage'
import ComingSoonPage from './pages/ComingSoonPage'
import LlmPage from './pages/llm/LlmPage'
import MonitoringPage from './pages/monitoring/MonitoringPage'
import UsersPage from './pages/users/UsersPage'
import WorkflowsPage from './pages/workflows/WorkflowsPage'

// [수정] * 워크플로우 편집 화면을 "나중에 불러오기(lazy)"로 연결 [2026-11-10 13:40]
// [기존] 모든 화면을 처음에 한 번에 불러왔습니다.
// [변경] 편집 화면은 캔버스 라이브러리(React Flow)가 커서, 편집 화면을 처음 열 때만 따로 내려받습니다.
//        (components/common/MarkdownView.tsx 의 lazy 설명 참고)
const WorkflowEditorPage = lazy(() => import('./pages/workflows/WorkflowEditorPage'))
// [수정] 실행 기록 상세 화면도 캔버스 라이브러리를 쓰므로 "나중에 불러오기(lazy)"로 연결 [2026-11-11 12:50]
const RunDetailPage = lazy(() => import('./pages/monitoring/RunDetailPage'))

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
                  {/* LLM 모델 관리 화면 연결 (admin, manager) */}
                  <Route
                    path="/settings/llm"
                    element={
                      <RoleRoute roles={USER_MANAGER_ROLES}>
                        <LlmPage />
                      </RoleRoute>
                    }
                  />
                  <Route path="/account" element={<AccountPage />} />
                  {/* 에이전트 목록(/agents)과 테스트 실행(/agents/번호)
                      (모든 로그인 사용자 - 등록·수정·삭제 버튼은 admin, manager에게만 보임) */}
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/agents/:agentId" element={<AgentRunPage />} />
                  {/* [수정] * 워크플로우 화면 연결 [2026-11-10 13:40]
                      [기존] /workflows 는 "준비중" 화면이었습니다.
                      [변경] 목록(/workflows)과 편집(/workflows/번호) 화면을 연결합니다.
                             (모든 로그인 사용자 - 만들기·수정·삭제는 admin, manager / 일반 사용자는 보기 전용)
                             편집 화면을 내려받는 동안에는 로딩 화면(PageLoader)을 보여줌 */}
                  <Route path="/workflows" element={<WorkflowsPage />} />
                  <Route
                    path="/workflows/:workflowId"
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <WorkflowEditorPage />
                      </Suspense>
                    }
                  />

                  {/* [수정] * 모니터링 화면 연결 [2026-11-11 12:50]
                      [기존] /monitoring 은 "준비중" 화면이었습니다.
                      [변경] 모니터링(/monitoring - admin, manager)과
                             실행 기록 상세(/monitoring/runs/번호 - 모든 로그인 사용자, 서버가 자기 기록만 보여줌)를 연결합니다. */}
                  <Route
                    path="/monitoring"
                    element={
                      <RoleRoute roles={MONITORING_ROLES}>
                        <MonitoringPage />
                      </RoleRoute>
                    }
                  />
                  <Route
                    path="/monitoring/runs/:runId"
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <RunDetailPage />
                      </Suspense>
                    }
                  />

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
