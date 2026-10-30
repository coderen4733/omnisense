import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'

import {
  ACCOUNT_MENU,
  canAccessMenu,
  isMenuGroup,
  MAIN_MENU,
  type MenuGroup,
  type MenuItem,
} from '../../constants/menu'
import { useAuth } from '../../contexts/AuthContext'

//  * 좌측 메뉴 (사이드바)
//  - collapsed=true: 아이콘만 보이는 좁은 메뉴 (마우스를 올리면 메뉴 이름이 툴팁으로 보임)
//  - 메뉴 구성은 constants/menu.ts 에서 관리
//  - 내 권한으로 볼 수 없는 메뉴(roles)는 표시하지 않음

interface SidebarProps {
  collapsed: boolean
}

export default function Sidebar({ collapsed }: SidebarProps) {
  const { user } = useAuth()
  // 그룹 메뉴의 펼침 상태 (예: { settings: false } => 설정 그룹 접힘)
  //  - 값이 없는 그룹은 펼친 상태(true)로 봄 => 처음에는 모든 그룹이 펼쳐져 있음
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const isGroupOpen = (key: string) => openGroups[key] ?? true
  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }))
  }

  return (
    <aside className={collapsed ? 'sidebar is-collapsed' : 'sidebar'} aria-label="주 메뉴">
      {/* 1. 맨 위: 새 워크플로우 버튼 */}
      <div className="sidebar-top">
        <NavLink to="/workflows" className="sidebar-new-btn" title="새 워크플로우">
          <Plus size={18} />
          {!collapsed && <span>새 워크플로우</span>}
        </NavLink>
      </div>

      {/* 2. 가운데: 메인 메뉴 */}
      <nav className="sidebar-nav">
        {MAIN_MENU.map((entry) => {
          // 2-1. 일반 메뉴
          if (!isMenuGroup(entry)) {
            if (!canAccessMenu(entry, user?.role)) {
              return null
            }
            return <SidebarLink key={entry.key} item={entry} collapsed={collapsed} />
          }
          // 2-2. 그룹 메뉴 (볼 수 있는 하위 메뉴가 하나도 없으면 그룹 자체를 숨김)
          const visibleChildren = entry.children.filter((child) => canAccessMenu(child, user?.role))
          if (visibleChildren.length === 0) {
            return null
          }
          return (
            <SidebarGroup
              key={entry.key}
              group={entry}
              items={visibleChildren}
              collapsed={collapsed}
              open={isGroupOpen(entry.key)}
              onToggle={() => toggleGroup(entry.key)}
            />
          )
        })}
      </nav>

      {/* 3. 맨 아래: 내 계정 */}
      <div className="sidebar-bottom">
        <SidebarLink item={ACCOUNT_MENU} collapsed={collapsed} />
      </div>
    </aside>
  )
}

//  * 메뉴 1개
//  - NavLink: 현재 주소와 메뉴 주소가 같으면 isActive=true => 선택된 메뉴로 표시
//  - nested=true: 그룹 안에 들어있는 하위 메뉴 (왼쪽 여백을 더 줌)
interface SidebarLinkProps {
  item: MenuItem
  collapsed: boolean
  nested?: boolean
}

function SidebarLink({ item, collapsed, nested = false }: SidebarLinkProps) {
  // 컴포넌트는 대문자로 시작해야 하므로 Icon 변수에 담아서 <Icon /> 으로 사용
  const Icon = item.icon

  return (
    <NavLink
      to={item.path}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        // 조건에 맞는 클래스 이름만 골라서 공백으로 이어 붙임 (false는 filter로 제거)
        ['sidebar-link', nested && 'is-nested', isActive && 'is-active', !item.ready && 'is-pending']
          .filter(Boolean)
          .join(' ')
      }
    >
      <Icon size={20} strokeWidth={1.8} className="sidebar-icon" />
      {!collapsed && <span className="sidebar-label">{item.label}</span>}
      {!collapsed && !item.ready && <span className="sidebar-badge">준비중</span>}
    </NavLink>
  )
}

//  * 그룹 메뉴 (제목을 누르면 하위 메뉴를 접고 펼침)
//  - 메뉴 전체가 접힌 상태(collapsed)에서는 그룹 제목 대신 구분선 + 하위 메뉴 아이콘만 표시
interface SidebarGroupProps {
  group: MenuGroup
  items: MenuItem[]
  collapsed: boolean
  open: boolean
  onToggle: () => void
}

function SidebarGroup({ group, items, collapsed, open, onToggle }: SidebarGroupProps) {
  const Icon = group.icon

  if (collapsed) {
    return (
      <div className="sidebar-group">
        <span className="sidebar-divider" aria-hidden="true" />
        {items.map((item) => (
          <SidebarLink key={item.key} item={item} collapsed />
        ))}
      </div>
    )
  }

  return (
    <div className="sidebar-group">
      <button
        type="button"
        className="sidebar-link sidebar-group-header"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Icon size={20} strokeWidth={1.8} className="sidebar-icon" />
        <span className="sidebar-label">{group.label}</span>
        {open ? (
          <ChevronUp size={16} className="sidebar-chevron" />
        ) : (
          <ChevronDown size={16} className="sidebar-chevron" />
        )}
      </button>
      {open && (
        <div className="sidebar-sublist">
          {items.map((item) => (
            <SidebarLink key={item.key} item={item} collapsed={false} nested />
          ))}
        </div>
      )}
    </div>
  )
}
