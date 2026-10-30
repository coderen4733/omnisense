import type { ReactNode } from 'react'

//  * 화면 맨 위의 제목 영역 (예: "사용자·권한 관리  사용자 계정의 권한 및 ...")
//  - title: 화면 제목 / description: 제목 옆 설명 / actions: 오른쪽 버튼 영역(선택)

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-heading">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}
