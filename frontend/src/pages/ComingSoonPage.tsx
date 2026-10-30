import PageHeader from '../components/common/PageHeader'
import type { MenuItem } from '../constants/menu'

//  * 아직 개발 전인 메뉴의 임시 화면 ("준비 중인 기능입니다")
//  - 메뉴 설정(constants/menu.ts)에서 ready: false 인 메뉴는 자동으로 이 화면에 연결됨
//  - 기능을 개발하면 해당 메뉴를 ready: true 로 바꾸고 App.tsx에 실제 화면을 연결할 것
export default function ComingSoonPage({ item }: { item: MenuItem }) {
  const Icon = item.icon

  return (
    <div className="page">
      <PageHeader title={item.label} description={item.description} />
      <section className="card coming-soon">
        <div className="coming-soon-icon">
          <Icon size={30} strokeWidth={1.8} />
        </div>
        <h2 className="coming-soon-title">준비 중인 기능입니다</h2>
        <p className="coming-soon-desc">더 나은 서비스를 위해 열심히 개발하고 있습니다.</p>
      </section>
    </div>
  )
}
