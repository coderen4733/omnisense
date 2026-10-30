//  * 앱 전체에서 사용하는 기본 정보
export const APP_SUBTITLE = 'AI Agent Orchestration Platform'

// 제품을 만든 회사 이름 (로그인 화면 저작권 표시에 사용)
export const COMPANY_NAME = 'UNION'

// 헤더 사용자 영역에 표시할 조직(고객사) 이름 (예: "관리자 · UNION")
//  - 고객사에 납품할 때는 이 값만 고객사 이름으로 바꾸면 됨
export const ORGANIZATION_NAME = 'UNION'

//  * localStorage(브라우저 저장소)에 저장할 때 사용하는 키 이름 모음
//  - 키 이름을 한 곳에서 관리해서 오타로 인한 버그를 막음
//  - theme 키는 index.html 의 스크립트에서도 같은 이름을 사용함
export const STORAGE_KEYS = {
  theme: 'omnisense-theme',
  sidebarCollapsed: 'omnisense-sidebar-collapsed',
  accessToken: 'omnisense-access-token',
  refreshToken: 'omnisense-refresh-token',
} as const
