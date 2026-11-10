#  * LLM 호출 담당
#  - 모든 LLM 호출은 이 파일 한 곳에서만 함 (CLAUDE.md 규칙)
#    => 다른 LLM 제품이나 서빙 방식을 추가/교체할 때 이 파일만 수정하면 되도록 함
#
# 📌 지원하는 연결 방식 (LLMProviderType)
#  1) openai_compatible: OpenAI 호환 API (POST {base_url}/chat/completions)
#     - 개발: Ollama  (예: http://localhost:11434/v1)
#     - 납품: vLLM    (예: http://GPU서버주소:8000/v1)
#     => 둘 다 같은 형식이라 "공급자 주소만 바꾸면" 코드 수정 없이 전환 가능
#  2) bedrock: AWS Bedrock Converse API (POST .../model/{모델ID}/converse-stream)
#     - 인증: Bedrock API 키 (Authorization: Bearer 키)
#     - 모델 ID: 교차 리전 추론 ID 사용 (예: 서울 리전 => global.amazon.nova-2-lite-v1:0)
#     - Converse API로 스트리밍 답변, 도구 호출, 토큰 사용량을 받아 공통 형식으로 돌려줌
#
# 📌 다른 파일에서 사용하는 함수
#  - stream_chat(): 답변을 조각(몇 글자) 단위로 실시간으로 받음 (테스트 대화 화면)
#  - chat()       : 답변이 끝날 때까지 기다렸다가 한 번에 받음 (나중에 에이전트/워크플로우에서 사용)
#  - list_models(): 공급자 서버에 설치된 모델 이름 목록 (모델 등록 화면의 "불러오기" 버튼)
#  - 입력/출력은 모두 이 파일의 형식(dataclass)만 사용
#    => 다른 파일은 공급자마다 다른 응답 형식을 몰라도 됨
#
# 📌 용어
#  - reasoning(생각 과정): qwen3.5, gpt-oss 같은 모델이 답변 전에 출력하는 "생각하는 내용"
#  - tool call(도구 호출): 모델이 "이 도구를 이런 값으로 실행해 줘"라고 요청하는 것
#    (MCP 연동에 사용)
#  - token(토큰): LLM이 글자를 처리하는 단위 (사용량/비용 계산 기준)

import json
import re  # 정규식(문자열 형식 검사) - AWS 리전 이름 검사용
import struct  # 바이트 => 숫자 변환 - Bedrock 이벤트 스트림 해석용
import time
import zlib  # CRC 검사값 계산 - Bedrock 응답 데이터 손상 확인용
from collections.abc import AsyncIterator, Iterator
from contextlib import aclosing  # 비동기 제너레이터를 중간에 멈춰도 연결을 확실히 닫아주는 도구
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal
from urllib.parse import quote  # 주소에 넣을 문자열 변환 (모델 ID의 : 등)

import httpx  # 비동기 HTTP 요청 라이브러리 (LLM 서버 호출용)

from src.core.config import get_settings

# get_settings()를 호출하여 환경변수 객체 가져오기 (LLM 응답 대기 시간 등)
settings = get_settings()


# LLM 공급자 연결 방식
#  - DB에는 값(value)이 저장됨 (예: "openai_compatible")
class LLMProviderType(Enum):
    OPENAI_COMPATIBLE = "openai_compatible"
    BEDROCK = "bedrock"


# LLM 호출 관련 에러 (메시지는 화면에 그대로 보여줄 수 있는 한국어)
class LLMError(Exception):
    pass


# ============================================================
# 1. 입력/출력 형식 (dataclass)
#  - @dataclass: 값만 담는 클래스를 간단하게 만들어 주는 파이썬 기능
#  - frozen=True: 만든 뒤에는 값을 바꿀 수 없음 (실수로 값을 바꾸는 것을 막음)
# ============================================================


#  * 공급자 접속 정보
#  - DB의 공급자 정보(API 키는 복호화된 상태)를 이 형식으로 바꿔서 넘겨받음
#  - core는 services(DB 모델)를 import 하지 않으므로, 필요한 값만 이 형식으로 전달받음
@dataclass(frozen=True)
class LLMConnection:
    provider_type: LLMProviderType
    base_url: str | None = None  # openai_compatible: 서버 주소 (/v1 까지)
    api_key: str | None = None  # 인증 키 (Ollama처럼 필요 없으면 None)
    region: str | None = None  # bedrock: AWS 리전 (예: us-east-1)


# 모델에게 알려줄 도구 1개 (MCP 연동 시 사용)
@dataclass(frozen=True)
class ToolDefinition:
    name: str  # 도구 이름 (예: get_weather)
    description: str  # 도구 설명 (모델이 언제 이 도구를 쓸지 판단하는 근거)
    parameters: dict[str, Any]  # 도구에 넘길 값의 형식 (JSON Schema)


# 모델이 요청한 도구 실행 1건
@dataclass(frozen=True)
class ToolCall:
    id: str  # 도구 호출 번호 (도구 실행 결과를 돌려줄 때 이 번호로 짝을 맞춤)
    name: str  # 실행할 도구 이름
    arguments: dict[str, Any]  # 도구에 넘길 값 (예: {"city": "서울"})


#  * 대화 메시지 1개
#  - role: system(지시문) / user(사용자) / assistant(모델) / tool(도구 실행 결과)
#  - field(default_factory=list): 메시지마다 "새 빈 리스트"를 만들어 줌
#    (기본값을 [] 로 직접 쓰면 모든 메시지가 같은 리스트를 공유하는 버그가 생김)
@dataclass(frozen=True)
class ChatMessage:
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)  # assistant가 요청한 도구 실행
    tool_call_id: str | None = None  # tool 메시지: 어떤 도구 호출의 결과인지


#  * 생각 과정 수준(reasoning_effort) 옵션
#  - 단순한 질문에서 생각 과정을 끄거나 줄여 답변 시간을 줄일 수 있도록
#    ReasoningEffort 와 GenerationParams.reasoning_effort 추가
#  * 생각 과정 수준 (None이면 보내지 않음 => 모델 기본값)
#  - none: 끄기 / low: 짧게 / medium: 보통 / high: 길게
#  - 생각을 줄이면 답변이 빨라지지만, 여러 단계로 판단해야 하는 질문은 정확도가 떨어질 수 있음
#  - 현재는 OpenAI 호환 방식(Ollama)만 적용, Bedrock은 무시함 (Nova 2 Lite는 기본이 생각 끔)
#  - 모델마다 반응이 다름 (Ollama 0.33 측정)
#    - qwen3.5: none => 생각 과정 완전히 꺼짐
#    - gpt-oss: none으로도 완전히 꺼지지 않고 짧게 생각함 (low와 비슷)
#  - ⚠️ vLLM(납품)은 qwen 계열의 생각 끄기 방식이 다름 (chat_template_kwargs 사용)
#    => 납품 전 vLLM에서 확인 후, 필요하면 아래 _stream_openai_compatible 한 곳만 수정
ReasoningEffort = Literal["none", "low", "medium", "high"]


#  * 답변 생성 옵션 (None이면 보내지 않음 => 공급자 서버의 기본값 사용)
#  - temperature: 답변의 무작위성 (0에 가까울수록 일정한 답, 높을수록 다양한 답)
#  - max_tokens : 답변 최대 길이 (토큰 수, 생각 과정도 포함될 수 있음)
#  - top_p      : 답변 후보 단어의 범위 (보통 temperature와 둘 중 하나만 조절)
#  - reasoning_effort: 생각 과정 수준 (위 ReasoningEffort 설명 참고)
@dataclass(frozen=True)
class GenerationParams:
    temperature: float | None = None
    max_tokens: int | None = None
    top_p: float | None = None
    reasoning_effort: ReasoningEffort | None = None


# 토큰 사용량
@dataclass(frozen=True)
class LLMUsage:
    input_tokens: int = 0  # 보낸 내용(질문 + 대화 기록)의 토큰 수
    output_tokens: int = 0  # 받은 답변(생각 과정 포함)의 토큰 수


#  * 스트리밍 이벤트 1개 (stream_chat()이 하나씩 돌려줌)
#  - type
#    - reasoning: 생각 과정 조각 (text)
#    - content  : 답변 조각 (text)
#    - tool_call: 도구 호출 요청 1건 (tool_call) - 답변이 끝난 뒤 한 번에 전달
#    - done     : 답변 끝 (usage: 토큰 사용량, finish_reason: 끝난 이유)
#  - finish_reason 예) stop(정상 종료), length(max_tokens에 걸려 잘림), tool_calls(도구 호출)
@dataclass(frozen=True)
class LLMStreamEvent:
    type: Literal["reasoning", "content", "tool_call", "done"]
    text: str = ""
    tool_call: ToolCall | None = None
    usage: LLMUsage | None = None
    finish_reason: str | None = None


# 한 번에 받는 답변 결과 (chat()의 반환값)
@dataclass(frozen=True)
class LLMResult:
    content: str  # 답변
    reasoning: str  # 생각 과정 (없으면 빈 문자열)
    tool_calls: list[ToolCall]  # 도구 호출 요청 목록 (없으면 빈 리스트)
    usage: LLMUsage
    finish_reason: str | None
    latency_ms: int  # 요청부터 답변 끝까지 걸린 시간 (밀리초)


# ============================================================
# 2. 공통 도우미 함수 (이 파일 안에서만 사용 => 이름 앞에 _)
# ============================================================


#  * 요청 제한 시간
#  - connect: 서버에 접속할 때까지 / read: 응답 조각 사이 간격
#  - write: 요청 보내기 / pool: 연결 대기
def _timeout() -> httpx.Timeout:
    return httpx.Timeout(
        connect=10.0,
        read=float(settings.llm_request_timeout),
        write=30.0,
        pool=10.0,
    )


# 공급자 주소 꺼내기 (끝의 / 제거 => "http://.../v1/" + "/models" 처럼 // 가 되는 것 방지)
def _base_url(connection: LLMConnection) -> str:
    if not connection.base_url:
        raise LLMError("공급자 주소(base_url)가 설정되지 않았습니다.")
    return connection.base_url.rstrip("/")


# 요청 헤더 (API 키가 있으면 "Authorization: Bearer 키" 추가)
def _headers(connection: LLMConnection) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if connection.api_key:
        headers["Authorization"] = f"Bearer {connection.api_key}"
    return headers


#  * httpx 통신 에러 => 화면에 보여줄 LLMError로 변환
#  - 에러 원문에는 내부 주소 등이 들어있을 수 있어 에러 "종류" 이름만 덧붙임
def _to_llm_error(err: httpx.HTTPError) -> LLMError:
    if isinstance(err, httpx.ConnectError):
        return LLMError(
            "LLM 서버에 연결할 수 없습니다. 공급자 주소와 서버 실행 상태를 확인해 주세요."
        )
    if isinstance(err, httpx.TimeoutException):
        return LLMError(
            f"LLM 서버의 응답 시간이 초과되었습니다. (제한: {settings.llm_request_timeout}초)"
        )
    return LLMError(f"LLM 서버와 통신 중 오류가 발생했습니다. ({type(err).__name__})")


#  * 실패 응답(400번대, 500번대)이면 에러 메시지를 꺼내서 LLMError 발생
#  - OpenAI 호환 서버의 에러 형식: {"error": {"message": "model 'x' not found", ...}}
#  - AWS Bedrock 에러 형식: {"message": "..."} (또는 "Message")
async def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code < 400:
        return
    # 스트리밍 응답은 본문을 아직 읽지 않았으므로 aread()로 끝까지 읽음
    body = (await response.aread()).decode("utf-8", errors="replace")
    detail = body[:300]  # JSON이 아니면 앞부분 300자만 사용
    try:
        parsed = json.loads(body)
        if isinstance(parsed, dict):
            error = parsed.get("error")
            if isinstance(error, dict) and error.get("message"):
                detail = str(error["message"])
            elif isinstance(error, str):
                detail = error
            elif isinstance(parsed.get("message"), str):
                detail = parsed["message"]
            elif isinstance(parsed.get("Message"), str):
                detail = parsed["Message"]
    except ValueError:
        pass
    raise LLMError(f"LLM 서버가 오류를 응답했습니다. ({response.status_code}: {detail})")


# 우리 형식의 메시지(ChatMessage) => OpenAI 형식(dict)으로 변환
def _to_openai_message(message: ChatMessage) -> dict[str, Any]:
    data: dict[str, Any] = {"role": message.role, "content": message.content}
    if message.tool_calls:
        data["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                # OpenAI 형식은 arguments를 "JSON 문자열"로 보내야 함
                "function": {
                    "name": call.name,
                    "arguments": json.dumps(call.arguments, ensure_ascii=False),
                },
            }
            for call in message.tool_calls
        ]
    if message.tool_call_id:
        data["tool_call_id"] = message.tool_call_id
    return data


#  * 도구 호출 인자(JSON 문자열) => dict 변환
#  - 작은 모델은 가끔 잘못된 JSON을 만들기 때문에, 실패하면 원인을 알 수 있는 에러를 냄
def _parse_tool_arguments(raw: str, tool_name: str) -> dict[str, Any]:
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError as err:
        raise LLMError(
            f"모델이 만든 도구 호출 값을 해석할 수 없습니다. (도구: {tool_name})"
        ) from err
    if not isinstance(parsed, dict):
        raise LLMError(f"모델이 만든 도구 호출 값의 형식이 올바르지 않습니다. (도구: {tool_name})")
    return parsed


#  * 답변 끝 이벤트 만들기를 공통 함수로 분리
#  OpenAI 호환 방식 함수 안에 직접 작성되어 있음
#  Bedrock 방식도 똑같이 사용하도록 공통 함수로 분리 (동작은 같음)
#  * 답변이 끝난 뒤 보내는 이벤트들 (모아둔 도구 호출 => 끝(done))
#  - pending_tool_calls: {순서번호: {"id": .., "name": .., "arguments": "JSON 문자열"}}
#  - Iterator[...]: "for"로 하나씩 꺼낼 수 있는 값을 돌려준다는 뜻 (yield 사용)
def _final_events(
    pending_tool_calls: dict[int, dict[str, str]],
    usage: LLMUsage,
    finish_reason: str | None,
) -> Iterator[LLMStreamEvent]:
    # 1. 모아둔 도구 호출을 순서대로 전달
    for index in sorted(pending_tool_calls):
        pending = pending_tool_calls[index]
        yield LLMStreamEvent(
            type="tool_call",
            tool_call=ToolCall(
                id=pending["id"] or f"call_{index}",
                name=pending["name"],
                arguments=_parse_tool_arguments(pending["arguments"], pending["name"]),
            ),
        )
    # 2. 끝 (토큰 사용량 + 끝난 이유)
    yield LLMStreamEvent(type="done", usage=usage, finish_reason=finish_reason)


# ============================================================
# 3. OpenAI 호환 방식 (Ollama, vLLM)
# ============================================================


#  * OpenAI 호환 서버에 스트리밍으로 답변 요청
#  - SSE(Server-Sent Events) 형식으로 한 줄씩 응답이 옴
#      data: {"choices":[{"delta":{"reasoning":"생각"}}]}
#      data: {"choices":[{"delta":{"content":"답변"}}]}
#      data: {"choices":[],"usage":{"prompt_tokens":21,"completion_tokens":50}}
#      data: [DONE]
#  - AsyncIterator[...]: "async for"로 하나씩 꺼낼 수 있는 값을 돌려준다는 뜻 (yield 사용)
async def _stream_openai_compatible(
    connection: LLMConnection,
    model: str,
    messages: list[ChatMessage],
    params: GenerationParams,
    tools: list[ToolDefinition] | None,
) -> AsyncIterator[LLMStreamEvent]:
    # 1. 요청 내용 만들기
    #  - stream_options.include_usage: 마지막에 토큰 사용량을 함께 보내달라는 옵션
    payload: dict[str, Any] = {
        "model": model,
        "messages": [_to_openai_message(message) for message in messages],
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if params.temperature is not None:
        payload["temperature"] = params.temperature
    if params.max_tokens is not None:
        payload["max_tokens"] = params.max_tokens
    if params.top_p is not None:
        payload["top_p"] = params.top_p
    #  * 생각 과정 수준 전달
    #  - 값이 있으면 reasoning_effort로 보냄 (Ollama: none이면 qwen3.5의 생각 과정이 꺼짐)
    if params.reasoning_effort is not None:
        payload["reasoning_effort"] = params.reasoning_effort
    if tools:
        payload["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            }
            for tool in tools
        ]

    # 2. 응답 조각을 읽으면서 이벤트로 바꿔서 돌려줌
    #  - 도구 호출은 서버에 따라 여러 조각으로 나뉘어 올 수 있음 (vLLM: 인자가 몇 글자씩 나뉘어 옴)
    #    => index(몇 번째 도구 호출인지)별로 이어 붙였다가, 답변이 끝난 뒤 한 번에 전달
    pending_tool_calls: dict[int, dict[str, str]] = {}
    usage = LLMUsage()
    finish_reason: str | None = None

    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            async with client.stream(
                "POST",
                f"{_base_url(connection)}/chat/completions",
                headers=_headers(connection),
                json=payload,
            ) as response:
                await _raise_for_status(response)
                # aiter_lines(): 응답을 한 줄씩 꺼냄 (도착하는 대로 바로바로)
                async for line in response.aiter_lines():
                    # 2-1. "data: ..." 줄만 처리 (빈 줄 등은 건너뜀)
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)

                    # 2-2. 토큰 사용량 (보통 마지막 조각에 들어 있음)
                    if chunk.get("usage"):
                        usage = LLMUsage(
                            input_tokens=chunk["usage"].get("prompt_tokens") or 0,
                            output_tokens=chunk["usage"].get("completion_tokens") or 0,
                        )

                    for choice in chunk.get("choices") or []:
                        delta = choice.get("delta") or {}
                        # 2-3. 생각 과정 (Ollama: reasoning / vLLM: reasoning_content)
                        reasoning = delta.get("reasoning") or delta.get("reasoning_content")
                        if reasoning:
                            yield LLMStreamEvent(type="reasoning", text=reasoning)
                        # 2-4. 답변
                        if delta.get("content"):
                            yield LLMStreamEvent(type="content", text=delta["content"])
                        # 2-5. 도구 호출 조각 이어 붙이기
                        for tool_delta in delta.get("tool_calls") or []:
                            index = tool_delta.get("index", 0)
                            pending = pending_tool_calls.setdefault(
                                index, {"id": "", "name": "", "arguments": ""}
                            )
                            if tool_delta.get("id"):
                                pending["id"] = tool_delta["id"]
                            function = tool_delta.get("function") or {}
                            if function.get("name"):
                                pending["name"] = function["name"]
                            if function.get("arguments"):
                                pending["arguments"] += function["arguments"]
                        # 2-6. 답변이 끝난 이유
                        if choice.get("finish_reason"):
                            finish_reason = choice["finish_reason"]
    except httpx.HTTPError as err:
        raise _to_llm_error(err) from err
    except json.JSONDecodeError as err:
        raise LLMError("LLM 서버의 응답 형식을 해석할 수 없습니다.") from err

    # 3. 모아둔 도구 호출 + 끝 이벤트 전달
    # 공통 함수(_final_events)로 분리
    for event in _final_events(pending_tool_calls, usage, finish_reason):
        yield event


#  * OpenAI 호환 서버에 설치된 모델 목록 조회 (GET {base_url}/models)
#  - 응답 형식: {"data": [{"id": "qwen3.5:9b"}, {"id": "gpt-oss:latest"}, ...]}
async def _list_openai_compatible_models(connection: LLMConnection) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            response = await client.get(
                f"{_base_url(connection)}/models",
                headers=_headers(connection),
            )
            await _raise_for_status(response)
            data = response.json()
    except httpx.HTTPError as err:
        raise _to_llm_error(err) from err
    except ValueError as err:
        raise LLMError("LLM 서버의 모델 목록 형식을 해석할 수 없습니다.") from err

    model_ids = [item.get("id") for item in data.get("data") or [] if isinstance(item, dict)]
    return sorted(model_id for model_id in model_ids if model_id)


# ============================================================
# 4. AWS Bedrock (Converse API)
# Converse API(converse-stream)로 Bedrock 모델을 호출
#
# 📌 OpenAI 호환 방식과 다른 점
#  - 주소: https://bedrock-runtime.{리전}.amazonaws.com/model/{모델ID}/converse-stream
#  - 메시지 형식: content가 문자열이 아니라 "블록 목록" (예: [{"text": "안녕"}])
#    - 시스템 프롬프트는 messages가 아니라 별도의 "system" 항목으로 보냄
#    - 도구 실행 결과는 user 메시지 안의 toolResult 블록으로 보냄
#    - user / assistant 가 번갈아 와야 함 (같은 역할이 연속되면 하나로 합침)
#  - 스트리밍 응답: SSE(글자)가 아니라 AWS 이벤트 스트림(바이너리) 형식
# ============================================================

# AWS 리전 이름 형식 (예: ap-northeast-2, us-east-1)
#  - 리전 이름이 요청 주소(도메인)에 들어가므로, 이상한 값이 들어오면 엉뚱한 서버로
#    API 키가 전송될 수 있음 => 형식이 맞는지 반드시 검사
_AWS_REGION_PATTERN = re.compile(r"^[a-z]{2}(-[a-z]+)+-\d+$")

#  * Bedrock의 답변 종료 이유 => OpenAI 호환 방식과 같은 이름으로 통일
#  - 화면에서 "length"(잘림)인지 등을 공급자와 상관없이 같은 방식으로 확인하기 위함
#  - 표에 없는 값(예: guardrail_intervened)은 그대로 전달
_BEDROCK_STOP_REASONS = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "tool_use": "tool_calls",
    "max_tokens": "length",
}


# AWS 리전 이름 형식이 맞는지 확인 (services의 공급자 등록 검사에서도 사용)
def is_valid_aws_region(region: str) -> bool:
    return bool(_AWS_REGION_PATTERN.match(region))


#  * Bedrock 요청 주소 만들기
#  - quote(..., safe=""): 모델 ID 안의 특수문자(:, / 등)를 주소에 쓸 수 있는 형식으로 바꿈
#    (예: "global.amazon.nova-2-lite-v1:0" => "global.amazon.nova-2-lite-v1%3A0")
def _bedrock_url(connection: LLMConnection, model: str, action: str) -> str:
    region = (connection.region or "").strip()
    if not is_valid_aws_region(region):
        raise LLMError("AWS 리전 형식이 올바르지 않습니다. (예: ap-northeast-2)")
    return f"https://bedrock-runtime.{region}.amazonaws.com/model/{quote(model, safe='')}/{action}"


#  * 우리 형식의 메시지 목록 => Bedrock 형식으로 변환
#  - 반환값: (system 목록, messages 목록)
def _to_bedrock_messages(
    messages: list[ChatMessage],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    system: list[dict[str, Any]] = []
    converted: list[dict[str, Any]] = []

    for message in messages:
        # 1. 시스템 프롬프트 => 별도의 system 항목으로
        if message.role == "system":
            if message.content:
                system.append({"text": message.content})
            continue

        # 2. 역할별 내용 블록 만들기
        if message.role == "tool":
            # 2-1. 도구 실행 결과 => user 메시지 안의 toolResult 블록
            role = "user"
            blocks: list[dict[str, Any]] = [
                {
                    "toolResult": {
                        "toolUseId": message.tool_call_id or "",
                        "content": [{"text": message.content or "(결과 없음)"}],
                    }
                }
            ]
        else:
            # 2-2. user / assistant => text 블록 (+ assistant의 도구 호출 요청은 toolUse 블록)
            #  - Bedrock은 빈 text 블록을 허용하지 않으므로 내용이 있을 때만 넣음
            role = message.role
            blocks = [{"text": message.content}] if message.content else []
            for call in message.tool_calls:
                blocks.append(
                    {"toolUse": {"toolUseId": call.id, "name": call.name, "input": call.arguments}}
                )
            if not blocks:
                continue

        # 3. 바로 앞 메시지와 역할이 같으면 하나로 합침 (Bedrock은 역할이 번갈아 와야 함)
        if converted and converted[-1]["role"] == role:
            converted[-1]["content"].extend(blocks)
        else:
            converted.append({"role": role, "content": blocks})

    return system, converted


#  * AWS 이벤트 스트림 헤더 해석
#  - 헤더 1개 구조: [이름 길이 1바이트][이름][값 종류 1바이트][값]
#  - 값 종류 번호: 0/1=참/거짓, 2=1바이트 숫자, 3=2바이트, 4=4바이트, 5=8바이트,
#                  6=바이트열, 7=문자열, 8=시각(8바이트), 9=UUID(16바이트)
#  - struct.unpack(">I", ...): 바이트를 숫자로 바꿈 (> : 큰 자리부터 저장된 형식)
def _parse_event_headers(data: bytes) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    pos = 0
    while pos < len(data):
        name_length = data[pos]
        pos += 1
        name = data[pos : pos + name_length].decode("utf-8")
        pos += name_length
        value_type = data[pos]
        pos += 1
        value: Any
        if value_type in (0, 1):
            value = value_type == 0
        elif value_type == 2:
            value = data[pos]
            pos += 1
        elif value_type == 3:
            (value,) = struct.unpack(">h", data[pos : pos + 2])
            pos += 2
        elif value_type == 4:
            (value,) = struct.unpack(">i", data[pos : pos + 4])
            pos += 4
        elif value_type in (5, 8):
            (value,) = struct.unpack(">q", data[pos : pos + 8])
            pos += 8
        elif value_type in (6, 7):
            (length,) = struct.unpack(">H", data[pos : pos + 2])
            pos += 2
            raw = data[pos : pos + length]
            pos += length
            value = raw.decode("utf-8") if value_type == 7 else raw
        elif value_type == 9:
            value = data[pos : pos + 16]
            pos += 16
        else:
            raise LLMError("Bedrock 응답의 헤더 형식을 해석할 수 없습니다.")
        headers[name] = value
    return headers


#  * AWS 이벤트 스트림(바이너리) 해석기
#  - Bedrock 스트리밍 응답은 아래 구조의 "메시지"가 계속 이어져서 옴
#      [전체 길이 4바이트][헤더 길이 4바이트][앞부분 CRC 4바이트]
#      [헤더들][본문(JSON)][전체 CRC 4바이트]
#  - CRC: 데이터가 전송 중에 깨지지 않았는지 확인하는 검사값 (zlib.crc32로 계산해서 비교)
#  - 응답 조각이 메시지 중간에서 끊겨 올 수 있으므로, 완성된 메시지만 꺼내고 나머지는 모아둠
class _EventStreamDecoder:
    def __init__(self) -> None:
        self._buffer = bytearray()  # 아직 처리하지 못한(덜 도착한) 바이트

    # 새로 도착한 조각을 넣고, 완성된 메시지 목록 [(헤더, 본문), ...]을 돌려줌
    def feed(self, data: bytes) -> list[tuple[dict[str, Any], bytes]]:
        self._buffer.extend(data)
        messages: list[tuple[dict[str, Any], bytes]] = []
        # 앞부분(12바이트)이 모두 도착해야 메시지 길이를 알 수 있음
        while len(self._buffer) >= 12:
            total_length, headers_length, prelude_crc = struct.unpack(">III", self._buffer[:12])
            if zlib.crc32(self._buffer[:8]) != prelude_crc or total_length < 16:
                raise LLMError("Bedrock 응답 데이터가 손상되었습니다.")
            # 메시지 전체가 아직 도착하지 않았으면 다음 조각을 기다림
            if len(self._buffer) < total_length:
                break
            message = bytes(self._buffer[:total_length])
            del self._buffer[:total_length]
            (message_crc,) = struct.unpack(">I", message[-4:])
            if zlib.crc32(message[:-4]) != message_crc:
                raise LLMError("Bedrock 응답 데이터가 손상되었습니다.")
            headers = _parse_event_headers(message[12 : 12 + headers_length])
            payload = message[12 + headers_length : -4]
            messages.append((headers, payload))
        return messages


#  * Bedrock에 스트리밍으로 답변 요청 (ConverseStream)
#  - 이벤트 종류(:event-type 헤더)
#    - contentBlockStart: 새 내용 블록 시작 (도구 호출이면 도구 이름/번호가 들어있음)
#    - contentBlockDelta: 내용 조각 (text: 답변 / reasoningContent: 생각 과정 / toolUse: 도구 인자)
#    - messageStop      : 답변 끝 (stopReason: 끝난 이유)
#    - metadata         : 토큰 사용량
#  - 오류는 :message-type 헤더가 "exception"(또는 "error")인 메시지로 옴
async def _stream_bedrock(
    connection: LLMConnection,
    model: str,
    messages: list[ChatMessage],
    params: GenerationParams,
    tools: list[ToolDefinition] | None,
) -> AsyncIterator[LLMStreamEvent]:
    if not connection.api_key:
        raise LLMError("AWS Bedrock API 키가 설정되지 않았습니다.")

    # 1. 요청 내용 만들기
    system, converted = _to_bedrock_messages(messages)
    if not converted:
        raise LLMError("보낼 대화 메시지가 없습니다.")
    payload: dict[str, Any] = {"messages": converted}
    if system:
        payload["system"] = system
    # 1-1. 생성 옵션 (Bedrock 이름: maxTokens, temperature, topP)
    inference_config: dict[str, Any] = {}
    if params.max_tokens is not None:
        inference_config["maxTokens"] = params.max_tokens
    if params.temperature is not None:
        inference_config["temperature"] = params.temperature
    if params.top_p is not None:
        inference_config["topP"] = params.top_p
    if inference_config:
        payload["inferenceConfig"] = inference_config
    # 1-2. 도구 목록 (Bedrock 형식: toolSpec + inputSchema.json)
    if tools:
        payload["toolConfig"] = {
            "tools": [
                {
                    "toolSpec": {
                        "name": tool.name,
                        "description": tool.description,
                        "inputSchema": {"json": tool.parameters},
                    }
                }
                for tool in tools
            ]
        }

    # 2. 응답 메시지를 하나씩 해석해서 이벤트로 바꿔서 돌려줌
    #  - 도구 호출은 contentBlockIndex(몇 번째 내용 블록인지)별로 인자 조각을 이어 붙임
    decoder = _EventStreamDecoder()
    pending_tool_calls: dict[int, dict[str, str]] = {}
    usage = LLMUsage()
    finish_reason: str | None = None

    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            async with client.stream(
                "POST",
                _bedrock_url(connection, model, "converse-stream"),
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/vnd.amazon.eventstream",
                    "Authorization": f"Bearer {connection.api_key}",
                },
                json=payload,
            ) as response:
                await _raise_for_status(response)
                # aiter_bytes(): 응답을 바이트 조각으로 꺼냄 (도착하는 대로 바로바로)
                async for data in response.aiter_bytes():
                    for headers, body in decoder.feed(data):
                        event = json.loads(body) if body else {}

                        # 2-1. 오류 메시지 (예: 권한 없음, 요청 한도 초과, 잘못된 요청)
                        if headers.get(":message-type") in ("exception", "error"):
                            error_type = headers.get(":exception-type") or headers.get(
                                ":error-code", "error"
                            )
                            error_message = event.get("message") or headers.get(":error-message")
                            raise LLMError(
                                f"Bedrock이 오류를 응답했습니다. ({error_type}: {error_message})"
                            )

                        event_type = headers.get(":event-type")
                        index = event.get("contentBlockIndex", 0)
                        # 2-2. 도구 호출 블록 시작 (도구 이름, 호출 번호)
                        if event_type == "contentBlockStart":
                            tool_use = (event.get("start") or {}).get("toolUse")
                            if tool_use:
                                pending_tool_calls[index] = {
                                    "id": tool_use.get("toolUseId", ""),
                                    "name": tool_use.get("name", ""),
                                    "arguments": "",
                                }
                        # 2-3. 내용 조각 (답변 / 생각 과정 / 도구 인자)
                        elif event_type == "contentBlockDelta":
                            delta = event.get("delta") or {}
                            if delta.get("text"):
                                yield LLMStreamEvent(type="content", text=delta["text"])
                            reasoning = (delta.get("reasoningContent") or {}).get("text")
                            if reasoning:
                                yield LLMStreamEvent(type="reasoning", text=reasoning)
                            tool_delta = delta.get("toolUse")
                            if tool_delta:
                                pending = pending_tool_calls.setdefault(
                                    index, {"id": "", "name": "", "arguments": ""}
                                )
                                pending["arguments"] += tool_delta.get("input") or ""
                        # 2-4. 답변 끝 (끝난 이유를 공통 이름으로 바꿈)
                        elif event_type == "messageStop":
                            reason = event.get("stopReason")
                            finish_reason = _BEDROCK_STOP_REASONS.get(reason, reason)
                        # 2-5. 토큰 사용량
                        elif event_type == "metadata":
                            raw_usage = event.get("usage") or {}
                            usage = LLMUsage(
                                input_tokens=raw_usage.get("inputTokens") or 0,
                                output_tokens=raw_usage.get("outputTokens") or 0,
                            )
    except httpx.HTTPError as err:
        raise _to_llm_error(err) from err
    except json.JSONDecodeError as err:
        raise LLMError("Bedrock 응답 형식을 해석할 수 없습니다.") from err

    # 3. 모아둔 도구 호출 + 끝 이벤트 전달
    for event in _final_events(pending_tool_calls, usage, finish_reason):
        yield event


# ============================================================
# 5. 다른 파일에서 사용하는 함수
# ============================================================


#  * 스트리밍으로 답변 받기
#  - 사용 예)
#      async for event in stream_chat(connection, "qwen3.5:9b", messages):
#          if event.type == "content":
#              print(event.text, end="")
#  - 중간에 멈출 수 있음 (async with aclosing(...) 으로 감싸면 LLM 서버 연결도 바로 닫힘)
async def stream_chat(
    connection: LLMConnection,
    model: str,
    messages: list[ChatMessage],
    params: GenerationParams | None = None,
    tools: list[ToolDefinition] | None = None,
) -> AsyncIterator[LLMStreamEvent]:
    params = params or GenerationParams()

    # 공급자 연결 방식에 맞는 함수로 전달
    if connection.provider_type == LLMProviderType.OPENAI_COMPATIBLE:
        # aclosing: 호출한 쪽이 중간에 멈추면 안쪽 제너레이터도 즉시 닫아서 HTTP 연결을 정리
        async with aclosing(
            _stream_openai_compatible(connection, model, messages, params, tools)
        ) as events:
            async for event in events:
                yield event
        return

    #  * Bedrock 연결
    #  - Bedrock 방식 함수(_stream_bedrock)로 전달합니다.
    if connection.provider_type == LLMProviderType.BEDROCK:
        async with aclosing(_stream_bedrock(connection, model, messages, params, tools)) as events:
            async for event in events:
                yield event
        return

    raise LLMError(f"지원하지 않는 공급자 방식입니다. ({connection.provider_type})")


#  * 답변을 한 번에 받기 (stream_chat()의 조각들을 모두 모아서 돌려줌)
#  - 나중에 에이전트/워크플로우 실행처럼 "완성된 답변"이 필요한 곳에서 사용
async def chat(
    connection: LLMConnection,
    model: str,
    messages: list[ChatMessage],
    params: GenerationParams | None = None,
    tools: list[ToolDefinition] | None = None,
) -> LLMResult:
    # time.perf_counter(): 걸린 시간을 정밀하게 재기 위한 시계 (초 단위 실수)
    started = time.perf_counter()
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_calls: list[ToolCall] = []
    usage = LLMUsage()
    finish_reason: str | None = None

    async with aclosing(stream_chat(connection, model, messages, params, tools)) as events:
        async for event in events:
            if event.type == "content":
                content_parts.append(event.text)
            elif event.type == "reasoning":
                reasoning_parts.append(event.text)
            elif event.type == "tool_call" and event.tool_call:
                tool_calls.append(event.tool_call)
            elif event.type == "done":
                usage = event.usage or LLMUsage()
                finish_reason = event.finish_reason

    return LLMResult(
        content="".join(content_parts),
        reasoning="".join(reasoning_parts),
        tool_calls=tool_calls,
        usage=usage,
        finish_reason=finish_reason,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )


# 공급자 서버에 설치된(사용 가능한) 모델 이름 목록
async def list_models(connection: LLMConnection) -> list[str]:
    if connection.provider_type == LLMProviderType.OPENAI_COMPATIBLE:
        return await _list_openai_compatible_models(connection)
    raise LLMError(
        "이 공급자는 모델 목록 불러오기를 지원하지 않습니다. 모델 ID를 직접 입력해 주세요."
    )
