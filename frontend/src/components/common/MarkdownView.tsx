import { lazy, Suspense } from 'react'

//  * LLM 답변(마크다운 + 수식) 표시 - 화면에서는 이 컴포넌트를 사용
//  - 실제로 그리는 부분은 MarkdownRenderer.tsx
//
// 📌 lazy(나중에 불러오기)를 사용하는 이유
//  - 마크다운 + 수식(KaTeX) 라이브러리는 약 450KB로, 앱 전체 코드보다 큼
//  - 그냥 import 하면 로그인 화면처럼 답변이 없는 화면에서도 이 코드를 모두 내려받아야 함
//  - lazy(() => import(...)): 이 컴포넌트가 처음 화면에 그려질 때 그 파일만 따로 내려받음
//    (빌드할 때 별도 파일로 나뉘고, 한 번 내려받으면 브라우저가 기억함)
//  - Suspense fallback: 내려받는 동안(아주 잠깐)은 답변을 글자 그대로 보여줌
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer'))

export default function MarkdownView({ text }: { text: string }) {
  return (
    <Suspense fallback={text}>
      <MarkdownRenderer text={text} />
    </Suspense>
  )
}
