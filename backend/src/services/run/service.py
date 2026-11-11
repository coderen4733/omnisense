import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.iam.user.enums import UserRole
from src.services.iam.user.models import User
from src.services.run import repository as run_repository
from src.services.run.models import WorkflowRun
from src.services.run.schemas import (
    RunDailyStatsRes,
    RunDetailRes,
    RunListQuery,
    RunListRes,
    RunModelStatsRes,
    RunStatsQuery,
    RunStatsRes,
    RunStepRes,
    RunSummaryRes,
    RunSummaryStatsRes,
    RunWorkflowStatsRes,
)

#  * 모든 사용자의 실행 기록을 볼 수 있는 권한
#  - 일반 사용자(user)는 자기가 실행한 기록만 볼 수 있음
RUN_MANAGER_ROLES = (UserRole.ADMIN, UserRole.MANAGER)

# 모니터링 화면의 워크플로우별 통계에 보여줄 최대 개수 (실행 수가 많은 순서)
MAX_WORKFLOW_STATS = 20


# ============================================================
# 1. 공통 도우미 함수 (이 파일 안에서만 사용)
# ============================================================


# SQLAlchemy 실행 기록 객체 -> 목록용 응답 모델 변환
def _to_summary_res(run: WorkflowRun) -> RunSummaryRes:
    return RunSummaryRes(
        id=run.id,
        workflow_id=run.workflow_id,
        workflow_name=run.workflow_name,
        status=run.status,
        error=run.error,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        latency_ms=run.latency_ms,
        started_by_email=run.starter.email if run.starter else None,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


# 평균값(소수, 없으면 None) => 정수 밀리초
def _to_ms(value: float | None) -> int | None:
    return None if value is None else round(value)


# ============================================================
# 2. 실행 기록 목록 / 상세
# ============================================================


#  * 실행 기록 목록 조회(R-L) API
#  - admin, manager: 모든 사용자의 기록 / user: 자기가 실행한 기록만
async def read_runs(session: AsyncSession, query: RunListQuery, current_user: User) -> RunListRes:
    # 1. 일반 사용자는 자기 기록만 (started_by 조건을 강제로 넣음)
    started_by = None if current_user.role in RUN_MANAGER_ROLES else current_user.id
    # 2. Service -> Repository (offset: 앞에서 건너뛸 개수 - 예: 2페이지, 20개씩 => 20개 건너뜀)
    runs, total = await run_repository.get_runs(
        session,
        workflow_id=query.workflow_id,
        status=query.status,
        started_by=started_by,
        offset=(query.page - 1) * query.size,
        limit=query.size,
    )
    # 3. 응답 만들기 (math.ceil: 올림 - 예: 45개를 20개씩 => 2.25 => 3페이지)
    return RunListRes(
        items=[_to_summary_res(run) for run in runs],
        total=total,
        page=query.page,
        size=query.size,
        total_pages=math.ceil(total / query.size),
    )


#  * 실행 기록 상세 조회(R-D) API
#  - 일반 사용자(user)가 다른 사람의 기록을 조회하면 없는 것처럼 처리(404)
async def read_run(session: AsyncSession, run_id: int, current_user: User) -> RunDetailRes:
    run = await run_repository.get_run_by_id(session, run_id)
    hidden = (
        run is not None
        and current_user.role not in RUN_MANAGER_ROLES
        and run.started_by != current_user.id
    )
    if run is None or hidden:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="존재하지 않는 실행 기록입니다.",
        )
    return RunDetailRes(
        **_to_summary_res(run).model_dump(),
        graph=run.graph,
        inputs=run.inputs,
        output=run.output,
        error_node_id=run.error_node_id,
        steps=[
            RunStepRes(
                seq=step.seq,
                node_id=step.node_id,
                node_type=step.node_type,
                label=step.label,
                status=step.status,
                result=step.result,
                parts=step.parts,
                error=step.error,
                model_name=step.model_name,
                input_tokens=step.input_tokens,
                output_tokens=step.output_tokens,
                duration_ms=step.duration_ms,
                started_at=step.started_at,
            )
            for step in run.steps
        ],
    )


# ============================================================
# 3. 모니터링 통계 (admin, manager)
# ============================================================


#  * 모니터링 통계 조회 API
#  - 최근 days 일(오늘 포함, tz 시간대 기준 0시부터)의 실행 기록으로 계산
#    예) days=7, 오늘이 11월 11일 => 11월 5일 0시부터
async def read_stats(session: AsyncSession, query: RunStatsQuery) -> RunStatsRes:
    # 1. 시간대 확인 (잘못된 이름이면 400)
    try:
        tz = ZoneInfo(query.tz)
    except (ZoneInfoNotFoundError, ValueError) as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"알 수 없는 시간대입니다: {query.tz}",
        ) from err

    # 2. 계산 시작 시각 (tz 기준 오늘 0시에서 days-1 일 전)
    today = datetime.now(tz).date()
    first_day = today - timedelta(days=query.days - 1)
    since = datetime(first_day.year, first_day.month, first_day.day, tzinfo=tz)

    # 3. Service -> Repository
    summary = await run_repository.get_summary(session, since)
    daily_rows = await run_repository.get_daily_counts(session, since, query.tz)
    workflow_rows = await run_repository.get_workflow_stats(session, since, MAX_WORKFLOW_STATS)
    model_rows = await run_repository.get_model_stats(session, since)

    #  4. 전체 요약 (DB의 SUM 은 기록이 하나도 없으면 None => 0 으로)
    #  - 성공률 = 성공 / (전체 - 실행 중) × 100
    total = summary["total"] or 0
    running = summary["running"] or 0
    succeeded = summary["succeeded"] or 0
    finished = total - running
    summary_res = RunSummaryStatsRes(
        total=total,
        succeeded=succeeded,
        failed=summary["failed"] or 0,
        stopped=summary["stopped"] or 0,
        running=running,
        success_rate=round(succeeded / finished * 100, 1) if finished > 0 else None,
        avg_latency_ms=_to_ms(summary["avg_latency_ms"]),
        input_tokens=summary["input_tokens"] or 0,
        output_tokens=summary["output_tokens"] or 0,
    )

    #  5. 날짜별 실행 수 - 실행이 없는 날도 0으로 채움 (그래프에 빈 날짜가 빠지지 않도록)
    by_day = {row["day"]: row for row in daily_rows}
    daily = []
    for offset in range(query.days):
        day = first_day + timedelta(days=offset)
        row = by_day.get(day, {})
        daily.append(
            RunDailyStatsRes(
                date=day,
                total=row.get("total") or 0,
                succeeded=row.get("succeeded") or 0,
                failed=row.get("failed") or 0,
                stopped=row.get("stopped") or 0,
            )
        )

    # 6. 워크플로우별, 모델별 통계
    workflows = [
        RunWorkflowStatsRes(
            workflow_id=row["workflow_id"],
            workflow_name=row["workflow_name"],
            total=row["total"],
            succeeded=row["succeeded"] or 0,
            failed=row["failed"] or 0,
            avg_latency_ms=_to_ms(row["avg_latency_ms"]),
            tokens=row["tokens"] or 0,
            last_run_at=row["last_run_at"],
        )
        for row in workflow_rows
    ]
    models = [
        RunModelStatsRes(
            model_name=row["model_name"],
            calls=row["calls"],
            errors=row["errors"] or 0,
            input_tokens=row["input_tokens"] or 0,
            output_tokens=row["output_tokens"] or 0,
            tokens=row["tokens"] or 0,
            avg_duration_ms=_to_ms(row["avg_duration_ms"]),
        )
        for row in model_rows
    ]

    return RunStatsRes(
        days=query.days,
        since=since,
        summary=summary_res,
        daily=daily,
        workflows=workflows,
        models=models,
    )
