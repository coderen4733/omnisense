import {
  Bot,
  Database,
  LayoutDashboard,
  LayoutTemplate,
  Monitor,
  ScrollText,
  Server,
  Settings,
  UserRound,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

import type { UserRole } from '../api/types'
import { USER_MANAGER_ROLES } from './user'

//  * 좌측 메뉴(사이드바) 구성
//  - 메뉴를 추가/수정할 때는 이 파일만 고치면 사이드바, 현재 위치 표시(브레드크럼),
//    "준비중" 화면 연결까지 자동으로 반영됨
//  - ready: false => 아직 개발 전인 메뉴 ("준비중" 표시 + 준비중 화면으로 연결)
//  - roles: 이 메뉴를 볼 수 있는 권한 목록 (적지 않으면 모든 사용자에게 보임)

// 메뉴 1개 (클릭하면 화면 이동)
export interface MenuItem {
  key: string
  label: string
  path: string
  icon: LucideIcon
  description: string // 화면 제목 옆에 표시할 설명
  ready: boolean
  roles?: UserRole[]
}

// 메뉴 그룹 (클릭하면 하위 메뉴를 접고 펼침)
export interface MenuGroup {
  key: string
  label: string
  icon: LucideIcon
  children: MenuItem[]
}

export type MenuEntry = MenuItem | MenuGroup

// 메뉴 그룹인지 확인하는 함수 (children이 있으면 그룹)
//  - "entry is MenuGroup": true를 반환하면 TypeScript가 entry를 MenuGroup으로 인식함
export function isMenuGroup(entry: MenuEntry): entry is MenuGroup {
  return 'children' in entry
}

// 메인 메뉴 (샘플 디자인의 메뉴 구성)
export const MAIN_MENU: MenuEntry[] = [
  {
    key: 'dashboard',
    label: '대시보드',
    path: '/dashboard',
    icon: LayoutDashboard,
    description: '에이전트와 워크플로우의 실행 현황을 한눈에 확인합니다.',
    ready: false,
  },
  {
    key: 'workflows',
    label: '워크플로우',
    path: '/workflows',
    icon: Workflow,
    description: '드래그 앤 드롭으로 AI 에이전트 워크플로우를 설계하고 실행합니다.',
    ready: false,
  },
  {
    key: 'agents',
    label: '에이전트',
    path: '/agents',
    icon: Bot,
    description: 'LLM, 프롬프트, 도구를 조합해 업무별 AI 에이전트를 만들고 관리합니다.',
    ready: false,
  },
  {
    key: 'knowledge',
    label: '지식베이스 (RAG)',
    path: '/knowledge',
    icon: Database,
    description: '에이전트가 참고할 사내 문서를 등록하고 관리합니다.',
    ready: false,
  },
  {
    key: 'tools',
    label: '도구 연동',
    path: '/tools',
    icon: Wrench,
    description: 'MCP 서버를 연결해 에이전트가 사용할 외부 도구를 관리합니다.',
    ready: false,
  },
  {
    key: 'monitoring',
    label: '모니터링',
    path: '/monitoring',
    icon: Monitor,
    description: '실행 로그, 토큰 사용량, 응답 시간 등 운영 지표를 확인합니다.',
    ready: false,
  },
  {
    key: 'templates',
    label: '템플릿',
    path: '/templates',
    icon: LayoutTemplate,
    description: '자주 사용하는 워크플로우를 템플릿으로 저장하고 재사용합니다.',
    ready: false,
  },
  {
    key: 'settings',
    label: '설정',
    icon: Settings,
    children: [
      {
        key: 'users',
        label: '사용자·권한 관리',
        path: '/settings/users',
        icon: Users,
        description: '사용자 계정의 권한 및 활성화 상태를 관리합니다.',
        ready: true,
        roles: USER_MANAGER_ROLES,
      },
      {
        key: 'system',
        label: '시스템 상태',
        path: '/settings/system',
        icon: Server,
        description: 'DB, Vector DB, LLM 등 연결된 시스템의 상태를 확인합니다.',
        ready: false,
      },
      {
        key: 'audit-logs',
        label: '감사 로그',
        path: '/settings/audit-logs',
        icon: ScrollText,
        description: '누가, 언제, 무엇을 변경했는지 기록을 확인합니다.',
        ready: false,
      },
    ],
  },
]

// 사이드바 맨 아래에 고정되는 "내 계정" 메뉴
export const ACCOUNT_MENU: MenuItem = {
  key: 'account',
  label: '내 계정',
  path: '/account',
  icon: UserRound,
  description: '내 계정 정보를 확인하고 비밀번호를 변경합니다.',
  ready: true,
}

// 그룹 안의 메뉴까지 모두 꺼내서 한 줄로 펼친 목록
export const ALL_MENU_ITEMS: MenuItem[] = MAIN_MENU.flatMap((entry) =>
  isMenuGroup(entry) ? entry.children : [entry],
)

// 아직 개발 전인 메뉴 목록 (App.tsx에서 "준비중" 화면을 연결할 때 사용)
export const COMING_SOON_MENUS: MenuItem[] = ALL_MENU_ITEMS.filter((item) => !item.ready)

// 내 권한으로 이 메뉴를 볼 수 있는지 확인
export function canAccessMenu(item: MenuItem, role: UserRole | undefined): boolean {
  if (!item.roles) {
    return true
  }
  return role !== undefined && item.roles.includes(role)
}

// 현재 주소가 메뉴 주소와 같거나, 그 아래 주소인지 확인 (예: /workflows/3 => /workflows)
function isPathMatch(menuPath: string, pathname: string): boolean {
  return pathname === menuPath || pathname.startsWith(`${menuPath}/`)
}

//  * 현재 주소에 해당하는 "메뉴 이름 경로" 찾기 (헤더의 현재 위치 표시에 사용)
//  - 예) "/settings/users" => ["설정", "사용자·권한 관리"]
//  - 예) "/dashboard"      => ["대시보드"]
export function findMenuTrail(pathname: string): string[] {
  for (const entry of MAIN_MENU) {
    if (isMenuGroup(entry)) {
      const child = entry.children.find((item) => isPathMatch(item.path, pathname))
      if (child) {
        return [entry.label, child.label]
      }
    } else if (isPathMatch(entry.path, pathname)) {
      return [entry.label]
    }
  }
  if (isPathMatch(ACCOUNT_MENU.path, pathname)) {
    return [ACCOUNT_MENU.label]
  }
  return []
}
