import 'katex/dist/katex.min.css' // 수식 모양 + 수식 폰트 (빌드 결과에 포함됨 - 폐쇄망 대비)

import type { AnchorHTMLAttributes } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

//  * LLM 답변(마크다운 + 수식)을 보기 좋게 표시하는 컴포넌트 (실제로 그리는 부분)
//  - ⚠️ 화면에서는 이 파일을 직접 쓰지 말고 MarkdownView.tsx 를 사용할 것
//    (마크다운/수식 라이브러리가 커서, 필요한 화면에서만 나중에 불러오도록 MarkdownView가 감싸고 있음)
//  - LLM은 답변을 마크다운(**굵게**, 목록, 표, 코드)과 LaTeX 수식($x^2$)으로 쓰는 경우가 많음
//  - 사용하는 도구 (모두 npm 패키지 => 빌드 결과에 포함, 외부 CDN 사용 안 함)
//    - react-markdown: 마크다운 => 화면 요소로 변환
//    - remark-gfm    : 표, 취소선, 체크박스, 주소 자동 링크 (GitHub 방식 마크다운)
//    - remark-math   : $...$ (문장 안 수식), $$...$$ (한 줄 전체 수식) 을 수식으로 인식
//    - rehype-katex  : 인식한 수식을 KaTeX로 그림
//
// 📌 안전성
//  - react-markdown은 답변 안의 HTML 태그(<script> 등)를 실행하지 않고 글자로 취급함 (기본값)
//  - "javascript:" 같은 위험한 링크 주소는 react-markdown이 자동으로 지움
//  - 수식에 오류가 있으면(답변을 받는 도중 수식이 반쯤 온 경우 등) 화면이 깨지지 않고
//    그 부분만 빨간 글자로 표시됨

//  * 수식 안에 "한글"이 있는지 확인 (\text{원} 처럼 수식 안에 일부러 넣은 글자는 제외)
//  - 실제 수식에는 한글이 거의 없으므로, 한글이 있으면 수식이 아니라 일반 문장으로 판단
function hasHangulOutsideText(math: string): boolean {
  return /[가-힣]/.test(math.replace(/\\(text|textrm|mbox)\{[^}]*\}/g, ''))
}

//  * 답변 글을 마크다운으로 해석하기 전에 수식 표기를 정리
//  1) \[ ... \] => $$ ... $$ (한 줄 전체 수식 - 앞뒤로 줄을 바꿔야 한 줄 전체 수식으로 인식됨)
//  2) \( ... \) => $ ... $   (문장 안 수식)
//     - remark-math는 $ 기호만 수식으로 인식하는데, 모델에 따라 \( \) 형식으로 쓰는 경우가 있음
//  3) 금액 표기 보호: "사과는 $5이고 배는 $7" 처럼 $ 두 개 사이에 한글이 있으면
//     수식이 아니라 금액으로 보고 $ 를 글자(\$)로 바꿈 (그대로 두면 "5이고 배는 " 이 수식으로 깨져 보임)
//  - 코드 블록(```)과 문장 안 코드(`...`) 안의 글자는 바꾸지 않음 (코드 예시가 망가지지 않도록)
function normalizeMath(text: string): string {
  // split + 괄호(캡처): 코드 부분을 버리지 않고 목록에 함께 남김
  //  => 짝수 번째(0, 2, 4...)는 일반 글, 홀수 번째(1, 3, 5...)는 코드
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) => {
      if (index % 2 === 1) {
        return part
      }
      return (
        part
          .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`)
          .replace(/\\\(([\s\S]+?)\\\)/g, (_, math: string) => `$${math}$`)
          //  * $...$ 한 쌍 찾기 ($$ 와 이미 글자로 바꾼 \$ 는 제외)
          //  - (?<![\\$]): 바로 앞이 \ 또는 $ 가 아님 / (?!\$): 바로 뒤가 $ 가 아님
          .replace(/(?<![\\$])\$(?!\$)([^$\n]+?)(?<![\\$])\$(?!\$)/g, (whole, math: string) =>
            hasHangulOutsideText(math) ? `\\$${math}\\$` : whole,
          )
      )
    })
    .join('')
}

//  * 답변 안의 링크는 새 탭으로 열기 (noopener noreferrer: 열린 페이지가 이 화면을 조작하지 못하도록)
//  - 주소(href), 마우스를 올렸을 때 설명(title), 글자(children)만 넘김
//    (react-markdown이 함께 넘겨주는 내부 정보(node)가 HTML 속성으로 들어가지 않도록)
//  - 위험한 주소라서 react-markdown이 지운 링크(href 없음)는 링크가 아닌 일반 글자로 표시
function ExternalLink({ href, title, children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href) {
    return <span>{children}</span>
  }
  return (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

export default function MarkdownRenderer({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // strict: 'ignore' => 수식 안의 한글 등으로 인한 KaTeX 경고를 브라우저 콘솔에 출력하지 않음
        rehypePlugins={[[rehypeKatex, { strict: 'ignore' }]]}
        components={{ a: ExternalLink }}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  )
}
