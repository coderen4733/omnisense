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

// request() / fetchWithAuth() 함수의 옵션
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown // JSON으로 보낼 데이터
  query?: Record<string, QueryValue> // 쿼리 파라미터
  auth?: boolean // true(기본값): 요청 헤더에 액세스 토큰을 붙임 / false: 로그인 전 API(로그인, 회원가입)
  // 요청 중단 신호 - 테스트 대화의 "중지" 버튼에서 사용
  //  - AbortController로 만든 signal을 넘기면, controller.abort() 호출 시 요청이 즉시 취소됨
  signal?: AbortSignal
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
//  * export - 스트리밍 API(api/llm.ts)에서도 같은 방식으로 에러 메시지를 꺼내기 위함
export async function parseErrorMessage(response: Response): Promise<string> {
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

//  * 토큰 첨부 + 자동 재발급 부분을 fetchWithAuth()로 분리
//  * 앞부분(요청 + 토큰 재발급)을 fetchWithAuth()로 분리해서, 응답(Response)을 그대로 돌려줌
//    => 테스트 대화처럼 JSON이 아니라 "조각조각 오는 응답(스트리밍)"도 같은 로그인 처리를 쓸 수 있음
//       request()는 fetchWithAuth()를 호출한 뒤 data만 꺼내므로 사용법은 그대로
//  * 로그인 토큰을 붙여서 요청하고, 응답(Response)을 그대로 돌려주는 함수
//  - 401(로그인 필요)이면 토큰 재발급 후 한 번 더 요청함
//  - 응답 상태(성공/실패) 확인은 호출하는 쪽에서 함
export async function fetchWithAuth(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', body, query, auth = true, signal } = options

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
        signal,
      })
    } catch (error) {
      // 사용자가 직접 중단한 경우(중지 버튼) => 원래 에러(AbortError)를 그대로 전달
      if (signal?.aborted) {
        throw error
      }
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

  return response
}

//  * 모든 API 요청에서 공통으로 사용하는 함수
//  - 백엔드 응답 { message, data } 중에서 data만 꺼내서 돌려줌
//  - 실패하면 ApiError를 발생시킴 => 호출하는 쪽에서 try/catch로 처리
//  - <T>: 돌려받을 data의 타입 (예: request<User>('/users/me'))
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // 1~3. 요청 보내기 (+ 필요하면 토큰 재발급 후 재요청)
  const response = await fetchWithAuth(path, options)

  // 4. 실패 응답(200번대가 아님) => 에러 발생
  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response))
  }

  // 5. 성공 응답 => data만 꺼내서 돌려줌
  const json = (await response.json()) as ApiResponse<T>
  return json.data as T
}

//  * 스트리밍(SSE) 응답 읽기를 공통 함수로
//  - 스트리밍(SSE) API 요청 시 답변이 한 번에 오지 않고 조각조각 올 때 사용
//  - 조각(이벤트)이 올 때마다 onEvent를 호출함
//    서버가 보내는 형식:  data: {"type":"content","text":"안녕"}\n\n
//  - signal: 중지 버튼용 (AbortController.abort() 호출 시 즉시 중단 => AbortError 발생)
//  - 스트리밍 시작 전 오류(대상 없음, 권한 없음 등)는 ApiError로 발생
//  - <T>: 이벤트 1개의 타입 (예: ChatStreamEvent)
export async function streamRequest<T>(
  path: string,
  body: unknown,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  // 1. 요청 보내기 (로그인 토큰 첨부 + 필요 시 재발급은 fetchWithAuth가 처리)
  const response = await fetchWithAuth(path, { method: 'POST', body, signal })
  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response))
  }
  if (!response.body) {
    throw new ApiError(0, '응답을 읽을 수 없습니다. 브라우저가 스트리밍을 지원하는지 확인해 주세요.')
  }

  // 2. 응답을 조각(바이트)으로 읽어서 글자로 바꾸기
  //  - TextDecoder: 바이트 => 글자 변환기
  //  - stream: true => 한글처럼 여러 바이트인 글자가 조각 경계에서 잘려도 다음 조각과 이어서 변환
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '' // 아직 처리하지 못한(덜 도착한) 글자

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })

    // 3. 빈 줄(\n\n)을 기준으로 이벤트 하나씩 잘라서 처리
    //  - 조각이 이벤트 중간에서 끊겨 올 수 있으므로, 완성된 이벤트만 처리하고 나머지는 buffer에 남김
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      for (const line of block.split('\n')) {
        if (line.startsWith('data: ')) {
          onEvent(JSON.parse(line.slice('data: '.length)) as T)
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}
