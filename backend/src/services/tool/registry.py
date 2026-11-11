#  * 에이전트가 사용할 수 있는 도구 목록과 도구 실행을 한 곳에서 관리
#  - 에이전트 실행(orchestration/agent_runner.py)은 이 파일의 함수만 사용함
#    => 나중에 MCP 도구를 추가해도 에이전트 실행 코드는 바꾸지 않아도 되도록 하기 위함
#
# 📌 다른 파일에서 사용하는 함수
#  - list_tools()          : 화면에 보여줄 도구 목록 (에이전트 등록 화면의 도구 선택)
#  - is_known_tool()       : 등록된 도구 이름인지 확인 (에이전트 저장 시 검사)
#  - get_tool_definitions(): LLM에 보낼 도구 설명 목록 (core/llm.py 의 ToolDefinition)
#  - execute_tool()        : 도구 실행 (실패해도 에러를 던지지 않고 결과에 오류 내용을 담아 돌려줌)

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from src.core.llm import ToolDefinition
from src.services.tool import builtin
from src.services.tool.builtin import ToolError

logger = logging.getLogger(__name__)

# 도구 1개의 최대 실행 시간 (초) - 넘으면 중단하고 모델에게 "시간 초과"를 알려줌
TOOL_TIMEOUT_SECONDS = 30
#  * 모델에게 돌려줄 도구 결과의 최대 글자 수
#  - 결과가 너무 길면 모델이 한 번에 읽을 수 있는 양(컨텍스트)을 넘거나 비용이 커지므로
#    뒷부분을 자름
MAX_RESULT_CHARS = 20_000


#  * 도구 1개의 정보
#  - definition: LLM에 보내는 도구 설명 (이름, 설명, 받을 값의 형식)
#    => 모델은 이 설명을 읽고 "언제, 어떤 값으로" 도구를 호출할지 스스로 판단함
#  - label, summary: 화면에 보여줄 이름과 설명
#  - handler: 실제로 도구를 실행하는 함수
@dataclass(frozen=True)
class Tool:
    definition: ToolDefinition
    label: str
    summary: str
    handler: Callable[[dict[str, Any]], Awaitable[str]]


#  * 도구 실행 결과
#  - content: 모델에게 돌려줄 결과 (실패하면 오류 메시지)
#  - is_error: 실패 여부 (화면에서 실패 표시용)
#  - duration_ms: 실행에 걸린 시간 (밀리초)
@dataclass(frozen=True)
class ToolResult:
    content: str
    is_error: bool
    duration_ms: int


#  * 사용할 수 있는 도구 목록
#  - 도구 이름(name)은 영문, 숫자, _ 만 사용 (LLM 공급자마다 이름 규칙이 있음)
#  - 이름을 바꾸면 그 도구를 연결해 둔 에이전트에서 도구가 빠지므로 주의
_TOOLS: list[Tool] = [
    Tool(
        definition=ToolDefinition(
            name="get_current_time",
            # [수정] * 나라/도시 이름(location)으로도 조회할 수 있게 변경 [2026-11-11 10:30]
            # [기존] timezone(IANA 시간대 이름)만 받았습니다.
            # [변경] location(나라/도시 이름)을 추가하고,
            #        모델이 location 을 쓰도록 설명(description)에 안내합니다.
            #        화면 설명(summary)도 함께 수정했습니다.
            description=(
                "현재 날짜, 시각, 요일을 조회합니다. "
                "오늘 날짜나 지금 시각이 필요한 질문에 사용하세요. "
                "다른 나라나 도시의 시각은 location 에 이름을 그대로 넣으세요. "
                "(시간대 이름을 몰라도 됨, 한국어/영어 모두 가능)"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "나라 또는 도시 이름 (예: 캐나다, 러시아, 뉴욕, Germany)",
                    },
                    "timezone": {
                        "type": "string",
                        "description": (
                            "IANA 시간대 이름 또는 UTC 시차 (예: Europe/Moscow, UTC+3) "
                            "- location 을 넣었으면 생략"
                        ),
                    },
                },
            },
        ),
        label="현재 시각",
        summary=(
            "현재 날짜, 시각, 요일을 알려줍니다. "
            "나라/도시 이름으로도 조회할 수 있습니다. (기본: 한국)"
        ),
        handler=builtin.get_current_time,
    ),
    Tool(
        definition=ToolDefinition(
            name="calculator",
            description=(
                "수학 계산식을 정확하게 계산합니다. 숫자 계산이 필요하면 직접 계산하지 말고 "
                "이 도구를 사용하세요. 지원: + - * / // % ** 괄호, "
                "sqrt abs round floor ceil log log10 exp sin cos tan, pi e"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "계산식 (예: (1250 * 12) / 7, sqrt(2) * 10)",
                    }
                },
                "required": ["expression"],
            },
        ),
        label="계산기",
        summary="사칙연산, 거듭제곱, 제곱근 등 계산식을 정확하게 계산합니다.",
        handler=builtin.calculator,
    ),
]

# 이름으로 도구를 빠르게 찾기 위한 사전 {도구 이름: 도구}
_TOOLS_BY_NAME: dict[str, Tool] = {tool.definition.name: tool for tool in _TOOLS}


# 화면에 보여줄 도구 목록
def list_tools() -> list[Tool]:
    return list(_TOOLS)


# 등록된 도구 이름인지 확인
def is_known_tool(name: str) -> bool:
    return name in _TOOLS_BY_NAME


# LLM에 보낼 도구 설명 목록 (목록에 없는 이름은 건너뜀 - 도구가 삭제된 경우 대비)
def get_tool_definitions(names: list[str]) -> list[ToolDefinition]:
    return [_TOOLS_BY_NAME[name].definition for name in names if name in _TOOLS_BY_NAME]


# 결과가 너무 길면 뒷부분을 자르고 잘렸다는 표시를 붙임
def _truncate(text: str) -> str:
    if len(text) <= MAX_RESULT_CHARS:
        return text
    return f"{text[:MAX_RESULT_CHARS]}\n... (결과가 너무 길어 {MAX_RESULT_CHARS:,}자까지만 표시)"


#  * 도구 실행
#  - 실패해도 에러를 던지지 않고 ToolResult(is_error=True)로 돌려줌
#    => 실패 내용을 모델에게 알려주면, 모델이 값을 고쳐서 다시 호출하거나 사용자에게 설명할 수 있음
async def execute_tool(name: str, arguments: dict[str, Any]) -> ToolResult:
    started = time.perf_counter()

    # 실행에 걸린 시간 (밀리초)
    def elapsed_ms() -> int:
        return int((time.perf_counter() - started) * 1000)

    # 1. 도구 찾기
    tool = _TOOLS_BY_NAME.get(name)
    if tool is None:
        return ToolResult(f"오류: 등록되지 않은 도구입니다. ({name})", True, elapsed_ms())

    # 2. 실행 (최대 실행 시간을 넘으면 중단)
    try:
        async with asyncio.timeout(TOOL_TIMEOUT_SECONDS):
            content = await tool.handler(arguments)
    except ToolError as err:
        return ToolResult(f"오류: {err}", True, elapsed_ms())
    except TimeoutError:
        return ToolResult(
            f"오류: 도구 실행 시간이 {TOOL_TIMEOUT_SECONDS}초를 넘어 중단했습니다.",
            True,
            elapsed_ms(),
        )
    except Exception:
        # 예상하지 못한 에러: 서버 로그에 자세히 남기고, 모델에게는 일반 메시지만 보냄
        logger.exception("도구 실행 중 예상하지 못한 오류가 발생했습니다. (도구: %s)", name)
        return ToolResult("오류: 도구 실행 중 서버 오류가 발생했습니다.", True, elapsed_ms())

    # 3. 성공
    return ToolResult(_truncate(content), False, elapsed_ms())
