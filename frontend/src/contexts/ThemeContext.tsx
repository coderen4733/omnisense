import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { STORAGE_KEYS } from '../constants/app'
import { getStorageItem, setStorageItem } from '../utils/storage'

//  * 라이트/다크 모드를 앱 전체에서 함께 쓰기 위한 Context
//  - 테마는 <html data-theme="light|dark"> 속성으로 적용됨
//    => styles/global.css 에서 [data-theme='dark'] 일 때 색상 변수를 바꿔서 전체 색이 바뀜
//  - 사용법: const { theme, toggleTheme } = useTheme()

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

//  * 처음 테마 정하기
//  - index.html 스크립트가 이미 <html>에 테마를 적용해 두었으므로 그 값을 그대로 사용
//  - 혹시 값이 없으면: 저장된 값 => 운영체제(OS) 설정 순서로 결정
function getInitialTheme(): Theme {
  const applied = document.documentElement.dataset.theme
  if (applied === 'light' || applied === 'dark') {
    return applied
  }
  const saved = getStorageItem(STORAGE_KEYS.theme)
  if (saved === 'light' || saved === 'dark') {
    return saved
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // useState(함수): 처음 한 번만 함수를 실행해서 초기값을 정함
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  // 테마가 바뀔 때마다 <html>에 적용하고 브라우저에 저장 (새로고침해도 유지)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    setStorageItem(STORAGE_KEYS.theme, theme)
  }, [theme])

  // 라이트 <=> 다크 전환
  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

// 테마 꺼내 쓰기
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme()는 ThemeProvider 안에서만 사용할 수 있습니다.')
  }
  return context
}
