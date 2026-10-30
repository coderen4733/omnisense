import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { signIn, signOut } from '../api/auth'
import { AUTH_EXPIRED_EVENT } from '../api/client'
import type { User } from '../api/types'
import { getMe } from '../api/users'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '../utils/token'

//  * 로그인 상태를 앱 전체에서 함께 쓰기 위한 Context
//  - Context: 여러 컴포넌트가 props를 일일이 넘기지 않고도 같은 값을 꺼내 쓸 수 있게 해주는 React 기능
//  - 사용법: const { user, login, logout } = useAuth()

// 로그인 상태
//  - loading         : 저장된 토큰으로 로그인 상태를 확인하는 중 (앱을 처음 열었을 때)
//  - authenticated   : 로그인됨
//  - unauthenticated : 로그인 안 됨
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  user: User | null // 로그인한 사용자 정보 (로그인 전에는 null)
  status: AuthStatus
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  // 1. 앱을 처음 열었을 때: 저장된 토큰이 있으면 내 정보를 불러와서 로그인 상태 복구
  useEffect(() => {
    // ignore: 화면이 사라진 뒤에 응답이 도착하면 상태를 바꾸지 않기 위한 표시
    let ignore = false

    async function restoreSession() {
      // 1-1. 토큰이 하나도 없으면 => 로그인 안 된 상태
      if (!getAccessToken() && !getRefreshToken()) {
        setStatus('unauthenticated')
        return
      }
      // 1-2. 토큰이 있으면 => 내 정보 조회 (액세스 토큰이 만료됐으면 client.ts가 자동 재발급)
      try {
        const me = await getMe()
        if (!ignore) {
          setUser(me)
          setStatus('authenticated')
        }
      } catch {
        if (!ignore) {
          setUser(null)
          setStatus('unauthenticated')
        }
      }
    }

    restoreSession()
    return () => {
      ignore = true
    }
  }, [])

  // 2. 토큰 재발급에 실패하면(client.ts가 이벤트 발생) => 로그아웃 상태로 전환
  useEffect(() => {
    const handleExpired = () => {
      setUser(null)
      setStatus('unauthenticated')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired)
    // return: 컴포넌트가 사라질 때 이벤트 듣기를 중단 (메모리 누수 방지)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired)
  }, [])

  // 3. 로그인: 토큰 발급 => 토큰 저장 => 내 정보 조회
  const login = async (email: string, password: string) => {
    const tokens = await signIn(email, password)
    setTokens(tokens.access_token, tokens.refresh_token)
    try {
      const me = await getMe()
      setUser(me)
      setStatus('authenticated')
    } catch (error) {
      // 내 정보 조회에 실패하면 저장한 토큰도 지우고 에러를 로그인 화면으로 전달
      clearTokens()
      throw error
    }
  }

  // 4. 로그아웃: 화면은 바로 로그아웃 처리하고, 서버의 리프레시 토큰 삭제는 그다음에 요청
  const logout = async () => {
    const refreshToken = getRefreshToken()
    clearTokens()
    setUser(null)
    setStatus('unauthenticated')
    if (refreshToken) {
      try {
        await signOut(refreshToken)
      } catch {
        // 이미 만료된 토큰이면 서버에서 에러가 날 수 있지만, 화면은 이미 로그아웃되었으므로 무시
      }
    }
  }

  return (
    <AuthContext.Provider value={{ user, status, login, logout }}>{children}</AuthContext.Provider>
  )
}

// 로그인 상태 꺼내 쓰기
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    // AuthProvider 바깥에서 useAuth()를 호출한 경우 (코드 배치 실수)
    throw new Error('useAuth()는 AuthProvider 안에서만 사용할 수 있습니다.')
  }
  return context
}
