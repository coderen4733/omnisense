from datetime import datetime
from typing import Any

from sqlalchemy import Date, case, cast, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.services.run.models import WorkflowRun, WorkflowRunStep

# 📌 selectinload, populate_existing 를 사용하는 이유: agent/repository.py 설명 참고
# 📌 commit은 여기서 하지 않고 호출하는 쪽(service.py, orchestration/run_recorder.py)에서 함


# ============================================================
# 1. 저장 (실행하면서 기록 - orchestration/run_recorder.py, workflow/service.py 에서 사용)
# ============================================================


# 실행 기록 생성(C) - flush로 id를 받아옴
async def create_run(session: AsyncSession, run: WorkflowRun) -> WorkflowRun:
    session.add(run)
    await session.flush()
    return run


# 노드 기록 1개 추가(C)
async def add_step(session: AsyncSession, step: WorkflowRunStep) -> None:
    session.add(step)
    await session.flush()


#  * 실행 기록 끝내기(U) - 상태, 결과, 걸린 시간 등을 한 번에 바꿈
#  - values: 바꿀 칸 이름과 값 (예: {"status": "succeeded", "output": "..."})
#  - update 문을 바로 실행 (기록을 먼저 불러올 필요 없음)
async def finish_run(session: AsyncSession, run_id: int, values: dict[str, Any]) -> None:
    await session.execute(update(WorkflowRun).where(WorkflowRun.id == run_id).values(**values))


#  * 오래된 실행 기록 지우기(D) - before 보다 먼저 시작한 기록
#  - 노드 기록(workflow_run_steps)은 DB가 함께 지움 (ondelete="CASCADE")
#  - 반환값: 지운 기록 수
async def delete_runs_before(session: AsyncSession, before: datetime) -> int:
    result = await session.execute(delete(WorkflowRun).where(WorkflowRun.started_at < before))
    return result.rowcount or 0


# ============================================================
# 2. 조회 (run/service.py 에서 사용)
# ============================================================


#  * 실행 기록 목록 조회(R-L) - 최근 실행 순서대로, 페이지 단위
#  - 필터 값이 None 이면 그 조건으로 거르지 않음
#  - started_by: 일반 사용자(user)는 자기가 실행한 기록만 보도록 service.py 에서 넣어 줌
#  - 반환값: (현재 페이지 기록 목록, 조건에 맞는 전체 개수)
async def get_runs(
    session: AsyncSession,
    *,
    workflow_id: int | None,
    status: str | None,
    started_by: int | None,
    offset: int,
    limit: int,
) -> tuple[list[WorkflowRun], int]:
    # 1. 필터 조건 만들기 (user/repository.py 의 get_users_list 설명 참고)
    conditions = []
    if workflow_id is not None:
        conditions.append(WorkflowRun.workflow_id == workflow_id)
    if status is not None:
        conditions.append(WorkflowRun.status == status)
    if started_by is not None:
        conditions.append(WorkflowRun.started_by == started_by)

    # 2. 전체 개수
    total = await session.scalar(
        select(func.count()).select_from(WorkflowRun).where(*conditions)
    )

    # 3. 현재 페이지 (id 를 두 번째 정렬 기준으로 넣는 이유: user/repository.py 설명 참고)
    query = (
        select(WorkflowRun)
        .options(selectinload(WorkflowRun.starter))
        .where(*conditions)
        .order_by(WorkflowRun.started_at.desc(), WorkflowRun.id.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await session.execute(query)
    return list(result.scalars().all()), total or 0


# 실행 기록 조회(R-D) - 노드 기록, 실행한 사용자 포함, 항상 DB 값으로 새로 채움
async def get_run_by_id(session: AsyncSession, run_id: int) -> WorkflowRun | None:
    query = (
        select(WorkflowRun)
        .options(selectinload(WorkflowRun.starter), selectinload(WorkflowRun.steps))
        .where(WorkflowRun.id == run_id)
        .execution_options(populate_existing=True)
    )
    result = await session.execute(query)
    return result.scalar_one_or_none()


# ============================================================
# 3. 모니터링 통계 (run/service.py 의 read_stats 에서 사용)
#  - 모두 since(이 시각) 이후에 시작한 실행만 계산
#  - func.count(), func.sum() 등: SQL의 COUNT, SUM 같은 집계 함수
#  - case(...): SQL의 CASE WHEN - 조건에 맞으면 1, 아니면 0 => 더하면 "조건에 맞는 개수"
# ============================================================


# 상태가 status 인 실행 개수를 세는 식 (예: 성공 개수)
def _count_status(status: str):
    return func.sum(case((WorkflowRun.status == status, 1), else_=0))


#  * 전체 요약 1줄
#  - 반환값: {"total", "succeeded", "failed", "stopped", "running",
#             "avg_latency_ms"(성공한 실행의 평균 시간), "input_tokens", "output_tokens"}
async def get_summary(session: AsyncSession, since: datetime) -> dict[str, Any]:
    query = select(
        func.count().label("total"),
        _count_status("succeeded").label("succeeded"),
        _count_status("failed").label("failed"),
        _count_status("stopped").label("stopped"),
        _count_status("running").label("running"),
        func.avg(
            case((WorkflowRun.status == "succeeded", WorkflowRun.latency_ms), else_=None)
        ).label("avg_latency_ms"),
        func.sum(WorkflowRun.input_tokens).label("input_tokens"),
        func.sum(WorkflowRun.output_tokens).label("output_tokens"),
    ).where(WorkflowRun.started_at >= since)
    row = (await session.execute(query)).one()
    # ._mapping: 결과 1줄을 {이름: 값} 처럼 꺼내 쓸 수 있게 해줌
    return dict(row._mapping)


#  * 날짜별 실행 수 (상태별)
#  - timezone 으로 날짜를 나눔 (예: Asia/Seoul => 한국 날짜 기준)
#  - func.timezone(시간대, 시각): Postgres 함수 - 시각을 그 시간대의 시각으로 바꿈
#  - cast(..., Date): 시각 => 날짜 (시, 분, 초를 버림)
async def get_daily_counts(
    session: AsyncSession, since: datetime, timezone: str
) -> list[dict[str, Any]]:
    day = cast(func.timezone(timezone, WorkflowRun.started_at), Date).label("day")
    query = (
        select(
            day,
            func.count().label("total"),
            _count_status("succeeded").label("succeeded"),
            _count_status("failed").label("failed"),
            _count_status("stopped").label("stopped"),
        )
        .where(WorkflowRun.started_at >= since)
        .group_by(day)
        .order_by(day)
    )
    return [dict(row._mapping) for row in (await session.execute(query)).all()]


#  * 워크플로우별 실행 통계 (실행 수가 많은 순서로 limit 개)
#  - 워크플로우가 지워진 기록도 이름(스냅샷)으로 묶어서 보여줌
async def get_workflow_stats(
    session: AsyncSession, since: datetime, limit: int
) -> list[dict[str, Any]]:
    total = func.count().label("total")
    query = (
        select(
            WorkflowRun.workflow_id,
            WorkflowRun.workflow_name,
            total,
            _count_status("succeeded").label("succeeded"),
            _count_status("failed").label("failed"),
            func.avg(
                case((WorkflowRun.status == "succeeded", WorkflowRun.latency_ms), else_=None)
            ).label("avg_latency_ms"),
            func.sum(WorkflowRun.input_tokens + WorkflowRun.output_tokens).label("tokens"),
            func.max(WorkflowRun.started_at).label("last_run_at"),
        )
        .where(WorkflowRun.started_at >= since)
        .group_by(WorkflowRun.workflow_id, WorkflowRun.workflow_name)
        .order_by(total.desc())
        .limit(limit)
    )
    return [dict(row._mapping) for row in (await session.execute(query)).all()]


#  * 모델별 사용량 (에이전트 노드 기록 기준, 토큰을 많이 쓴 순서로)
#  - join: 노드 기록에 실행 기록을 붙여서 "언제 실행했는지(started_at)"로 기간을 거름
async def get_model_stats(session: AsyncSession, since: datetime) -> list[dict[str, Any]]:
    tokens = func.sum(WorkflowRunStep.input_tokens + WorkflowRunStep.output_tokens).label("tokens")
    query = (
        select(
            WorkflowRunStep.model_name,
            func.count().label("calls"),
            func.sum(WorkflowRunStep.input_tokens).label("input_tokens"),
            func.sum(WorkflowRunStep.output_tokens).label("output_tokens"),
            tokens,
            func.avg(WorkflowRunStep.duration_ms).label("avg_duration_ms"),
            func.sum(case((WorkflowRunStep.status == "error", 1), else_=0)).label("errors"),
        )
        .join(WorkflowRun, WorkflowRun.id == WorkflowRunStep.run_id)
        .where(WorkflowRun.started_at >= since, WorkflowRunStep.model_name.is_not(None))
        .group_by(WorkflowRunStep.model_name)
        .order_by(tokens.desc())
    )
    return [dict(row._mapping) for row in (await session.execute(query)).all()]
