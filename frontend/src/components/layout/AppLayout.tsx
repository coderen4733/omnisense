import { useState } from 'react'
import { Outlet } from 'react-router-dom'

import { STORAGE_KEYS } from '../../constants/app'
import { getStorageItem, setStorageItem } from '../../utils/storage'
import Header from './Header'
import Sidebar from './Sidebar'

// 화면 폭이 이 값(px)보다 좁으면 처음에 메뉴를 접은 상태로 시작
const COLLAPSE_BREAKPOINT = 1024

//  * 메뉴 접힘 상태의 처음 값 정하기
//  - 저장된 값이 있으면 그대로 사용 (새로고침해도 유지)
//  - 없으면 화면 폭이 좁을 때(태블릿, 모바일)만 접은 상태로 시작
function getInitialCollapsed(): boolean {
  const saved = getStorageItem(STORAGE_KEYS.sidebarCollapsed)
  if (saved !== null) {
    return saved === 'true'
  }
  return window.innerWidth < COLLAPSE_BREAKPOINT
}

//  * 로그인 후 화면의 기본 틀
//  ┌──────────────── Header (로고, 현재 위치, 테마, 알림, 사용자) ────────────────┐
//  │ Sidebar(메뉴) │ main: 각 화면이 그려지는 자리(<Outlet />)                      │
//  └───────────────┴─────────────────────────────────────────────────────────────┘
export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed)

  // 메뉴 접기/펼치기 + 브라우저에 저장
  const handleToggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      setStorageItem(STORAGE_KEYS.sidebarCollapsed, String(next))
      return next
    })
  }

  return (
    <div className="app-shell">
      <Header collapsed={collapsed} onToggleSidebar={handleToggleSidebar} />
      <div className="app-body">
        <Sidebar collapsed={collapsed} />
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
