import type { ReactNode } from 'react'

import { COMPANY_NAME } from '../../constants/app'
import Logo from '../common/Logo'
import LogoMark from '../common/LogoMark'
import ThemeToggle from '../common/ThemeToggle'

//  * 로그인 전 화면(로그인, 회원가입)의 공통 틀
//  - 가운데 카드 + 위쪽 로고 + 오른쪽 위 다크모드 버튼 + 아래쪽 저작권 표시
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-theme-toggle">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        {/* [수정] * 로그인 화면 로고 앞에 OS 심볼 추가 [2026-10-28 17:57]
            [기존] 글자 로고(UNION OmniSense)만 표시했습니다.
            [변경] 헤더와 똑같이 "OS 심볼 + 글자 로고"를 나란히 표시합니다. (모바일에서는 위아래로 쌓음) */}
        <div className="auth-brand">
          <LogoMark size="lg" />
          <Logo size="lg" />
        </div>
        {children}
      </div>
      <p className="auth-copyright">
        © {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.
      </p>
    </div>
  )
}
