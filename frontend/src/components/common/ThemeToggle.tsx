import { Moon, Sun } from 'lucide-react'

import { useTheme } from '../../contexts/ThemeContext'

//  * 라이트/다크 모드 전환 버튼 (헤더, 로그인 화면에서 사용)
//  - 라이트 모드일 때는 달(🌙) 아이콘, 다크 모드일 때는 해(☀️) 아이콘을 보여줌
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const label = isDark ? '라이트 모드로 전환' : '다크 모드로 전환'

  return (
    <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={label} title={label}>
      {isDark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  )
}
