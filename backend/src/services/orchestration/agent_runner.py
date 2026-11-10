#  * 에이전트 실행 엔진
#  - 질문을 받아 "LLM 호출 => 도구 실행 => 결과를 다시 LLM에 전달"을 반복하여 최종 답변을 만듦
#  - DB를 사용하지 않음 (필요한 값은 agent/service.py 의 prepare_run 이 미리 PreparedRun에 담아 줌)
#    => 나중에 워크플로우의 에이전트 노드에서도 이 파일을 그대로 다시 사용할 예정
#
# 📌 orchestration 폴더의 역할: "실행" 전담
#  - 에이전트/워크플로우의 등록·수정(CRUD)은 각 기능 폴더(agent/, 나중에 workflow/)가 담당하고,
#    실제로 실행하고 순서를 조율하는 코드는 이 폴더에 모음
#    (예정: 워크플로우 실행 엔진, 실행 기록 저장)
#
# 📌 실행 흐름 (예: "1250원짜리 12개를 7명이 나누면 1인당 얼마야?")
#  1) 1번째 LLM 호출: 모델이 "calculator 도구를 (1250 * 12) / 7 로 실행해 줘" 라고 요청
#  2) 도구 실행: calculator => {"result": "2142.85714285714"}
#  3) 2번째 LLM 호출: 도구 결과를 함께 보내면, 모델이 "1인당 약 2,143원입니다." 라고 최종 답변
#  4) 도구 호출 요청이 없는 답변이 나오면 끝
#     (max_iterations 번 LLM을 호출해도 계속 도구만 호출하면 멈춤 => 무한 반복 방지)
#
# 📌 프론트엔드로 보내는 이벤트 종류 (SSE 형식 - llm/service.py 의 stream_chat_events 참고)
#  - {"type": "reasoning", "text": "..."}  : 생각 과정 조각
#  - {"type": "content", "text": "..."}    : 답변 조각
#  - {"type": "tool_call", "id": "1-0", "name": "calculator", "arguments": {...}}
#      : 도구 실행 시작 (id: 화면에서 실행 결과와 짝을 맞추기 위한 번호 "LLM 호출 차례-순서")
#  - {"type": "tool_result", "id": "1-0", "name": .., "result": "...", "is_error": false,
#     "duration_ms": 3} : 도구 실행 결과
#  - {"type": "done", "input_tokens": .., "output_tokens": .., "finish_reason": ..,
#     "steps": .., "latency_ms": .., "first_token_ms": ..} : 끝
#      - input_tokens, output_tokens: 모든 LLM 호출의 합계
#      - steps: LLM을 호출한 횟수
#      - finish_reason: stop(정상) / length(최대 토큰 수에 걸려 잘림)
#                       / max_iterations(최대 반복 횟수에 도달해 멈춤)
#  - {"type": "error", "message": "..."}   : 오류

import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass

from src.core import llm
from src.core.llm import (
    ChatMessage,
    GenerationParams,
    LLMConnection,
    LLMError,
    ToolCall,
    ToolDefinition,
)
from src.services.tool import registry as tool_registry
from src.services.tool.registry import ToolResult

logger = logging.getLogger(__name__)


#  * 에이전트 실행 준비가 끝난 상태 (service.py 의 prepare_run 이 만듦)
#  - messages: 시스템 프롬프트 + 지금까지의 대화 (마지막은 사용자 질문)
#  - tools: LLM에 보낼 도구 설명 목록 (도구가 없으면 빈 목록)
@dataclass(frozen=True)
class PreparedRun:
    connection: LLMConnection
    model_name: str  # 공급자 서버의 모델 이름 (예: qwen3.5:9b)
    messages: list[ChatMessage]
    params: GenerationParams
    tools: list[ToolDefinition]
    max_iterations: int


# SSE(Server-Sent Events) 형식 한 덩어리 만들기 => "data: {JSON}\n\n"
def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


#  * 모델이 요청한 도구 실행
#  - 이 에이전트에 연결되지 않은 도구(모델이 이름을 지어낸 경우 등)는 실행하지 않고 오류로 알려줌
async def _run_tool(prepared: PreparedRun, call: ToolCall) -> ToolResult:
    allowed_names = {tool.name for tool in prepared.tools}
    if call.name not in allowed_names:
        return ToolResult(
            content=f"오류: 이 에이전트에서 사용할 수 없는 도구입니다. ({call.name})",
            is_error=True,
            duration_ms=0,
        )
    return await tool_registry.execute_tool(call.name, call.arguments)


#  * 에이전트 실행 => 진행 상황을 SSE 형식으로 하나씩 돌려줌 (라우터의 StreamingResponse가 사용)
#  - 사용자가 중지하면(연결 끊김) 이 함수도 중간에 멈추고, LLM 서버와의 연결도 함께 닫힘
async def stream_run_events(prepared: PreparedRun) -> AsyncIterator[str]:
    started = time.perf_counter()
    first_token_ms: int | None = None  # 첫 글자가 올 때까지 걸린 시간
    input_tokens = 0  # 모든 LLM 호출의 토큰 합계
    output_tokens = 0
    finish_reason: str | None = None
    steps = 0  # LLM을 호출한 횟수
    # 대화 기록 (도구 호출 요청과 실행 결과가 차례로 추가됨)
    messages = list(prepared.messages)
    # 도구가 없으면 None (도구 목록을 보내지 않음)
    tools = prepared.tools or None

    try:
        for step in range(1, prepared.max_iterations + 1):
            steps = step
            content_parts: list[str] = []  # 이번 호출의 답변 조각
            reasoning_parts: list[str] = []  # 이번 호출의 생각 과정 조각
            tool_calls: list[ToolCall] = []  # 이번 호출에서 모델이 요청한 도구 실행

            # 1. LLM 호출 (답변 조각은 바로바로 화면으로 전달)
            async with aclosing(
                llm.stream_chat(
                    prepared.connection,
                    prepared.model_name,
                    messages,
                    prepared.params,
                    tools,
                )
            ) as events:
                async for event in events:
                    if event.type in ("reasoning", "content"):
                        if first_token_ms is None:
                            first_token_ms = int((time.perf_counter() - started) * 1000)
                        if event.type == "content":
                            content_parts.append(event.text)
                        else:
                            reasoning_parts.append(event.text)
                        yield _sse({"type": event.type, "text": event.text})
                    elif event.type == "tool_call" and event.tool_call:
                        tool_calls.append(event.tool_call)
                    elif event.type == "done":
                        if event.usage:
                            input_tokens += event.usage.input_tokens
                            output_tokens += event.usage.output_tokens
                        finish_reason = event.finish_reason

            # 2. 도구 호출 요청이 없으면 => 최종 답변 완료
            if not tool_calls:
                #  * 답변 없이 생각 과정만 온 경우 => 생각 과정을 답변으로 보여줌
                #  - qwen3.5 + Ollama 조합에서 도구를 여러 번 쓴 뒤 최종 답변이
                #    생각 과정(reasoning) 칸으로 잘못 나오는 경우가 있음 (모델/서빙 쪽 특성)
                #  - 그대로 두면 화면에 빈 답변이 보이므로, 생각 과정 내용을 답변으로 한 번 더 보냄
                #  - 단, 최대 토큰 수에 걸려 생각 도중 잘린 경우(length)는 제외 (생각 중인 글이므로)
                fallback = "".join(reasoning_parts).strip()
                if not "".join(content_parts).strip() and fallback and finish_reason != "length":
                    yield _sse({"type": "content", "text": fallback})
                break

            # 3. 모델의 도구 호출 요청을 대화 기록에 추가
            #  - 다음 LLM 호출 때 "내가 이 도구를 요청했었다"는 사실을 모델이 알 수 있도록
            messages.append(
                ChatMessage(role="assistant", content="".join(content_parts), tool_calls=tool_calls)
            )

            # 4. 요청받은 도구를 하나씩 실행하고, 결과를 화면과 대화 기록에 추가
            for index, call in enumerate(tool_calls):
                event_id = f"{step}-{index}"
                yield _sse(
                    {
                        "type": "tool_call",
                        "id": event_id,
                        "name": call.name,
                        "arguments": call.arguments,
                    }
                )
                result = await _run_tool(prepared, call)
                yield _sse(
                    {
                        "type": "tool_result",
                        "id": event_id,
                        "name": call.name,
                        "result": result.content,
                        "is_error": result.is_error,
                        "duration_ms": result.duration_ms,
                    }
                )
                # tool_call_id: 어떤 도구 호출의 결과인지 짝을 맞춤
                messages.append(
                    ChatMessage(role="tool", content=result.content, tool_call_id=call.id)
                )
        else:
            #  * for ~ else: for 반복이 break 없이 끝까지 돈 경우에만 실행됨
            #  => 최대 반복 횟수만큼 호출했는데도 모델이 계속 도구만 호출함 (최종 답변 없음)
            finish_reason = "max_iterations"

        # 5. 끝 (사용량 합계, 걸린 시간)
        yield _sse(
            {
                "type": "done",
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "finish_reason": finish_reason,
                "steps": steps,
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "first_token_ms": first_token_ms,
            }
        )
    except LLMError as err:
        yield _sse({"type": "error", "message": str(err)})
    except Exception:
        # 예상하지 못한 에러: 서버 로그에 자세히 남기고, 화면에는 일반 메시지만 보냄
        logger.exception("에이전트 실행 중 예상하지 못한 오류가 발생했습니다.")
        yield _sse({"type": "error", "message": "에이전트 실행 중 서버 오류가 발생했습니다."})
