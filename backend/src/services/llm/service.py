import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core import llm
from src.core.llm import (
    ChatMessage,
    GenerationParams,
    LLMConnection,
    LLMError,
    LLMProviderType,
)
from src.core.security import SecretDecryptError, decrypt_secret, encrypt_secret
from src.services.llm import repository as llm_repository
from src.services.llm.models import LLMModel, LLMProvider
from src.services.llm.schemas import (
    AvailableModelsRes,
    ChatReq,
    DeleteRes,
    ModelCreateReq,
    ModelRes,
    ModelTestRes,
    ModelUpdateReq,
    ProviderCreateReq,
    ProviderRes,
    ProviderUpdateReq,
)

# __name__: 현재 파일의 모듈 이름으로 로거를 만들어, 로그가 어디서 나왔는지 표시
logger = logging.getLogger(__name__)

# 연결 테스트 때 모델에게 보내는 짧은 질문
TEST_PROMPT = "Hello! Please reply with a short greeting."


# ============================================================
# 1. 공통 도우미 함수 (이 파일 안에서만 사용)
# ============================================================


# SQLAlchemy 공급자 객체 -> Pydantic 응답 모델 변환
#  - API 키는 응답에 넣지 않고, 등록되어 있는지(has_api_key)만 알려줌
def _to_provider_res(provider: LLMProvider) -> ProviderRes:
    return ProviderRes(
        id=provider.id,
        name=provider.name,
        provider_type=provider.provider_type.value,
        base_url=provider.base_url,
        region=provider.region,
        has_api_key=provider.encrypted_api_key is not None,
        is_active=provider.is_active,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
        models=[ModelRes.model_validate(model) for model in provider.models],
    )


#  * 입력받은 주소 정리
#  - 앞뒤 공백, 끝의 / 제거 (예: "http://localhost:11434/v1/ " => "http://localhost:11434/v1")
#  - 빈 문자열이면 None (주소 없음)
#  - http:// 또는 https:// 로 시작하지 않으면 에러(400)
def _normalize_url(url: str | None) -> str | None:
    if url is None:
        return None
    cleaned = url.strip().rstrip("/")
    if not cleaned:
        return None
    if not cleaned.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="주소는 http:// 또는 https:// 로 시작해야 합니다.",
        )
    return cleaned


# 앞뒤 공백 제거 후 빈 문자열이면 None (리전, API 키 등에 사용)
def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


#  * AWS 리전 입력값 정리/검사 함수
#  - 소문자로 통일하고, 리전 형식(예: ap-northeast-2)이 아니면 에러(400)
#  - 리전 이름은 Bedrock 요청 주소에 들어가므로, 이상한 값으로 엉뚱한 서버에
#    API 키가 전송되지 않도록 등록 단계에서 막음 (core/llm.py 에서도 한 번 더 검사)
def _normalize_region(region: str | None) -> str | None:
    cleaned = _clean_text(region)
    if cleaned is None:
        return None
    cleaned = cleaned.lower()
    if not llm.is_valid_aws_region(cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AWS 리전 형식이 올바르지 않습니다. (예: ap-northeast-2)",
        )
    return cleaned


#  * 연결 방식에 꼭 필요한 값이 있는지 확인
#  - openai_compatible: 서버 주소(base_url) 필수
#  - bedrock          : AWS 리전(region) + API 키 필수
#  - Bedrock API 키 필수 검사
#    Bedrock API 키로만 인증하므로, API 키가 없으면 에러(400)
def _check_required_fields(provider: LLMProvider) -> None:
    if provider.provider_type == LLMProviderType.OPENAI_COMPATIBLE and not provider.base_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OpenAI 호환 공급자는 서버 주소(base_url)가 필요합니다.",
        )
    if provider.provider_type == LLMProviderType.BEDROCK and not provider.region:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AWS Bedrock 공급자는 리전(region)이 필요합니다.",
        )
    if provider.provider_type == LLMProviderType.BEDROCK and not provider.encrypted_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="AWS Bedrock 공급자는 API 키가 필요합니다.",
        )


#  * DB의 공급자 정보 -> core/llm.py 가 사용하는 접속 정보(LLMConnection)로 변환
#  - 이때 암호화된 API 키를 복호화함 (복호화된 키는 DB나 응답에 절대 다시 저장/노출하지 않음)
def _build_connection(provider: LLMProvider) -> LLMConnection:
    api_key = None
    if provider.encrypted_api_key:
        try:
            api_key = decrypt_secret(provider.encrypted_api_key)
        except SecretDecryptError as err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(err),
            ) from err
    return LLMConnection(
        provider_type=provider.provider_type,
        base_url=provider.base_url,
        api_key=api_key,
        region=provider.region,
    )


# 공급자 조회 + 없으면 에러(404)
async def _get_provider_or_404(session: AsyncSession, provider_id: int) -> LLMProvider:
    provider = await llm_repository.get_provider_by_id(session, provider_id)
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="존재하지 않는 LLM 공급자입니다.",
        )
    return provider


# 모델 조회 + 없으면 에러(404)
async def _get_model_or_404(session: AsyncSession, llm_model_id: int) -> LLMModel:
    model = await llm_repository.get_model_by_id(session, llm_model_id)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="존재하지 않는 LLM 모델입니다.",
        )
    return model


#  * "지금 사용할 수 있는" 모델인지 확인 (연결 테스트, 테스트 대화에서 사용)
#  - 모델 또는 공급자가 비활성화(사용 안 함) 상태면 에러(400)
async def _get_usable_model(session: AsyncSession, llm_model_id: int) -> LLMModel:
    model = await _get_model_or_404(session, llm_model_id)
    if not model.provider.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비활성화된 공급자의 모델입니다. 공급자를 먼저 활성화해 주세요.",
        )
    if not model.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비활성화된 모델입니다. 모델을 먼저 활성화해 주세요.",
        )
    return model


#  * 다른 기능(에이전트 실행)에서 사용할 공개 함수
#  - 모델 사용 가능 여부 확인(_get_usable_model)과 접속 정보 만들기(_build_connection)
#  * 사용할 수 있는 모델인지 확인 + 접속 정보(LLMConnection) 만들기 (에이전트 실행 등에서 사용)
#  - 모델이 없으면 404, 모델/공급자가 비활성화 상태면 400
#  - 반환값: (모델, 접속 정보) - 모델 이름은 model.model_id, 도구 지원 여부는 model.supports_tools
async def get_usable_model_connection(
    session: AsyncSession,
    llm_model_id: int,
) -> tuple[LLMModel, LLMConnection]:
    model = await _get_usable_model(session, llm_model_id)
    return model, _build_connection(model.provider)


# ============================================================
# 2. LLM 공급자 (Provider)
# ============================================================


# LLM 공급자 목록 조회(R-L) API
async def read_providers(session: AsyncSession) -> list[ProviderRes]:
    # 1. Service -> Repository
    providers = await llm_repository.get_providers(session)
    # 2. SQLAlchemy 객체 -> Pydantic Response 모델 변환
    return [_to_provider_res(provider) for provider in providers]


# LLM 공급자 등록(C) API
async def create_provider(session: AsyncSession, dto: ProviderCreateReq) -> ProviderRes:
    # 1. 이름 중복 확인
    name = dto.name.strip()
    if await llm_repository.get_provider_by_name(session, name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 같은 이름의 공급자가 있습니다.",
        )

    # 2. 공급자 객체 생성
    #  - API 키는 암호화해서 저장 (입력하지 않았으면 None)
    api_key = _clean_text(dto.api_key)
    provider = LLMProvider(
        name=name,
        provider_type=dto.provider_type,
        base_url=_normalize_url(dto.base_url),
        region=_normalize_region(dto.region),
        encrypted_api_key=encrypt_secret(api_key) if api_key else None,
    )
    # 3. 연결 방식에 필요한 값 확인
    _check_required_fields(provider)

    # 4. DB 저장 (동시에 같은 이름으로 등록하면 unique 제약에 걸림 => 409)
    try:
        # 4-1. Service -> Repository
        new_provider = await llm_repository.create_provider(session, provider)
        # 4-2. 저장 확정(commit)
        await session.commit()
    except IntegrityError as err:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 같은 이름의 공급자가 있습니다.",
        ) from err

    # 5. Service -> Router
    return _to_provider_res(new_provider)


# LLM 공급자 수정(U) API
async def update_provider(
    session: AsyncSession,
    provider_id: int,
    dto: ProviderUpdateReq,
) -> ProviderRes:
    # 1. 대상 공급자 조회
    provider = await _get_provider_or_404(session, provider_id)

    # 2. 보낸 값만 변경 (None이면 그대로 둠)
    # 2-1. 이름 (바꾸려는 이름이 다른 공급자와 겹치면 에러)
    if dto.name is not None:
        name = dto.name.strip()
        if name != provider.name and await llm_repository.get_provider_by_name(session, name):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="이미 같은 이름의 공급자가 있습니다.",
            )
        provider.name = name
    # 2-2. 접속 정보
    if dto.base_url is not None:
        provider.base_url = _normalize_url(dto.base_url)
    if dto.region is not None:
        provider.region = _normalize_region(dto.region)
    # 2-3. API 키 (삭제 요청이 우선 / 새 키를 보냈으면 암호화해서 교체)
    new_api_key = _clean_text(dto.api_key)
    if dto.clear_api_key:
        provider.encrypted_api_key = None
    elif new_api_key:
        provider.encrypted_api_key = encrypt_secret(new_api_key)
    # 2-4. 사용 여부
    if dto.is_active is not None:
        provider.is_active = dto.is_active

    # 3. 바뀐 결과가 연결 방식에 맞는지 확인 (예: 주소를 지워버린 경우)
    _check_required_fields(provider)

    # 4. DB 반영
    try:
        updated_provider = await llm_repository.update_provider(session, provider)
        await session.commit()
    except IntegrityError as err:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 같은 이름의 공급자가 있습니다.",
        ) from err

    # 5. Service -> Router
    return _to_provider_res(updated_provider)


# LLM 공급자 삭제(D) API - 등록된 모델도 함께 삭제됨
async def delete_provider(session: AsyncSession, provider_id: int) -> DeleteRes:
    # 1. 대상 공급자 조회
    provider = await _get_provider_or_404(session, provider_id)
    # 2. Service -> Repository
    await llm_repository.delete_provider(session, provider)
    # 3. 삭제 확정(commit)
    await session.commit()
    # 4. Service -> Router
    return DeleteRes(success=True)


#  * 공급자 서버에 설치된 모델 목록 조회 API (모델 등록 화면의 "불러오기")
#  - LLM 서버 연결에 실패하면 502(Bad Gateway: 우리 서버가 아니라 "연결된 서버"에 문제가 있음)
async def read_available_models(session: AsyncSession, provider_id: int) -> AvailableModelsRes:
    # 1. 대상 공급자 조회 + 접속 정보 만들기
    provider = await _get_provider_or_404(session, provider_id)
    connection = _build_connection(provider)
    # 2. DB 작업 끝 => 트랜잭션 종료
    #  - LLM 서버 응답을 기다리는 동안 DB 연결을 붙잡고 있지 않도록 먼저 끝냄
    #    (expire_on_commit=False 설정이라 commit 후에도 위에서 꺼낸 값은 그대로 사용 가능)
    await session.commit()
    # 3. Service -> core/llm.py
    try:
        model_ids = await llm.list_models(connection)
    except LLMError as err:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(err),
        ) from err
    # 4. Service -> Router
    return AvailableModelsRes(model_ids=model_ids)


# ============================================================
# 3. LLM 모델 (Model)
# ============================================================


# LLM 모델 등록(C) API
async def create_model(
    session: AsyncSession,
    provider_id: int,
    dto: ModelCreateReq,
) -> ModelRes:
    # 1. 공급자 확인
    await _get_provider_or_404(session, provider_id)

    # 2. 같은 공급자에 같은 모델 ID가 이미 있는지 확인
    model_id = dto.model_id.strip()
    if await llm_repository.get_model_by_provider_and_model_id(session, provider_id, model_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이 공급자에 이미 등록된 모델입니다.",
        )

    # 3. 모델 객체 생성
    model = LLMModel(
        provider_id=provider_id,
        model_id=model_id,
        display_name=dto.display_name.strip(),
        supports_tools=dto.supports_tools,
        supports_reasoning=dto.supports_reasoning,
    )

    # 4. DB 저장 (동시에 같은 모델을 등록하면 unique 제약에 걸림 => 409)
    try:
        new_model = await llm_repository.create_model(session, model)
        await session.commit()
    except IntegrityError as err:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이 공급자에 이미 등록된 모델입니다.",
        ) from err

    # 5. Service -> Router
    return ModelRes.model_validate(new_model)


# LLM 모델 수정(U) API
async def update_model(
    session: AsyncSession,
    llm_model_id: int,
    dto: ModelUpdateReq,
) -> ModelRes:
    # 1. 대상 모델 조회
    model = await _get_model_or_404(session, llm_model_id)
    # 2. 보낸 값만 변경
    if dto.display_name is not None:
        model.display_name = dto.display_name.strip()
    if dto.supports_tools is not None:
        model.supports_tools = dto.supports_tools
    if dto.supports_reasoning is not None:
        model.supports_reasoning = dto.supports_reasoning
    if dto.is_active is not None:
        model.is_active = dto.is_active
    # 3. DB 반영
    updated_model = await llm_repository.update_model(session, model)
    await session.commit()
    # 4. Service -> Router
    return ModelRes.model_validate(updated_model)


# LLM 모델 삭제(D) API
async def delete_model(session: AsyncSession, llm_model_id: int) -> DeleteRes:
    model = await _get_model_or_404(session, llm_model_id)
    await llm_repository.delete_model(session, model)
    await session.commit()
    return DeleteRes(success=True)


#  * LLM 모델 연결 테스트 API
#  - 짧은 질문을 보내고 "첫 응답 조각"이 도착하면 바로 성공 처리 (답변 끝까지 기다리지 않음)
#    => 생각 과정이 긴 모델도 빠르게 테스트할 수 있음
#  - 실패해도 에러를 던지지 않고 success=False + 실패 사유로 응답
async def test_model(session: AsyncSession, llm_model_id: int) -> ModelTestRes:
    # 1. 사용할 수 있는 모델인지 확인 + 접속 정보 만들기
    model = await _get_usable_model(session, llm_model_id)
    connection = _build_connection(model.provider)
    model_name = model.model_id
    # 2. DB 작업 끝 => 트랜잭션 종료 (LLM 응답을 기다리는 동안 DB 연결을 붙잡지 않도록)
    await session.commit()

    # 3. 짧은 질문 보내기
    started = time.perf_counter()
    try:
        # aclosing: 첫 응답을 받고 break 하면 LLM 서버와의 연결도 즉시 닫힘
        async with aclosing(
            llm.stream_chat(connection, model_name, [ChatMessage(role="user", content=TEST_PROMPT)])
        ) as events:
            async for event in events:
                # 3-1. 생각 과정이든 답변이든 글자가 오면 => 정상 동작
                if event.type in ("reasoning", "content") and event.text:
                    break
                # 3-2. 도구 호출 요청도 정상 응답으로 봄
                if event.type == "tool_call":
                    break
                # 3-3. 아무 글자 없이 끝난 경우 => 실패
                if event.type == "done":
                    return ModelTestRes(
                        success=False,
                        latency_ms=None,
                        message="모델이 빈 응답을 보냈습니다.",
                    )
    except LLMError as err:
        return ModelTestRes(success=False, latency_ms=None, message=str(err))

    # 4. 성공 (첫 응답까지 걸린 시간)
    latency_ms = int((time.perf_counter() - started) * 1000)
    return ModelTestRes(
        success=True,
        latency_ms=latency_ms,
        message=f"정상적으로 응답했습니다. (첫 응답까지 {latency_ms / 1000:.2f}초)",
    )


# ============================================================
# 4. 테스트 대화 (Chat) - 스트리밍
# ============================================================


#  * 테스트 대화 준비가 끝난 상태 (스트리밍을 시작하기 전에 DB에서 꺼내둔 값 모음)
#  - 스트리밍 응답은 라우터 함수가 끝난 "뒤에" 실행되므로,
#    그때는 DB 세션을 쓰지 않도록 필요한 값을 미리 꺼내서 이 형식에 담아둠
@dataclass(frozen=True)
class PreparedChat:
    connection: LLMConnection
    model_name: str  # 공급자 서버의 모델 이름 (예: qwen3.5:9b)
    messages: list[ChatMessage]
    params: GenerationParams


# 테스트 대화 준비 (모델 확인 + 접속 정보 + 메시지/옵션 변환)
async def prepare_chat(session: AsyncSession, dto: ChatReq) -> PreparedChat:
    # 1. 사용할 수 있는 모델인지 확인 + 접속 정보 만들기
    model = await _get_usable_model(session, dto.llm_model_id)
    connection = _build_connection(model.provider)
    model_name = model.model_id
    # 2. DB 작업 끝 => 트랜잭션 종료
    await session.commit()
    # 3. 요청 형식(Pydantic) -> core/llm.py 형식(dataclass) 변환
    return PreparedChat(
        connection=connection,
        model_name=model_name,
        messages=[
            ChatMessage(role=message.role, content=message.content) for message in dto.messages
        ],
        params=GenerationParams(
            temperature=dto.temperature,
            max_tokens=dto.max_tokens,
            top_p=dto.top_p,
        ),
    )


# SSE(Server-Sent Events) 형식 한 덩어리 만들기 => "data: {JSON}\n\n"
#  - ensure_ascii=False: 한글을 \uXXXX 로 바꾸지 않고 그대로 보냄
def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


#  * 테스트 대화 답변을 SSE 형식으로 하나씩 만들어서 돌려줌 (라우터의 StreamingResponse가 사용)
#  - 프론트엔드로 보내는 이벤트 종류
#    - {"type": "reasoning", "text": "..."}  : 생각 과정 조각
#    - {"type": "content", "text": "..."}    : 답변 조각
#    - {"type": "tool_call", "name": ..., "arguments": {...}} : 도구 호출 요청
#    - {"type": "done", "input_tokens": .., "output_tokens": .., "finish_reason": ..,
#       "latency_ms": .., "first_token_ms": ..} : 끝 (사용량, 걸린 시간)
#    - {"type": "error", "message": "..."}   : 오류
#      (스트리밍이 시작된 뒤에는 HTTP 상태 코드를 바꿀 수 없으므로 이벤트로 알려줌)
async def stream_chat_events(prepared: PreparedChat) -> AsyncIterator[str]:
    started = time.perf_counter()
    first_token_ms: int | None = None  # 첫 글자가 올 때까지 걸린 시간

    try:
        async with aclosing(
            llm.stream_chat(
                prepared.connection,
                prepared.model_name,
                prepared.messages,
                prepared.params,
            )
        ) as events:
            async for event in events:
                if event.type in ("reasoning", "content"):
                    if first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - started) * 1000)
                    yield _sse({"type": event.type, "text": event.text})
                elif event.type == "tool_call" and event.tool_call:
                    yield _sse(
                        {
                            "type": "tool_call",
                            "name": event.tool_call.name,
                            "arguments": event.tool_call.arguments,
                        }
                    )
                elif event.type == "done":
                    usage = event.usage
                    yield _sse(
                        {
                            "type": "done",
                            "input_tokens": usage.input_tokens if usage else 0,
                            "output_tokens": usage.output_tokens if usage else 0,
                            "finish_reason": event.finish_reason,
                            "latency_ms": int((time.perf_counter() - started) * 1000),
                            "first_token_ms": first_token_ms,
                        }
                    )
    except LLMError as err:
        yield _sse({"type": "error", "message": str(err)})
    except Exception:
        # 예상하지 못한 에러: 서버 로그에 자세히 남기고, 화면에는 일반 메시지만 보냄
        logger.exception("테스트 대화 스트리밍 중 예상하지 못한 오류가 발생했습니다.")
        yield _sse({"type": "error", "message": "답변 생성 중 서버 오류가 발생했습니다."})
