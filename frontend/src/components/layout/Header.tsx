import { Bell, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { getUsers, USERS_CHANGED_EVENT } from '../../api/users'
import { USER_MANAGER_ROLES } from '../../constants/user'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../common/Logo'
import LogoMark from '../common/LogoMark'
import ThemeToggle from '../common/ThemeToggle'
import Breadcrumb from './Breadcrumb'
import UserMenu from './UserMenu'

//  * 비활성화(승인 대기 포함) 사용자 수를 불러오는 함수 (알림 🔔 숫자에 사용)
//  - enabled=false(일반 사용자)면 불러오지 않음 (목록 조회 API는 admin, manager 전용)
//  - 화면을 이동하거나, 사용자 정보가 바뀌면(USERS_CHANGED_EVENT) 다시 불러옴
function useInactiveUserCount(enabled: boolean): number {
  const [count, setCount] = useState(0)
  const { pathname } = useLocation()

  useEffect(() => {
    if (!enabled) {
      return
    }
    let ignore = false
    const load = () => {
      // size=1: 목록은 필요 없고 total(전체 개수)만 필요하므로 최소한으로 요청
      getUsers({ is_active: false, size: 1 })
        .then((result) => {
          if (!ignore) {
            setCount(result.total)
          }
        })
        .catch(() => {
          // 알림 숫자는 부가 기능이므로 실패해도 화면에 에러를 띄우지 않음
        })
    }
    load()
    window.addEventListener(USERS_CHANGED_EVENT, load)
    return () => {
      ignore = true
      window.removeEventListener(USERS_CHANGED_EVENT, load)
    }
  }, [enabled, pathname])

  return enabled ? count : 0
}

interface HeaderProps {
  collapsed: boolean
  onToggleSidebar: () => void
}

//  * 화면 맨 위 헤더
//  - 왼쪽: 로고 / 메뉴 접기 버튼 / 현재 위치(브레드크럼)
//  - 오른쪽: 다크모드 버튼 / 알림 버튼 / 사용자 메뉴
export default function Header({ collapsed, onToggleSidebar }: HeaderProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  // 사용자 관리 권한(admin, manager)이 있는지
  const canManageUsers = !!user && USER_MANAGER_ROLES.includes(user.role)
  const inactiveCount = useInactiveUserCount(canManageUsers)

  const toggleLabel = collapsed ? '메뉴 펼치기' : '메뉴 접기'
  const bellLabel =
    inactiveCount > 0 ? `승인 대기·비활성 사용자 ${inactiveCount}명` : '새 알림이 없습니다'

  // 알림 버튼 클릭 => 사용자·권한 관리 화면의 "비활성화" 탭으로 이동
  const handleBellClick = () => {
    if (canManageUsers) {
      navigate('/settings/users?status=inactive')
    }
  }

  return (
    <header className="app-header">
      {/* [수정] * 헤더 왼쪽 배치 순서 변경 [2026-10-28 17:35]
          [기존] 로고 => 메뉴 접기 버튼 => 구분선 => 현재 위치 순서였습니다.
          [변경] 로고 => 구분선 => 메뉴 접기 버튼 => 현재 위치 순서로 바꾸고,
                 로고 영역 폭을 사이드바 폭과 같게 하여 구분선이 사이드바 경계선과 일직선이 됩니다. */}
      <div className="header-left">
        {/* [수정] * 글자 로고 앞에 OS 심볼 추가 + 메뉴를 접으면 심볼만 표시 [2026-10-28 17:54]
            [기존] 메뉴 접힘 여부와 상관없이 글자 로고(UNION OmniSense)만 표시했습니다.
            [변경] 펼침: OS 심볼 + 글자 로고 / 접힘: OS 심볼만 표시하고 로고 영역도 접힌 메뉴 폭으로 줄어듭니다.
                   심볼 위치는 두 상태에서 똑같아서, 접을 때 심볼은 제자리에 있고 글자만 사라집니다.
            - is-collapsed 클래스: 로고 영역 폭을 접힌 메뉴 폭으로 줄임 (layout.css 참고) */}
        <Link
          to="/"
          className={collapsed ? 'header-brand is-collapsed' : 'header-brand'}
          aria-label="첫 화면으로 이동"
        >
          <LogoMark />
          {!collapsed && <Logo />}
        </Link>
        <span className="header-divider" aria-hidden="true" />
        <button
          type="button"
          className="icon-btn header-toggle"
          onClick={onToggleSidebar}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
        <Breadcrumb />
      </div>

      <div className="header-right">
        <ThemeToggle />
        <button
          type="button"
          className="icon-btn"
          onClick={handleBellClick}
          aria-label={bellLabel}
          title={bellLabel}
        >
          <Bell size={20} />
          {inactiveCount > 0 && (
            <span className="notify-badge">{inactiveCount > 99 ? '99+' : inactiveCount}</span>
          )}
        </button>
        <UserMenu />
      </div>
    </header>
  )
}
