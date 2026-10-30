import { clearTokens, getAccessToken, getRefreshToken, setAccessToken } from '../utils/token'
import type { ApiResponse, ReTokenResponse } from './types'

//  * 백엔드 서버 주소
//  - .env의 VITE_API_BASE_URL 값을 사용 (예: http://localhost:8000)
//  - 값이 없으면 ''(빈 문자열) => 프론트엔드와 같은 주소로 요청
//  - .replace(/\/$/, ''): 주소 끝에 / 가 붙어 있으면 제거 (주소가 "//auth" 처럼 되는 것 방지)
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

//  * 로그인이 풀렸을 때(토큰 재발급 실패) 앱 전체에 알리는 이벤트 이름
//  - AuthContext가 이 이벤트를 듣고 있다가 로그인 화면으로 보내줌
export const AUTH_EXPIRED_EVENT = 'omnisense:auth-expired'

//  * API 요청 실패 시 발생시키는 에러
//  - status: HTTP 상태 코드 (예: 400, 401, 403 / 서버 연결 실패는 0)
//  - message: 화면에 그대로 보여줄 수 있는 한국어 메시지 (백엔드의 detail 값)
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// 어떤 에러든 화면에 보여줄 메시지로 바꿔주는 함수 (catch 블록에서 사용)
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  return '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
}

// 쿼리 파라미터(주소 뒤 ?a=1&b=2 부분)에 넣을 수 있는 값의 타입
type QueryValue = string | number | boolean | undefined | null

// request() 함수의 옵션
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown // JSON으로 보낼 데이터
  query?: Record<string, QueryValue> // 쿼리 파라미터
  auth?: boolean // true(기본값): 요청 헤더에 액세스 토큰을 붙임 / false: 로그인 전 API(로그인, 회원가입)
}

//  * 요청 주소 만들기
//  - 예) buildUrl('/users/', { page: 2, email: '' }) => "http://localhost:8000/users/?page=2"
//  - 값이 비어있는(undefined, null, '') 쿼리는 보내지 않음 => 백엔드 기본값이 적용됨
function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    params.append(key, String(value))
  }
  const queryString = params.toString()
  return `${API_BASE_URL}${path}${queryString ? `?${queryString}` : ''}`
}

//  * 실패 응답에서 에러 메시지 꺼내기
//  - FastAPI의 에러 응답 형식은 2가지
//    1) HTTPException      : { "detail": "이미 존재하는 email입니다." }
//    2) 입력값 검사 실패(422): { "detail": [{ "msg": "...", ... }] } (영어 메시지)
async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (typeof body?.detail === 'string') {
      return body.detail
    }
    if (Array.isArray(body?.detail)) {
      return '입력값을 다시 확인해 주세요.'
    }
  } catch {
    // 응답이 JSON 형식이 아닌 경우 (예: 서버 내부 오류 페이지) => 아래 기본 메시지 사용
  }
  return `요청을 처리하지 못했습니다. (오류 코드: ${response.status})`
}

//  * 액세스 토큰 재발급
//  - 여러 API가 동시에 401을 받아도 재발급 요청은 "한 번만" 보내도록,
//    진행 중인 재발급 작업(Promise)을 변수에 저장해 두고 함께 기다림
//  - 반환값: 재발급 성공 여부 (true / false)
let refreshPromise: Promise<boolean> | null = null

function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise
  }
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      return false
    }
    try {
      const response = await fetch(buildUrl('/auth/re-token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!response.ok) {
        return false
      }
      const body = (await response.json()) as ApiResponse<ReTokenResponse>
      if (!body.data) {
        return false
      }
      setAccessToken(body.data.access_token)
      return true
    } catch {
      return false
    }
  })().finally(() => {
    // 재발급이 끝나면(성공/실패 모두) 다음 재발급을 위해 비워둠
    refreshPromise = null
  })
  return refreshPromise
}

//  * 모든 API 요청에서 공통으로 사용하는 함수
//  - 백엔드 응답 { message, data } 중에서 data만 꺼내서 돌려줌
//  - 실패하면 ApiError를 발생시킴 => 호출하는 쪽에서 try/catch로 처리
//  - <T>: 돌려받을 data의 타입 (예: request<User>('/users/me'))
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true } = options

  // 1. 실제로 요청을 보내는 함수 (토큰 재발급 후 한 번 더 보낼 수 있도록 함수로 만듦)
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    if (auth) {
      const accessToken = getAccessToken()
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`
      }
    }
    try {
      return await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch {
      // fetch 자체가 실패 = 서버에 연결하지 못함 (백엔드 꺼짐, 주소 오류, 네트워크 끊김 등)
      throw new ApiError(0, '서버에 연결할 수 없습니다. 백엔드 서버 상태를 확인해 주세요.')
    }
  }

  // 2. 요청 보내기
  let response = await send()

  // 3. 401(로그인 필요) => 액세스 토큰이 만료되었을 수 있으므로 재발급 후 한 번 더 요청
  if (response.status === 401 && auth) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      response = await send()
    }
    // 3-1. 재발급에 실패했거나, 다시 보내도 401이면 => 로그인이 풀린 것으로 처리
    if (response.status === 401) {
      clearTokens()
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    }
  }

  // 4. 실패 응답(200번대가 아님) => 에러 발생
  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response))
  }

  // 5. 성공 응답 => data만 꺼내서 돌려줌
  const json = (await response.json()) as ApiResponse<T>
  return json.data as T
}
