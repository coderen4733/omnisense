from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.response import ResponseSchema
from src.core.database import get_db_session
from src.services.iam.auth.dependencies import AdminOrManagerUser, AdminUser
from src.services.llm import service as llm_service
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

# 📌 권한
#  - 공급자·모델 등록/수정/삭제, 모델 목록 불러오기: admin만 (AdminUser)
#  - 목록 조회, 연결 테스트, 테스트 대화: admin, manager (AdminOrManagerUser)
#  - current_user 매개변수는 "권한 검사"를 위해 넣은 것 (함수 안에서 직접 쓰지 않아도 됨)

llm_router = APIRouter()


# ============================================================
# 1. LLM 공급자 (Provider)
# ============================================================


# LLM 공급자 목록 조회(R-L) API - 등록된 모델 목록 포함
@llm_router.get(
    "/providers",
    response_model=ResponseSchema[list[ProviderRes]],
    status_code=status.HTTP_200_OK,
)
async def read_providers(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> dict:
    # 1. Router <- Service
    data = await llm_service.read_providers(session)
    # 2. Router -> FrontEnd
    return {
        "message": "LLM 공급자 목록 조회에 성공했습니다.",
        "data": data,
    }


# LLM 공급자 등록(C) API - admin 전용
@llm_router.post(
    "/providers",
    response_model=ResponseSchema[ProviderRes],
    status_code=status.HTTP_201_CREATED,
)
async def create_provider(
    dto: ProviderCreateReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminUser,
) -> dict:
    data = await llm_service.create_provider(session, dto)
    return {
        "message": "LLM 공급자 등록에 성공했습니다.",
        "data": data,
    }


# LLM 공급자 수정(U) API - admin 전용
@llm_router.patch(
    "/providers/{provider_id}",
    response_model=ResponseSchema[ProviderRes],
    status_code=status.HTTP_200_OK,
)
async def update_provider(
    provider_id: int,
    dto: ProviderUpdateReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminUser,
) -> dict:
    data = await llm_service.update_provider(session, provider_id, dto)
    return {
        "message": "LLM 공급자 수정에 성공했습니다.",
        "data": data,
    }


# LLM 공급자 삭제(D) API - admin 전용 (등록된 모델도 함께 삭제)
@llm_router.delete(
    "/providers/{provider_id}",
    response_model=ResponseSchema[DeleteRes],
    status_code=status.HTTP_200_OK,
)
async def delete_provider(
    provider_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminUser,
) -> dict:
    data = await llm_service.delete_provider(session, provider_id)
    return {
        "message": "LLM 공급자 삭제에 성공했습니다.",
        "data": data,
    }


# 공급자 서버에 설치된 모델 목록 조회 API - admin 전용 (모델 등록 화면의 "불러오기")
@llm_router.get(
    "/providers/{provider_id}/available-models",
    response_model=ResponseSchema[AvailableModelsRes],
    status_code=status.HTTP_200_OK,
)
async def read_available_models(
    provider_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminUser,
) -> dict:
    data = await llm_service.read_available_models(session, provider_id)
    return {
        "message": "공급자 서버의 모델 목록 조회에 성공했습니다.",
        "data": data,
    }


# ============================================================
# 2. LLM 모델 (Model)
#  - 경로의 {llm_model_id}: llm_models 테이블의 번호(id)
# ============================================================


# LLM 모델 등록(C) API - admin 전용
@llm_router.post(
    "/providers/{provider_id}/models",
    response_model=ResponseSchema[ModelRes],
    status_code=status.HTTP_201_CREATED,
)
async def create_model(
    provider_id: int,
    dto: ModelCreateReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminUser,
) -> dict:
    data = await llm_service.create_model(session, provider_id, dto)
    return {
        "message": "LLM 모델 등록에 성공했습니다.",
        "data": data,
    }


# LLM 모델 수정(U) API - admin 전용
@llm_router.patch(
    "/models/{llm_model_id}",
    response_model=ResponseSchema[ModelRes],
    status_code=status.HTTP_200_OK,
)
async def update_model(
    llm_model_id: int,
    dto: ModelUpdateReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminUser,
) -> dict:
    data = await llm_service.update_model(session, llm_model_id, dto)
    return {
        "message": "LLM 모델 수정에 성공했습니다.",
        "data": data,
    }


# LLM 모델 삭제(D) API - admin 전용
@llm_router.delete(
    "/models/{llm_model_id}",
    response_model=ResponseSchema[DeleteRes],
    status_code=status.HTTP_200_OK,
)
async def delete_model(
    llm_model_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminUser,
) -> dict:
    data = await llm_service.delete_model(session, llm_model_id)
    return {
        "message": "LLM 모델 삭제에 성공했습니다.",
        "data": data,
    }


# LLM 모델 연결 테스트 API - admin, manager
#  - 연결에 실패해도 200 + success=false 로 응답 (실패 사유는 message)
@llm_router.post(
    "/models/{llm_model_id}/test",
    response_model=ResponseSchema[ModelTestRes],
    status_code=status.HTTP_200_OK,
)
async def test_model(
    llm_model_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> dict:
    data = await llm_service.test_model(session, llm_model_id)
    return {
        "message": "LLM 모델 연결 테스트를 완료했습니다.",
        "data": data,
    }


# ============================================================
# 3. 테스트 대화 (Chat) - admin, manager
# ============================================================


#  * 테스트 대화 API (스트리밍)
#  - 응답 형식: text/event-stream (SSE) => 답변이 만들어지는 대로 조각조각 전달
#    (이벤트 형식은 service.py 의 stream_chat_events 설명 참고)
#  - 다른 API와 달리 { message, data } 형식이 아님 (스트리밍이라 한 번에 감쌀 수 없음)
#  - 모델이 없거나 비활성화된 경우 등은 스트리밍 시작 "전에" 일반 에러(404, 400)로 응답
@llm_router.post("/chat")
async def chat(
    dto: ChatReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> StreamingResponse:
    # 1. Router <- Service (모델 확인 + 접속 정보 준비, DB 작업은 여기서 모두 끝냄)
    prepared = await llm_service.prepare_chat(session, dto)
    # 2. Router -> FrontEnd (스트리밍 응답)
    #  - Cache-Control: no-cache   => 중간 서버가 응답을 저장(캐시)하지 않도록
    #  - X-Accel-Buffering: no     => Nginx가 응답을 모았다가 한 번에 보내지 않도록 (실시간 전달)
    return StreamingResponse(
        llm_service.stream_chat_events(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
