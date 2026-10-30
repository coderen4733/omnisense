import { ChevronDown, LogOut, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ORGANIZATION_NAME } from '../../constants/app'
import { ROLE_LABEL } from '../../constants/user'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

//  * 헤더 오른쪽 사용자 영역 ( (A) admin / 관리자 · UNION ▾ )
//  - 클릭하면 "내 계정", "로그아웃" 메뉴가 열림
export default function UserMenu() {
  const { user, logout } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 메뉴가 열려 있을 때: 메뉴 바깥을 클릭하거나 ESC 키를 누르면 닫기
  useEffect(() => {
    if (!open) {
      return
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (!user) {
    return null
  }

  // 화면에 보여줄 이름: email의 @ 앞부분 (예: admin@example.com => admin)
  const displayName = user.email.split('@')[0]
  // 동그라미 안에 넣을 첫 글자 (대문자)
  const initial = displayName.charAt(0).toUpperCase()

  const handleGoAccount = () => {
    setOpen(false)
    navigate('/account')
  }

  const handleLogout = async () => {
    setOpen(false)
    await logout()
    showToast('로그아웃되었습니다.', 'info')
  }

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="user-info">
          <span className="user-name">{displayName}</span>
          <span className="user-meta">
            {ROLE_LABEL[user.role]} · {ORGANIZATION_NAME}
          </span>
        </span>
        <ChevronDown size={18} className="user-chevron" />
      </button>

      {open && (
        <div className="dropdown" role="menu">
          <div className="dropdown-header">{user.email}</div>
          <button type="button" role="menuitem" className="dropdown-item" onClick={handleGoAccount}>
            <UserRound size={16} />내 계정
          </button>
          <button
            type="button"
            role="menuitem"
            className="dropdown-item is-danger"
            onClick={handleLogout}
          >
            <LogOut size={16} />
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}
