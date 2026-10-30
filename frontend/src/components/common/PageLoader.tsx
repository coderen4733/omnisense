import { LoaderCircle } from 'lucide-react'

//  * 화면 전체 로딩 표시 (앱을 처음 열어 로그인 상태를 확인하는 동안 사용)
export default function PageLoader() {
  return (
    <div className="page-loader" role="status">
      <LoaderCircle size={28} className="spin" aria-hidden="true" />
      <span>불러오는 중...</span>
    </div>
  )
}
