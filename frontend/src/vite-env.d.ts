/// <reference types="vite/client" />

//  * .env 환경 변수의 타입 정의
//  - import.meta.env.VITE_API_BASE_URL 처럼 사용할 때 자동완성과 타입 검사가 되도록 함
//  - .env에 새 변수(VITE_...)를 추가하면 여기에도 한 줄 추가할 것
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
