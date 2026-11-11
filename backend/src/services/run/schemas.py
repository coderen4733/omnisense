from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# 실행 상태 (models.py 의 RUN_STATUSES 와 같은 값)
RunStatus = Literal["running", "succeeded", "failed", "stopped"]

# ============================================================
# 1. 실행 기록 목록 / 상세
# ============================================================


#  * 실행 기록 목록 조회(R-L) - 요청(Query)
#  - GET /runs/ 의 쿼리 파라미터 (user/schemas.py 의 UserReadListQuery 와 같은 방식)
#      예) /runs/?workflow_id=3            => 3번 워크플로우의 기록만
#      예) /runs/?status=failed&page=2     => 실패한 기록, 2페이지
#  - 필터 값이 None(기본값)이면 "그 조건으로 거르지 않음"
class RunListQuery(BaseModel):
    workflow_id: int | None = Field(default=None, description="워크플로우 번호로 필터")
    status: RunStatus | None = Field(default=None, description="실행 상태로 필터")
    page: int = Field(default=1, ge=1, description="페이지 번호 (1부터 시작)")
    size: int = Field(default=20, ge=1, le=100, description="한 페이지당 기록 수 (최대 100)")


#  * 실행 기록 1건 - 목록용 응답(Res) (그래프, 노드 기록은 빼고 가볍게)
#  - workflow_id: 워크플로우가 지워졌으면 None (이름은 실행 당시 이름이 남아 있음)
#  - started_by_email: 실행한 사용자 이메일 (사용자가 삭제되었으면 None)
class RunSummaryRes(BaseModel):
    id: int
    workflow_id: int | None
    workflow_name: str
    status: str
    error: str | None
    input_tokens: int
    output_tokens: int
    latency_ms: int | None
    started_by_email: str | None
    started_at: datetime
    finished_at: datetime | None


# 실행 기록 목록 - 응답(Res) (user/schemas.py 의 UserReadListRes 와 같은 모양)
class RunListRes(BaseModel):
    items: list[RunSummaryRes]
    total: int
    page: int
    size: int
    total_pages: int


#  * 노드 기록 1개 - 응답(Res)
#  - result: 노드 종류별 결과 (orchestration/workflow_runner.py 의 node_done 이벤트 내용)
#  - parts: 에이전트 노드의 생각 과정, 도구 실행, 답변 조각 (화면의 RunPart 와 같은 모양)
class RunStepRes(BaseModel):
    seq: int
    node_id: str
    node_type: str
    label: str
    status: str
    result: dict[str, Any] | None
    parts: list[Any]
    error: str | None
    model_name: str | None
    input_tokens: int
    output_tokens: int
    duration_ms: int | None
    started_at: datetime


#  * 실행 기록 상세 - 응답(Res) (목록 정보 + 실행 당시 그래프 + 입력/결과 + 노드 기록)
#  - graph: 실행 당시 그래프를 저장된 모양 그대로 돌려줌 (예전 형식이어도 화면에서 그릴 수 있도록)
class RunDetailRes(RunSummaryRes):
    graph: dict[str, Any]
    inputs: dict[str, Any]
    output: str | None
    error_node_id: str | None
    steps: list[RunStepRes]


# ============================================================
# 2. 모니터링 통계
# ============================================================


#  * 모니터링 통계 조회 - 요청(Query)
#  - days: 최근 며칠 동안의 기록으로 계산할지 (오늘 포함)
#  - tz: 날짜를 나누는 기준 시간대 (화면에서 브라우저의 시간대를 보내 줌, 예: Asia/Seoul)
class RunStatsQuery(BaseModel):
    days: int = Field(default=7, ge=1, le=90, description="최근 며칠 (1~90, 오늘 포함)")
    tz: str = Field(default="Asia/Seoul", max_length=50, description="날짜 기준 시간대")


#  * 전체 요약
#  - success_rate: 끝난 실행(실행 중 제외) 중 성공 비율 (0~100, 끝난 실행이 없으면 None)
#  - avg_latency_ms: 성공한 실행의 평균 걸린 시간
class RunSummaryStatsRes(BaseModel):
    total: int
    succeeded: int
    failed: int
    stopped: int
    running: int
    success_rate: float | None
    avg_latency_ms: int | None
    input_tokens: int
    output_tokens: int


# 날짜별 실행 수 (실행이 없는 날도 0으로 들어 있음)
class RunDailyStatsRes(BaseModel):
    date: date
    total: int
    succeeded: int
    failed: int
    stopped: int


# 워크플로우별 통계 (workflow_id: 지워진 워크플로우면 None)
class RunWorkflowStatsRes(BaseModel):
    workflow_id: int | None
    workflow_name: str
    total: int
    succeeded: int
    failed: int
    avg_latency_ms: int | None
    tokens: int
    last_run_at: datetime


# 모델별 사용량 (에이전트 노드 기준 - calls: 에이전트 노드 실행 횟수)
class RunModelStatsRes(BaseModel):
    model_name: str
    calls: int
    errors: int
    input_tokens: int
    output_tokens: int
    tokens: int
    avg_duration_ms: int | None


# 모니터링 통계 - 응답(Res)
class RunStatsRes(BaseModel):
    days: int
    since: datetime  # 계산 시작 시각 (days 일 전 0시, tz 기준)
    summary: RunSummaryStatsRes
    daily: list[RunDailyStatsRes]
    workflows: list[RunWorkflowStatsRes]
    models: list[RunModelStatsRes]
