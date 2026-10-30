import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

//  * 폰트: Pretendard (npm 패키지로 설치 => 빌드 결과에 폰트 파일이 포함됨, 폐쇄망 대비)
//  - variable: 굵기(100~900)를 파일 하나로 표현하는 가변 폰트
//  - dynamic-subset: 글자를 여러 조각 파일로 나눠서, 화면에 실제로 쓰인 글자 조각만 내려받음
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'

// 스타일 (순서 중요: 공통 => 레이아웃 => 화면별)
import './styles/global.css'
import './styles/layout.css'
import './styles/auth.css'
import './styles/pages.css'

import App from './App'

//  * React 앱 시작점
//  - index.html의 <div id="root"> 안에 App 컴포넌트를 그림
//  - StrictMode: 개발 중에만 동작하는 검사 모드 (잠재적인 문제를 찾기 위해 일부 코드를 두 번 실행함)
//  - "!": root 요소가 반드시 있다고 TypeScript에게 알려줌 (index.html에 항상 있음)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
