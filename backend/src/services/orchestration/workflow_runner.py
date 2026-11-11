# [수정] * 실행 함수 나누기 + 에이전트 결과에 모델 이름 추가 [2026-11-11 11:20]
# [기존] stream_workflow_events 하나가 이벤트를 만들면서 바로 SSE 글자로 바꿔 보냈습니다.
# [변경] run_workflow_events 는 이벤트를 dict 그대로 돌려주고,
#        stream_workflow_events 는 SSE 글자로만 바꿉니다. (agent_runner.py 와 같은 방식)
#        => 실행 기록 저장(run_recorder.py)이 이벤트 내용을 읽어서 DB에 남길 수 있도록 하기 위함
#        에이전트 노드의 node_done 이벤트에 사용한 모델 이름(model)을 추가했습니다. (모델별 통계용)

#  * 워크플로우 실행 엔진
#  - 시작 노드부터 연결선을 따라 노드를 하나씩 차례대로 실행하고,
#    끝 노드의 출력을 최종 결과로 돌려줌
#  - DB를 사용하지 않음 (필요한 값은 workflow/service.py 의 prepare_run 이
#    미리 PreparedWorkflowRun 에 담아 줌 - agent_runner.py 와 같은 방식)
#
# 📌 실행 순서 (예: 시작 => 금액 계산(에이전트) => 100만 원 이상?(조건) => 승인 요청(끝))
#  1) 시작   : 사용자가 입력한 값을 {{start.입력칸}} 으로 꺼내 쓸 수 있게 저장
#  2) 에이전트: 보낼 내용의 {{ }} 를 실제 값으로 바꿔서 에이전트 실행
#              => 최종 답변을 {{노드ID.answer}} 로 저장
#  3) 조건 분기: 비교할 값/기준 값의 {{ }} 를 바꾼 뒤 비교
#              => 참이면 '참' 쪽, 아니면 '거짓' 쪽 연결선으로 이동
#  4) 끝     : 출력의 {{ }} 를 바꿔서 최종 결과로 보내고 종료
#  - 조건 분기를 뺀 노드는 다음 노드가 하나뿐이므로(graph.py 의 점검 규칙), 실행 경로는 항상 한 줄
#    => 여러 노드를 동시에 실행하지 않고 순서대로 실행함
#
# 📌 {{노드ID.항목}} 바꾸기 규칙
#  - 이번 실행에서 거치지 않은 노드(조건 분기로 건너뛴 쪽)를 가리키면 빈 글자("")로 바꿈
#    => 조건 분기의 "비어 있음"으로 확인할 수 있음
#
# 📌 프론트엔드로 보내는 이벤트 종류 (SSE 형식 - agent_runner.py 와 같은 방식)
#  - {"type": "node_start", "node_id": "agent_1", "node_type": "agent", "label": "금액 계산"}
#      : 노드 실행 시작
#  - {"type": "reasoning" | "content" | "tool_call" | "tool_result", "node_id": "agent_1", ...}
#      : 에이전트 노드의 진행 상황 (agent_runner.py 의 이벤트에 node_id 만 붙여서 그대로 전달)
#  - {"type": "node_done", "node_id": .., "node_type": .., "duration_ms": .., ...노드 종류별 결과}
#      : 노드 실행 끝 (노드 종류별 결과는 _run_xxx 함수 설명 참고)
#  - {"type": "done", "output": "...", "end_node_id": "end_1", "path": ["start", ...],
#     "input_tokens": .., "output_tokens": .., "latency_ms": ..}
#      : 워크플로우 끝 (path: 실제로 실행한 노드 순서 / 토큰: 모든 에이전트 노드의 합계)
#  - {"type": "error", "node_id": "agent_1" 또는 None, "message": "..."}
#      : 오류 => 워크플로우를 그 자리에서 멈춤

import json
import logging
import math
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass, replace

from src.core.llm import ChatMessage
from src.services.orchestration import agent_runner
from src.services.orchestration.agent_runner import PreparedRun
from src.services.workflow.graph import (
    AGENT_OUTPUT_FIELD,
    TEMPLATE_PATTERN,
    AgentNode,
    AnyNode,
    ConditionNode,
    EndNode,
    StartNode,
    WorkflowGraph,
)

logger = logging.getLogger(__name__)


#  * 워크플로우 실행 준비가 끝난 상태 (workflow/service.py 의 prepare_run 이 만듦)
#  - inputs: 시작 노드 입력값 {입력 칸 이름: 값} (필수 입력, 숫자 형식 확인이 끝난 값)
#  - agent_runs: {에이전트 노드 ID: 실행 준비가 끝난 에이전트}
#    (messages 에는 시스템 프롬프트만 들어 있고, 노드를 실행할 때 보낼 내용을 붙임)
@dataclass(frozen=True)
class PreparedWorkflowRun:
    graph: WorkflowGraph
    inputs: dict[str, str]
    agent_runs: dict[str, PreparedRun]


#  * 노드 실행 실패 (이 파일 안에서만 사용)
#  - 메시지는 화면에 그대로 보여줄 수 있는 문장
class NodeRunError(Exception):
    pass


# SSE(Server-Sent Events) 형식 한 덩어리 만들기 => "data: {JSON}\n\n"
def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# 긴 글은 앞부분만 (오류 메시지에 값을 보여줄 때)
def _shorten(text: str, max_length: int = 30) -> str:
    return text if len(text) <= max_length else f"{text[:max_length]}…"


# 지금부터 걸린 시간(밀리초)
def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


# ============================================================
# 1. 값 바꾸기, 조건 비교 (DB, LLM을 쓰지 않는 순수 함수)
# ============================================================


#  * 글자를 숫자로 바꾸기 (숫자가 아니면 None)
#  - 앞뒤 공백과 천 단위 쉼표는 무시 (예: " 1,000,000 " => 1000000.0)
#  - "nan", "inf" 처럼 float()가 받아 주지만 비교할 수 없는 값은 숫자로 보지 않음
#  - workflow/service.py 에서 시작 노드의 숫자 입력 칸을 확인할 때도 사용
def parse_number(text: str) -> float | None:
    cleaned = text.strip().replace(",", "")
    if not cleaned:
        return None
    try:
        number = float(cleaned)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


#  * {{노드ID.항목}} 을 실제 값으로 바꾸기
#  - values: {노드ID: {항목 이름: 값}} (지금까지 실행한 노드의 결과)
#  - 없는 값(거치지 않은 노드 등)은 빈 글자로 바꿈 (맨 위 설명 참고)
#  - TEMPLATE_PATTERN.sub(함수, 글): 찾은 부분마다 함수를 호출해서, 돌려준 글자로 바꿔 줌
def render_template(text: str, values: dict[str, dict[str, str]]) -> str:
    return TEMPLATE_PATTERN.sub(
        lambda match: values.get(match.group(1), {}).get(match.group(2), ""),
        text,
    )


#  * 조건 비교 => 참(True) / 거짓(False)
#  - 비교 전에 두 값의 앞뒤 공백은 지움
#  - 같음/같지 않음: 두 값이 모두 숫자면 숫자로 비교 (예: "1,000" 과 "1000" 은 같음),
#                    아니면 글자로 비교 (영문 대소문자는 구분하지 않음)
#  - 포함/포함하지 않음: 비교할 값 안에 기준 값이 들어 있는지 (영문 대소문자는 구분하지 않음)
#  - 크기 비교(>, ≥, <, ≤): 두 값이 모두 숫자여야 함 => 아니면 NodeRunError
#    (예: 에이전트 답변이 "약 120만 원입니다." 처럼 문장이면 비교할 수 없음)
def evaluate_condition(left: str, operator: str, right: str) -> bool:
    left_text = left.strip()
    right_text = right.strip()

    # 1. 비어 있음 / 비어 있지 않음 (기준 값을 쓰지 않음)
    if operator == "is_empty":
        return left_text == ""
    if operator == "is_not_empty":
        return left_text != ""

    # 2. 같음 / 같지 않음
    #  - casefold(): 대소문자 구분 없이 비교하기 위해 모두 소문자처럼 바꿈 (lower()보다 정확)
    if operator in ("equals", "not_equals"):
        left_number = parse_number(left_text)
        right_number = parse_number(right_text)
        if left_number is not None and right_number is not None:
            same = left_number == right_number
        else:
            same = left_text.casefold() == right_text.casefold()
        return same if operator == "equals" else not same

    # 3. 포함 / 포함하지 않음
    if operator in ("contains", "not_contains"):
        found = right_text.casefold() in left_text.casefold()
        return found if operator == "contains" else not found

    # 4. 크기 비교 (숫자만)
    left_number = parse_number(left_text)
    right_number = parse_number(right_text)
    if left_number is None:
        raise NodeRunError(
            f"비교할 값 '{_shorten(left_text)}' 이(가) 숫자가 아니어서 크기를 비교할 수 없습니다."
        )
    if right_number is None:
        raise NodeRunError(
            f"기준 값 '{_shorten(right_text)}' 이(가) 숫자가 아니어서 크기를 비교할 수 없습니다."
        )
    if operator == "greater_than":
        return left_number > right_number
    if operator == "greater_or_equal":
        return left_number >= right_number
    if operator == "less_than":
        return left_number < right_number
    if operator == "less_or_equal":
        return left_number <= right_number
    raise NodeRunError(f"알 수 없는 비교 방법입니다. ({operator})")


# ============================================================
# 2. 노드 종류별 실행
#  - 각 함수는 진행 상황 이벤트를 하나씩 돌려주고(yield), 마지막에 node_done 이벤트를 돌려줌
#  - 실패하면 NodeRunError 를 던짐 => 아래 stream_workflow_events 가 error 이벤트로 바꿈
# ============================================================


#  * 에이전트 노드 실행
#  - node_done 결과: prompt(실제로 보낸 내용), answer(최종 답변), model(사용한 모델 이름),
#    input_tokens, output_tokens, steps(LLM 호출 횟수), finish_reason
#  - 최종 답변 = 마지막 LLM 호출의 답변 글
#    (도구를 부르기 전에 모델이 쓴 "계산해 볼게요" 같은 글은 빼기 위해,
#     도구 실행(tool_call) 이벤트가 오면 그때까지 모은 답변 글을 비움)
async def _run_agent(
    node: AgentNode,
    prepared: PreparedWorkflowRun,
    values: dict[str, dict[str, str]],
    usage: dict[str, int],
) -> AsyncIterator[dict]:
    # 1. 보낼 내용 만들기 + 에이전트 실행 준비 (시스템 프롬프트 뒤에 보낼 내용을 붙임)
    prompt = render_template(node.data.prompt, values).strip()
    if not prompt:
        raise NodeRunError("에이전트에 보낼 내용이 비어 있습니다. 앞 노드의 값을 확인해 주세요.")
    base = prepared.agent_runs[node.id]
    #  - replace(객체, 항목=값): frozen dataclass 를 바꾸지 않고, 일부만 바꾼 "새 객체"를 만듦
    run = replace(base, messages=[*base.messages, ChatMessage(role="user", content=prompt)])

    # 2. 에이전트 실행 (진행 상황은 node_id 를 붙여서 그대로 전달)
    answer_parts: list[str] = []
    done: dict | None = None
    async with aclosing(agent_runner.run_events(run)) as events:
        async for event in events:
            if event["type"] == "error":
                raise NodeRunError(event["message"])
            if event["type"] == "done":
                done = event
                continue
            if event["type"] == "content":
                answer_parts.append(event["text"])
            elif event["type"] == "tool_call":
                answer_parts.clear()
            yield {**event, "node_id": node.id}

    # 3. 사용량 합계에 더하기
    done = done or {}
    usage["input_tokens"] += done.get("input_tokens", 0)
    usage["output_tokens"] += done.get("output_tokens", 0)

    # 4. 최종 답변 확인 (답변이 없으면 다음 노드로 넘길 값이 없으므로 멈춤)
    answer = "".join(answer_parts).strip()
    finish_reason = done.get("finish_reason")
    if not answer:
        if finish_reason == "max_iterations":
            raise NodeRunError(
                f"최대 반복 횟수({run.max_iterations}회)에 도달해 최종 답변을 만들지 못했습니다. "
                "에이전트 설정에서 최대 반복 횟수를 늘려 보세요."
            )
        if finish_reason == "length":
            raise NodeRunError(
                "최대 토큰 수(Max Tokens)에 도달해 답변을 만들지 못했습니다. "
                "에이전트 설정에서 Max Tokens 를 늘려 보세요."
            )
        raise NodeRunError("에이전트가 빈 답변을 보냈습니다.")

    # 5. 다음 노드에서 {{노드ID.answer}} 로 꺼내 쓸 수 있게 저장
    values[node.id] = {AGENT_OUTPUT_FIELD: answer}
    yield {
        "type": "node_done",
        "prompt": prompt,
        "answer": answer,
        "model": run.model_name,
        "input_tokens": done.get("input_tokens", 0),
        "output_tokens": done.get("output_tokens", 0),
        "steps": done.get("steps", 0),
        "finish_reason": finish_reason,
    }


# ============================================================
# 3. 워크플로우 실행
# ============================================================


#  * 워크플로우 실행 => 진행 상황을 SSE 형식으로 하나씩 돌려줌
#  - 실행 기록을 남기지 않고 실행만 할 때 사용 (라우터는 기록을 남기는 run_recorder.py 를 사용)
#  - aclosing: 중간에 멈추면 안쪽 run_workflow_events 도 확실히 닫아 줌
async def stream_workflow_events(prepared: PreparedWorkflowRun) -> AsyncIterator[str]:
    async with aclosing(run_workflow_events(prepared)) as events:
        async for event in events:
            yield _sse(event)


#  * 워크플로우 실행 => 진행 상황을 이벤트(dict)로 하나씩 돌려줌
#  - 이벤트 종류는 맨 위 설명 참고 (오류도 예외를 던지지 않고 error 이벤트로 돌려줌)
#  - 사용자가 중지하면(연결 끊김) 이 함수도 중간에 멈추고, 실행 중인 에이전트도 함께 멈춤
async def run_workflow_events(prepared: PreparedWorkflowRun) -> AsyncIterator[dict]:
    started = time.perf_counter()
    graph = prepared.graph
    nodes_by_id: dict[str, AnyNode] = {node.id: node for node in graph.nodes}
    #  * 다음 노드 찾기표: (출발 노드 ID, 출구) => 도착 노드 ID
    #  - 출구: 조건 분기는 "true" / "false", 나머지 노드는 None
    next_node: dict[tuple[str, str | None], str] = {
        (edge.source, edge.sourceHandle): edge.target for edge in graph.edges
    }
    values: dict[str, dict[str, str]] = {}  # 노드별 결과 ({{노드ID.항목}} 바꾸기에 사용)
    usage = {"input_tokens": 0, "output_tokens": 0}  # 모든 에이전트 노드의 토큰 합계
    path: list[str] = []  # 실제로 실행한 노드 순서

    current_id: str | None = None
    try:
        # 1. 시작 노드부터 출발 (실행 전 점검을 통과했으므로 시작 노드는 정확히 1개)
        start = next(node for node in graph.nodes if isinstance(node, StartNode))
        current_id = start.id

        #  2. 노드를 하나씩 실행
        #  - 순환이 없으므로 노드 수보다 많이 실행될 일은 없지만, 만일을 대비해 횟수를 제한
        for _ in range(len(graph.nodes)):
            node = nodes_by_id[current_id]
            path.append(node.id)
            node_started = time.perf_counter()
            yield {
                "type": "node_start",
                "node_id": node.id,
                "node_type": node.type,
                "label": node.data.label,
            }

            # 2-1. 노드 종류별 실행 (handle: 다음 노드로 갈 출구)
            handle: str | None = None
            result: dict
            if isinstance(node, StartNode):
                values[node.id] = dict(prepared.inputs)
                result = {"inputs": prepared.inputs}
            elif isinstance(node, AgentNode):
                result = {}
                async with aclosing(_run_agent(node, prepared, values, usage)) as events:
                    async for event in events:
                        if event["type"] == "node_done":
                            result = {key: value for key, value in event.items() if key != "type"}
                        else:
                            yield event
            elif isinstance(node, ConditionNode):
                left = render_template(node.data.left, values)
                right = render_template(node.data.right, values)
                matched = evaluate_condition(left, node.data.operator, right)
                handle = "true" if matched else "false"
                result = {
                    "left": left,
                    "operator": node.data.operator,
                    "right": right,
                    "result": matched,
                }
            else:
                result = {"output": render_template(node.data.output, values)}

            yield {
                "type": "node_done",
                "node_id": node.id,
                "node_type": node.type,
                "duration_ms": _elapsed_ms(node_started),
                **result,
            }

            # 2-2. 끝 노드 => 워크플로우 끝
            if isinstance(node, EndNode):
                yield {
                    "type": "done",
                    "output": result["output"],
                    "end_node_id": node.id,
                    "path": path,
                    "input_tokens": usage["input_tokens"],
                    "output_tokens": usage["output_tokens"],
                    "latency_ms": _elapsed_ms(started),
                }
                return

            # 2-3. 다음 노드로 이동
            next_id = next_node.get((node.id, handle))
            if next_id is None:
                raise NodeRunError("다음 노드와 연결되어 있지 않습니다.")
            current_id = next_id

        # 노드 수만큼 실행했는데도 끝 노드에 닿지 못함 (점검을 통과했다면 생기지 않는 경우)
        raise NodeRunError("끝 노드에 도달하지 못했습니다. 연결을 확인해 주세요.")
    except NodeRunError as err:
        yield {"type": "error", "node_id": current_id, "message": str(err)}
    except Exception:
        # 예상하지 못한 에러: 서버 로그에 자세히 남기고, 화면에는 일반 메시지만 보냄
        logger.exception("워크플로우 실행 중 예상하지 못한 오류가 발생했습니다.")
        yield {
            "type": "error",
            "node_id": current_id,
            "message": "워크플로우 실행 중 서버 오류가 발생했습니다.",
        }
