import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

//  * 알약(pill) 모양 드롭다운 (사용자 목록 표의 "사용자 ▾", "활성화 ▾")
//  - 클릭하면 선택지 메뉴가 열리고, 다른 값을 고르면 onChange가 호출됨
//  - editable=false: 변경할 수 없는 경우(예: 내 계정) => 화살표 없이 알약만 표시
//
// 📌 메뉴 위치를 position: fixed(화면 기준)로 정하는 이유
//  - 표는 가로 스크롤을 위해 overflow가 걸려 있어서, 메뉴를 표 안에 두면 아래쪽 행의 메뉴가 잘림
//  - 버튼의 화면 위치(getBoundingClientRect)를 계산해서 그 바로 아래에 메뉴를 띄움
//  - 대신 스크롤하면 위치가 어긋나므로, 스크롤/화면 크기 변경 시 메뉴를 닫음

// 알약 색상 종류 (styles/global.css 의 .pill-gray, .pill-blue ... 와 연결)
export type PillTone = 'gray' | 'blue' | 'red' | 'green' | 'orange'

export interface PillOption<T extends string> {
  value: T
  label: string
  tone: PillTone
}

interface PillSelectProps<T extends string> {
  value: T
  options: PillOption<T>[]
  onChange: (value: T) => void
  editable?: boolean // false면 변경 불가 (기본값 true)
  disabled?: boolean // 변경 요청을 처리하는 동안 잠시 막을 때
  ariaLabel?: string
}

export default function PillSelect<T extends string>({
  value,
  options,
  onChange,
  editable = true,
  disabled = false,
  ariaLabel,
}: PillSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  // useRef: 실제 HTML 요소(버튼, 메뉴)를 가리키기 위한 참조
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 현재 값에 해당하는 선택지 (못 찾으면 첫 번째 선택지)
  const current = options.find((option) => option.value === value) ?? options[0]

  // 메뉴가 열려 있을 때만: 바깥 클릭 / ESC 키 / 스크롤 / 화면 크기 변경 => 메뉴 닫기
  useEffect(() => {
    if (!open) {
      return
    }
    const close = () => setOpen(false)
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      // 메뉴나 버튼 안을 클릭한 경우는 닫지 않음
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return
      }
      close()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    // true: 페이지 안의 모든 스크롤(표 가로 스크롤 포함)을 감지
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // 변경할 수 없는 경우 => 알약만 표시
  if (!editable) {
    return <span className={`pill pill-${current.tone}`}>{current.label}</span>
  }

  // 버튼 클릭 => 메뉴 위치 계산 후 열기 (이미 열려 있으면 닫기)
  const handleToggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPosition({ top: rect.bottom + 6, left: rect.left + rect.width / 2 })
    }
    setOpen((prev) => !prev)
  }

  // 선택지 클릭 => 메뉴 닫고, 다른 값을 골랐을 때만 onChange 호출
  const handleSelect = (nextValue: T) => {
    setOpen(false)
    if (nextValue !== value) {
      onChange(nextValue)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`pill pill-${current.tone} is-clickable`}
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {current.label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="pill-menu"
          role="listbox"
          style={{ top: position.top, left: position.left }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="pill-menu-item"
              onClick={() => handleSelect(option.value)}
            >
              <span className={`pill pill-${option.tone}`}>{option.label}</span>
              {option.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
