from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.response import ResponseSchema
from src.core.database import get_db_session
from src.services.iam.auth.dependencies import AdminOrManagerUser, CurrentUser
from src.services.run import service as run_service
from src.services.run.schemas import (
    RunDetailRes,
    RunListQuery,
    RunListRes,
    RunStatsQuery,
    RunStatsRes,
)

# 📌 권한
#  - 실행 기록 목록·상세: 로그인한 사용자 누구나 (CurrentUser)
#    (admin, manager 는 모든 기록 / 일반 사용자(user)는 자기가 실행한 기록만)
#  - 모니터링 통계: admin, manager (AdminOrManagerUser)
# 📌 실행 기록은 워크플로우를 실행할 때 자동으로 저장됨 (orchestration/run_recorder.py)
#    => 이 라우터에는 조회 API만 있음

run_router = APIRouter()


#  * 모니터링 통계 조회 API - admin, manager
#  - "/stats" 는 "/{run_id}" 보다 먼저 등록 (경로가 겹치지 않도록 구체적인 경로를 먼저)
@run_router.get(
    "/stats",
    response_model=ResponseSchema[RunStatsRes],
    status_code=status.HTTP_200_OK,
)
async def read_stats(
    query: Annotated[RunStatsQuery, Query()],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: AdminOrManagerUser,
) -> dict:
    data = await run_service.read_stats(session, query)
    return {
        "message": "모니터링 통계 조회에 성공했습니다.",
        "data": data,
    }


# 실행 기록 목록 조회(R-L) API
@run_router.get(
    "/",
    response_model=ResponseSchema[RunListRes],
    status_code=status.HTTP_200_OK,
)
async def read_runs(
    query: Annotated[RunListQuery, Query()],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: CurrentUser,
) -> dict:
    # 1. Router <- Service
    data = await run_service.read_runs(session, query, current_user)
    # 2. Router -> FrontEnd
    return {
        "message": "실행 기록 목록 조회에 성공했습니다.",
        "data": data,
    }


# 실행 기록 상세 조회(R-D) API - 실행 당시 그래프 + 노드 기록 포함
@run_router.get(
    "/{run_id}",
    response_model=ResponseSchema[RunDetailRes],
    status_code=status.HTTP_200_OK,
)
async def read_run(
    run_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: CurrentUser,
) -> dict:
    data = await run_service.read_run(session, run_id, current_user)
    return {
        "message": "실행 기록 조회에 성공했습니다.",
        "data": data,
    }
