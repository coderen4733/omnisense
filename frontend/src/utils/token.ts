import { STORAGE_KEYS } from '../constants/app'
import { getStorageItem, removeStorageItem, setStorageItem } from './storage'

//  * 로그인 토큰 보관 함수 모음
//  - 액세스 토큰: API를 요청할 때마다 "로그인한 사용자"임을 증명 (유효기간이 짧음, 기본 30분)
//  - 리프레시 토큰: 액세스 토큰이 만료되면 새 액세스 토큰을 받을 때 사용 (기본 1일)
//  - ⚠️ localStorage는 자바스크립트로 읽을 수 있으므로, 외부에서 받은 HTML을 화면에 그대로 넣는
//    코드(dangerouslySetInnerHTML 등)는 쓰지 않아야 함 (XSS 공격으로 토큰이 유출될 수 있음)

// 액세스 토큰 꺼내기
export function getAccessToken(): string | null {
  return getStorageItem(STORAGE_KEYS.accessToken)
}

// 리프레시 토큰 꺼내기
export function getRefreshToken(): string | null {
  return getStorageItem(STORAGE_KEYS.refreshToken)
}

// 로그인 성공 시 두 토큰을 함께 저장
export function setTokens(accessToken: string, refreshToken: string): void {
  setStorageItem(STORAGE_KEYS.accessToken, accessToken)
  setStorageItem(STORAGE_KEYS.refreshToken, refreshToken)
}

// 토큰 재발급 시 액세스 토큰만 교체
export function setAccessToken(accessToken: string): void {
  setStorageItem(STORAGE_KEYS.accessToken, accessToken)
}

// 로그아웃 시 두 토큰 모두 삭제
export function clearTokens(): void {
  removeStorageItem(STORAGE_KEYS.accessToken)
  removeStorageItem(STORAGE_KEYS.refreshToken)
}
