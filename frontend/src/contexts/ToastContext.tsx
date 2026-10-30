import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { createContext, useContext, useRef, useState, type ReactNode } from 'react'

//  * 화면 오른쪽 아래에 잠깐 나타났다 사라지는 알림(토스트) 메시지
//  - 사용법: const { showToast } = useToast()
//            showToast('저장되었습니다.')            => 성공(초록)
//            showToast('실패했습니다.', 'error')     => 실패(빨강)

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  type: ToastType
  message: string
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

// 알림이 화면에 머무르는 시간 (단위: 밀리초, 3000 = 3초)
const TOAST_DURATION = 3000

// 알림 종류별 아이콘
const TOAST_ICONS = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  // 알림마다 겹치지 않는 번호를 붙이기 위한 카운터
  //  - useRef: 값이 바뀌어도 화면을 다시 그리지 않는 "기억 상자"
  const nextId = useRef(1)

  const showToast = (message: string, type: ToastType = 'success') => {
    const id = nextId.current++
    // 1. 알림 추가
    setToasts((prev) => [...prev, { id, type, message }])
    // 2. 정해진 시간이 지나면 해당 알림만 삭제
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, TOAST_DURATION)
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* aria-live: 화면 낭독기(시각장애인용 프로그램)가 새 알림을 읽어주도록 함 */}
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = TOAST_ICONS[toast.type]
          return (
            <div key={toast.id} className={`toast toast-${toast.type}`} role="status">
              <Icon size={18} className="toast-icon" />
              <span>{toast.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

// 알림 함수 꺼내 쓰기
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast()는 ToastProvider 안에서만 사용할 수 있습니다.')
  }
  return context
}
