import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { useLocation } from 'react-router-dom'

import { findMenuTrail } from '../../constants/menu'

//  * 현재 위치 표시 (브레드크럼) - 예) 설정 > 사용자·권한 관리
//  - 현재 주소(pathname)로 메뉴 설정(constants/menu.ts)에서 메뉴 이름을 찾아서 표시
//  - 마지막 항목(현재 화면)은 진하게 표시
export default function Breadcrumb() {
  const { pathname } = useLocation()
  const trail = findMenuTrail(pathname)

  return (
    <nav className="breadcrumb" aria-label="현재 위치">
      {trail.map((label, index) => {
        const isLast = index === trail.length - 1
        return (
          // Fragment: 화면에 아무 태그도 추가하지 않고 여러 요소를 묶어주는 React 기능
          <Fragment key={label}>
            {index > 0 && <ChevronRight size={16} className="breadcrumb-sep" aria-hidden="true" />}
            <span
              className={isLast ? 'breadcrumb-current' : undefined}
              aria-current={isLast ? 'page' : undefined}
            >
              {label}
            </span>
          </Fragment>
        )
      })}
    </nav>
  )
}
