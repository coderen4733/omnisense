from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.response import ResponseSchema
from src.core.database import get_db_session
from src.services.agent import service as agent_service
from src.services.agent.schemas import (
    AgentCreateReq,
    AgentRes,
    AgentRunReq,
    AgentUpdateReq,
    DeleteRes,
    ToolRes,
)
from src.services.iam.auth.dependencies import AdminOrManagerUser, CurrentUser
from src.services.orchestration import agent_runner

# 📌 권한
#  - 에이전트 등록/수정/삭제: admin, manager (AdminOrManagerUser)
#  - 목록·상세 조회, 도구 목록, 실행: 로그인한 사용자 누구나 (CurrentUser)
#    (일반 사용자(user)에게는 "사용" 상태인 에이전트만 보임)

agent_router = APIRouter()


# ============================================================
# 1. 도구 (Tool)
#  - "/tools" 는 "/{agent_id}" 보다 먼저 등록 (경로가 겹치지 않도록 구체적인 경로를 먼저)
# ============================================================


# 에이전트에 연결할 수 있는 도구 목록 조회 API
@agent_router.get(
    "/tools",
    response_model=ResponseSchema[list[ToolRes]],
    status_code=status.HTTP_200_OK,
)
async def read_tools(current_user: CurrentUser) -> dict:
    data = agent_service.read_tools()
    return {
        "message": "도구 목록 조회에 성공했습니다.",
        "data": data,
    }


# ============================================================
# 2. 에이전트 (Agent)
# ============================================================


# 에이전트 목록 조회(R-L) API
@agent_router.get(
    "/",
    response_model=ResponseSchema[list[AgentRes]],
    status_code=status.HTTP_200_OK,
)
async def read_agents(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: CurrentUser,
) -> dict:
    # 1. Router <- Service
    data = await agent_service.read_agents(session, current_user)
    # 2. Router -> FrontEnd
    return {
        "message": "에이전트 목록 조회에 성공했습니다.",
        "data": data,
    }


# 에이전트 등록(C) API - admin, manager
@agent_router.post(
    "/",
    response_model=ResponseSchema[AgentRes],
    status_code=status.HTTP_201_CREATED,
)
async def create_agent(
    dto: AgentCreateReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> dict:
    data = await agent_service.create_agent(session, dto, current_user)
    return {
        "message": "에이전트 등록에 성공했습니다.",
        "data": data,
    }


# 에이전트 조회(R-D) API
@agent_router.get(
    "/{agent_id}",
    response_model=ResponseSchema[AgentRes],
    status_code=status.HTTP_200_OK,
)
async def read_agent(
    agent_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: CurrentUser,
) -> dict:
    data = await agent_service.read_agent(session, agent_id, current_user)
    return {
        "message": "에이전트 조회에 성공했습니다.",
        "data": data,
    }


# 에이전트 수정(U) API - admin, manager
@agent_router.patch(
    "/{agent_id}",
    response_model=ResponseSchema[AgentRes],
    status_code=status.HTTP_200_OK,
)
async def update_agent(
    agent_id: int,
    dto: AgentUpdateReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> dict:
    data = await agent_service.update_agent(session, agent_id, dto)
    return {
        "message": "에이전트 수정에 성공했습니다.",
        "data": data,
    }


# 에이전트 삭제(D) API - admin, manager
@agent_router.delete(
    "/{agent_id}",
    response_model=ResponseSchema[DeleteRes],
    status_code=status.HTTP_200_OK,
)
async def delete_agent(
    agent_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> dict:
    data = await agent_service.delete_agent(session, agent_id)
    return {
        "message": "에이전트 삭제에 성공했습니다.",
        "data": data,
    }


# ============================================================
# 3. 에이전트 실행 (Run)
# ============================================================


#  * 에이전트 실행 API (스트리밍)
#  - 응답 형식: text/event-stream (SSE) => 생각 과정, 도구 실행, 답변을 진행되는 대로 전달
#    (이벤트 형식은 orchestration/agent_runner.py 맨 위 설명 참고)
#  - 에이전트가 없거나 비활성화된 경우 등은 스트리밍 시작 "전에" 일반 에러(404, 400)로 응답
@agent_router.post("/{agent_id}/run")
async def run_agent(
    agent_id: int,
    dto: AgentRunReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: CurrentUser,
) -> StreamingResponse:
    # 1. Router <- Service (실행 가능 여부 확인 + 접속 정보 준비, DB 작업은 여기서 모두 끝냄)
    prepared = await agent_service.prepare_run(session, agent_id, dto, current_user)
    # 2. Router -> FrontEnd (스트리밍 응답 - 헤더 설명은 llm/router.py 의 chat 참고)
    return StreamingResponse(
        agent_runner.stream_run_events(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
