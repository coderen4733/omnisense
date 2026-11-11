# [수정] * 워크플로우 실행 API(POST /workflows/{id}/run) 추가 [2026-11-10 16:30]
# [기존] 목록/조회/만들기/수정/삭제 API만 있었습니다.
# [변경] 맨 아래에 실행 API(스트리밍)를 추가했고, 권한 설명에 "실행"을 넣었습니다.

from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.response import ResponseSchema
from src.core.database import get_db_session
from src.services.iam.auth.dependencies import AdminOrManagerUser, CurrentUser
from src.services.orchestration import run_recorder
from src.services.workflow import service as workflow_service
from src.services.workflow.schemas import (
    DeleteRes,
    WorkflowCreateReq,
    WorkflowRes,
    WorkflowRunReq,
    WorkflowSummaryRes,
    WorkflowUpdateReq,
)

# 📌 권한 (에이전트와 동일)
#  - 워크플로우 만들기/수정/삭제: admin, manager (AdminOrManagerUser)
#  - 목록·상세 조회, 실행: 로그인한 사용자 누구나 (CurrentUser)
#    (일반 사용자(user)에게는 "사용" 상태인 워크플로우만 보임)

workflow_router = APIRouter()


# 워크플로우 목록 조회(R-L) API
@workflow_router.get(
    "/",
    response_model=ResponseSchema[list[WorkflowSummaryRes]],
    status_code=status.HTTP_200_OK,
)
async def read_workflows(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: CurrentUser,
) -> dict:
    # 1. Router <- Service
    data = await workflow_service.read_workflows(session, current_user)
    # 2. Router -> FrontEnd
    return {
        "message": "워크플로우 목록 조회에 성공했습니다.",
        "data": data,
    }


# 워크플로우 만들기(C) API - admin, manager
@workflow_router.post(
    "/",
    response_model=ResponseSchema[WorkflowRes],
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow(
    dto: WorkflowCreateReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> dict:
    data = await workflow_service.create_workflow(session, dto, current_user)
    return {
        "message": "워크플로우 만들기에 성공했습니다.",
        "data": data,
    }


# 워크플로우 조회(R-D) API - 편집 화면용 (그래프 + 실행 전에 고쳐야 할 문제 목록)
@workflow_router.get(
    "/{workflow_id}",
    response_model=ResponseSchema[WorkflowRes],
    status_code=status.HTTP_200_OK,
)
async def read_workflow(
    workflow_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: CurrentUser,
) -> dict:
    data = await workflow_service.read_workflow(session, workflow_id, current_user)
    return {
        "message": "워크플로우 조회에 성공했습니다.",
        "data": data,
    }


# 워크플로우 수정(U) API - admin, manager (편집 화면의 "저장" 포함)
@workflow_router.patch(
    "/{workflow_id}",
    response_model=ResponseSchema[WorkflowRes],
    status_code=status.HTTP_200_OK,
)
async def update_workflow(
    workflow_id: int,
    dto: WorkflowUpdateReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> dict:
    data = await workflow_service.update_workflow(session, workflow_id, dto)
    return {
        "message": "워크플로우 수정에 성공했습니다.",
        "data": data,
    }


# 워크플로우 삭제(D) API - admin, manager
@workflow_router.delete(
    "/{workflow_id}",
    response_model=ResponseSchema[DeleteRes],
    status_code=status.HTTP_200_OK,
)
async def delete_workflow(
    workflow_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> dict:
    data = await workflow_service.delete_workflow(session, workflow_id)
    return {
        "message": "워크플로우 삭제에 성공했습니다.",
        "data": data,
    }


# [수정] * 실행 기록 저장 추가 [2026-11-11 11:40]
# [기존] 실행 엔진(workflow_runner)의 진행 상황을 화면으로 보내기만 했습니다.
# [변경] run_recorder 를 거쳐 실행하면서 실행 기록(workflow_runs, workflow_run_steps)을 저장합니다.
#        맨 처음에 실행 기록 번호를 알려주는 run_start 이벤트가 추가됩니다.

#  * 워크플로우 실행 API (스트리밍)
#  - 응답 형식: text/event-stream (SSE) => 노드별 진행 상황을 실행되는 대로 전달
#    (이벤트 형식은 orchestration/workflow_runner.py, run_recorder.py 맨 위 설명 참고)
#  - 실행 전에 고쳐야 할 문제가 있거나 입력값이 잘못된 경우 등은
#    스트리밍 시작 "전에" 일반 에러(404, 400)로 응답
@workflow_router.post("/{workflow_id}/run")
async def run_workflow(
    workflow_id: int,
    dto: WorkflowRunReq,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: CurrentUser,
) -> StreamingResponse:
    #  1. Router <- Service (실행 가능 여부 확인 + 준비 + 실행 기록 만들기)
    #  - DB 작업은 여기서 모두 끝냄
    prepared, run_id = await workflow_service.prepare_run(session, workflow_id, dto, current_user)
    # 2. Router -> FrontEnd (스트리밍 응답 - 헤더 설명은 llm/router.py 의 chat 참고)
    return StreamingResponse(
        run_recorder.stream_recorded_events(prepared, run_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
