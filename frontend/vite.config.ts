import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

//  * Vite 설정 파일
//  - plugins: React(JSX/TSX) 코드를 브라우저가 이해할 수 있는 코드로 변환해 주는 플러그인
//  - server.port: 개발 서버 포트 (CLAUDE.md 규칙: http://localhost:3000)
//  - strictPort: 3000번이 이미 사용 중이면 다른 포트로 바꾸지 않고 에러를 냄
//    => 백엔드 CORS 설정(CORS_ORIGINS)이 3000번만 허용하므로, 포트가 바뀌면 로그인 요청이 막힘
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
  },
  preview: {
    port: 3000,
    strictPort: true,
  },
})
