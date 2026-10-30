//  * 제품 심볼 (빨간 박스 안의 흰색 "OS" 글자)
//  - 헤더에서 글자 로고(UNION OmniSense) 앞에 항상 붙어 있고, 메뉴를 접으면 이 심볼만 남음
//  - 이미지 파일 대신 글자로 만들어서 어떤 크기/해상도에서도 선명하고, 다크 모드에서도 그대로 잘 보임
//  - 공식 로고가 정해지면 이 컴포넌트만 바꾸면 됨 (현재는 내부 개발용 임시 심볼)
//  - aria-hidden: 바로 옆 글자 로고에 이미 제품 이름이 있으므로 화면 낭독기가 "OS"를 따로 읽지 않게 함

// [수정] * 심볼 크기 선택(size) 기능 추가 [2026-10-28 17:57]
// [기존] 헤더용 크기(36px) 한 가지만 있었습니다.
// [변경] size: 'md'(헤더용, 기본값 36px) / 'lg'(로그인 화면용 52px) 중에서 고를 수 있습니다.
//        (Logo 컴포넌트의 size와 같은 방식)
interface LogoMarkProps {
  size?: 'md' | 'lg'
}

export default function LogoMark({ size = 'md' }: LogoMarkProps) {
  return (
    <span className={`logo-mark logo-mark-${size}`} aria-hidden="true">
      OS
    </span>
  )
}
