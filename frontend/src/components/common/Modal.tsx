import { X } from 'lucide-react'
import { useEffect, useId, type ReactNode } from 'react'

//  * 화면 가운데에 뜨는 팝업 창(모달)
//  - open=false면 아무것도 그리지 않음
//  - 닫기: X 버튼 / ESC 키 / 바깥(어두운 배경) 클릭
//  - footer: 아래쪽 버튼 영역 (예: 취소, 저장)

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export default function Modal({ open, title, onClose, children, footer }: ModalProps) {
  // useId: 제목과 팝업을 연결하기 위한 고유 id 생성 (화면 낭독기가 팝업 제목을 읽어줌)
  const titleId = useId()

  // 팝업이 열려 있을 때 ESC 키를 누르면 닫기
  useEffect(() => {
    if (!open) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <div
      className="modal-overlay"
      // 어두운 배경 자체를 눌렀을 때만 닫기 (팝업 안쪽을 누른 경우는 제외)
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
