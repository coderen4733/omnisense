import { ChevronDown } from 'lucide-react'

//  * 선택 상자 (예: "모든 권한 ▾", "최신 가입순 ▾")
//  - 브라우저 기본 <select>를 사용하고 모양만 꾸밈 (키보드 조작, 모바일 지원이 자동으로 됨)
//  - <T extends string>: 선택지 값의 타입을 사용하는 쪽에서 정함 (예: 'admin' | 'user')

export interface SelectOption<T extends string> {
  value: T
  label: string
}

interface SelectBoxProps<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string // 화면에 글자 라벨이 없으므로 화면 낭독기용 이름을 꼭 지정
  className?: string
}

export default function SelectBox<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SelectBoxProps<T>) {
  return (
    <div className={className ? `select-wrap ${className}` : 'select-wrap'}>
      <select
        className="input select"
        value={value}
        // e.target.value는 string 타입이므로 as T 로 "선택지 값 중 하나"라고 알려줌
        onChange={(event) => onChange(event.target.value as T)}
        aria-label={ariaLabel}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} className="select-icon" aria-hidden="true" />
    </div>
  )
}
