import { Eye, EyeOff, Lock } from 'lucide-react'
import { useState, type InputHTMLAttributes } from 'react'

//  * 비밀번호 입력창 (눈 아이콘을 누르면 입력한 비밀번호를 보여주거나 숨김)
//  - type을 제외한 <input>의 모든 속성(value, onChange, placeholder 등)을 그대로 받음
//    (Omit<A, 'type'>: A 타입에서 type 속성만 뺀 타입)

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>

export default function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="input-with-icon">
      <Lock size={18} className="input-icon" aria-hidden="true" />
      <input {...props} type={visible ? 'text' : 'password'} className="input has-action" />
      <button
        type="button"
        className="input-action"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}
