import { useLayoutEffect, useRef } from 'react'

import { APP_SUBTITLE } from '../../constants/app'

//  * 제품 로고 (UNION OmniSense)
//  - UNION 중 "IO" 두 글자만 빨간색, 나머지 글자는 검정색(다크 모드에서는 흰색)
//  - 로고 바로 아래에 "AI Agent Orchestration Platform" 문구 표시 (보라색)
//  - size: 'md'(헤더용, 기본값) / 'lg'(로그인 화면용, 가운데 정렬)

interface LogoProps {
  size?: 'md' | 'lg'
}

export default function Logo({ size = 'md' }: LogoProps) {
  // useRef: 실제 HTML 요소(로고 글자, 아래 문구)의 폭을 재기 위한 참조
  const titleRef = useRef<HTMLDivElement>(null)
  const subtitleRef = useRef<HTMLDivElement>(null)

  // [수정] * 로고 아래 문구를 로고 양끝에 맞추는 기능 추가 [2026-10-28 17:35]
  // [기존] 문구가 원래 글자 간격 그대로 표시되어, 로고(UNION OmniSense)와 길이가 달랐습니다.
  // [변경] 로고 폭을 재서 문구의 글자 간격(letter-spacing)을 자동으로 조절합니다.
  //        => "AI"의 A는 로고 왼쪽 끝, "Platform"의 m은 로고 오른쪽 끝에 딱 맞춰집니다.
  //  * 글자 간격 계산 방법
  //  - useLayoutEffect: 화면에 그리기 "직전"에 실행 => 간격이 바뀌는 모습이 눈에 보이지 않음
  //  - ResizeObserver: 로고 글자의 폭이 바뀔 때마다 다시 계산
  //    (폰트 파일이 늦게 도착해서 글자 폭이 바뀌는 경우, 화면 크기에 따라 글자 크기가 바뀌는 경우)
  useLayoutEffect(() => {
    const title = titleRef.current
    const subtitle = subtitleRef.current
    if (!title || !subtitle) {
      return
    }

    const fitSubtitle = () => {
      // 1. 간격을 0으로 되돌린 뒤 로고와 문구의 원래 폭을 잼
      subtitle.style.letterSpacing = '0px'
      subtitle.style.marginRight = '0px'
      const titleWidth = title.getBoundingClientRect().width
      const subtitleWidth = subtitle.getBoundingClientRect().width
      // 문구가 숨겨져 있으면(모바일 화면) 폭이 0 => 계산하지 않음
      if (titleWidth === 0 || subtitleWidth === 0) {
        return
      }
      // 2. 로고와의 폭 차이를 "글자 사이 간격 수"로 나눔
      //  - 예) 글자 31개 => 사이 간격 30개
      //  - 문구가 로고보다 길면 결과가 음수 => 간격이 좁아짐
      const spacing = (titleWidth - subtitleWidth) / (APP_SUBTITLE.length - 1)
      // 3. 계산한 간격 적용
      subtitle.style.letterSpacing = `${spacing}px`
      //  - 브라우저는 마지막 글자 뒤에도 간격을 한 번 더 붙이므로,
      //    그만큼 오른쪽 여백을 빼서 문구 전체 폭이 로고 폭과 같아지도록 함
      subtitle.style.marginRight = `${-spacing}px`
    }

    fitSubtitle()
    const observer = new ResizeObserver(fitSubtitle)
    observer.observe(title)
    // 로고가 화면에서 사라지면 폭 감시를 중단 (메모리 누수 방지)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={`logo logo-${size}`}>
      {/* aria-label: 화면 낭독기가 글자를 쪼개 읽지 않고 "UNION OmniSense"로 읽도록 함 */}
      <div ref={titleRef} className="logo-title" aria-label="UNION OmniSense">
        <span aria-hidden="true">UN</span>
        <span className="logo-accent" aria-hidden="true">
          IO
        </span>
        <span aria-hidden="true">N</span>
        <span className="logo-product" aria-hidden="true">
          OmniSense
        </span>
      </div>
      <div ref={subtitleRef} className="logo-subtitle">
        {APP_SUBTITLE}
      </div>
    </div>
  )
}
