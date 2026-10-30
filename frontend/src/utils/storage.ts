//  * localStorage(브라우저 저장소)를 안전하게 사용하는 함수 모음
//  - localStorage: 브라우저를 껐다 켜도 남아있는 작은 저장 공간 (키-값 모두 문자열)
//  - 개인정보 보호 모드나 브라우저 설정에 따라 사용이 막혀 있으면 에러가 날 수 있음
//    => try/catch로 감싸서, 저장소를 못 쓰더라도 앱은 정상 동작하도록 함

// 값 읽기 (값이 없거나 읽기에 실패하면 null)
export function getStorageItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

// 값 저장
export function setStorageItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 저장에 실패해도 앱 동작에는 문제가 없으므로 무시
  }
}

// 값 삭제
export function removeStorageItem(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // 삭제에 실패해도 앱 동작에는 문제가 없으므로 무시
  }
}
