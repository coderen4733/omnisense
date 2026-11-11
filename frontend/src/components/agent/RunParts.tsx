import { CircleAlert, CircleCheck, LoaderCircle, Wrench } from 'lucide-react'

import type { AgentProgressEvent } from '../../api/types'
import MarkdownView from '../common/MarkdownView'

//  * 에이전트 실행 결과(생각 과정, 도구 실행, 답변)를 보여주는 공용 부품
//  - 에이전트 테스트 실행 화면(pages/agents/AgentRunPage.tsx)과
//    워크플로우 실행 패널(pages/workflows/editor/RunPanel.tsx)에서 함께 사용
//  - 답변은 마크다운 + 수식으로 해석해서 표시 (MarkdownView - HTML 태그는 실행하지 않으므로 안전)
//    생각 과정, 도구 입력값/결과는 글자 그대로 표시

//  * 에이전트 답변 안의 조각 1개 (도착한 순서대로 쌓임)
//  - reasoning: 생각 과정 / content: 답변 글 / tool: 도구 실행 (result가 없으면 실행 중)
export type RunPart =
  | { kind: 'reasoning'; text: string }
  | { kind: 'content'; text: string }
  | {
      kind: 'tool'
      id: string // tool_call 과 tool_result 의 짝을 맞추는 번호
      name: string
      arguments: Record<string, unknown>
      result?: { text: string; isError: boolean; durationMs: number }
    }

// 밀리초 => "1.23초"
export const toSeconds = (ms: number) => `${(ms / 1000).toFixed(2)}초`

//  * 받은 이벤트 1개를 답변 조각 목록에 반영 (원래 목록은 바꾸지 않고 새 목록을 돌려줌)
//  - 생각 과정/답변 글: 마지막 조각과 같은 종류면 이어 붙이고, 다르면 새 조각 추가
//  - 도구 실행 결과: 같은 id의 도구 조각을 찾아 결과를 채움
export function applyRunEvent(parts: RunPart[], event: AgentProgressEvent): RunPart[] {
  if (event.type === 'reasoning' || event.type === 'content') {
    const last = parts[parts.length - 1]
    if (last && last.kind === event.type) {
      return [...parts.slice(0, -1), { ...last, text: last.text + event.text }]
    }
    return [...parts, { kind: event.type, text: event.text }]
  }
  if (event.type === 'tool_call') {
    return [...parts, { kind: 'tool', id: event.id, name: event.name, arguments: event.arguments }]
  }
  return parts.map((part) =>
    part.kind === 'tool' && part.id === event.id
      ? { ...part, result: { text: event.result, isError: event.is_error, durationMs: event.duration_ms } }
      : part,
  )
}

//  * 조각 목록을 도착한 순서대로 표시
//  - finished: 실행이 끝났는지 (끝났으면 생각 과정을 접고, 결과 없는 도구는 "중단됨"으로 표시)
//  - toolLabel: 도구 이름 => 화면 이름 (예: calculator => 계산기)
interface RunPartListProps {
  parts: RunPart[]
  finished: boolean
  toolLabel: (toolName: string) => string
}

export function RunPartList({ parts, finished, toolLabel }: RunPartListProps) {
  const lastPart = parts[parts.length - 1]
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'reasoning') {
          // 지금 생각 과정을 받는 중이면 펼침, 다른 조각이 이어서 오면 접힘 (ChatPlayground.tsx 설명 참고)
          const thinking = !finished && part === lastPart
          return (
            <details key={index} className="reasoning" open={thinking ? true : undefined}>
              <summary>
                {thinking ? '생각하는 중...' : `생각 과정 보기 (${part.text.length.toLocaleString()}자)`}
              </summary>
              <div className="reasoning-body">{part.text}</div>
            </details>
          )
        }
        if (part.kind === 'content') {
          return (
            <div key={index} className="chat-bubble">
              <MarkdownView text={part.text} />
            </div>
          )
        }
        return <ToolStep key={index} part={part} label={toolLabel(part.name)} stopped={finished} />
      })}
    </>
  )
}

//  * 도구 실행 1건 - 접었다 펼 수 있는 상자 (펼치면 입력값과 결과를 보여줌)
//  - stopped: 답변이 끝났는데 결과가 없음 => 실행 도중 중지/오류로 끊긴 것
function ToolStep({ part, label, stopped }: { part: Extract<RunPart, { kind: 'tool' }>; label: string; stopped: boolean }) {
  const { result } = part
  const className = result?.isError ? 'tool-step is-error' : 'tool-step'

  return (
    <details className={className}>
      <summary>
        <Wrench size={14} />
        <strong>{label}</strong>
        {result ? (
          result.isError ? (
            <span className="tool-step-status is-error">
              <CircleAlert size={14} />
              오류
            </span>
          ) : (
            <span className="tool-step-status is-success">
              <CircleCheck size={14} />
              완료 ({toSeconds(result.durationMs)})
            </span>
          )
        ) : stopped ? (
          <span className="tool-step-status">중단됨</span>
        ) : (
          <span className="tool-step-status">
            <LoaderCircle size={14} className="spin" />
            실행 중...
          </span>
        )}
      </summary>
      <div className="tool-step-body">
        <span className="tool-step-label">입력값</span>
        {/* JSON.stringify(값, null, 2): 보기 좋게 줄바꿈 + 들여쓰기 2칸 */}
        <pre className="tool-step-code">{JSON.stringify(part.arguments, null, 2)}</pre>
        {result && (
          <>
            <span className="tool-step-label">결과</span>
            <pre className="tool-step-code">{result.text}</pre>
          </>
        )}
      </div>
    </details>
  )
}
