from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

#  * 공통 Base(src/core/base.py)를 상속 => alembic이 모든 테이블을 한 번에 인식
from src.core.base import Base
from src.services.iam.user.models import User

# 📌 실행 기록(Run)이란?
#  - 워크플로우를 한 번 실행할 때마다 "누가, 언제, 무엇을 넣어서, 어떤 결과가 나왔는지"를 남긴 것
#  - workflow_runs     : 실행 1번 (입력, 상태, 최종 결과, 걸린 시간, 토큰 합계)
#  - workflow_run_steps: 그 실행에서 거친 노드 1개 (보낸 내용, 답변, 도구 실행, 오류)
#  - 기록은 orchestration/run_recorder.py 가 실행하면서 저장하고,
#    이 폴더(run/)는 저장된 기록을 조회하는 API(목록, 상세, 모니터링 통계)를 담당
#
# 📌 워크플로우 이름과 그래프를 기록에 "복사"해 두는 이유 (스냅샷)
#  - 실행한 뒤에 워크플로우를 고치거나 지워도, 그 당시 어떤 모양으로 실행됐는지 다시 볼 수 있도록

# 실행 상태 (status 칸에 들어가는 값)
RUN_STATUSES = ("running", "succeeded", "failed", "stopped")  # 실행 중 / 성공 / 실패 / 중지
# 노드 실행 상태 (step.status 칸에 들어가는 값)
STEP_STATUSES = ("done", "error", "stopped")  # 완료 / 오류 / 중지


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    # 1. 기본 정보
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )
    #  * 실행한 워크플로우
    #  - 워크플로우를 지워도 기록은 남도록 SET NULL (이름과 그래프는 아래 스냅샷 칸에 있음)
    #  - index=True: 워크플로우별 기록 조회를 빠르게
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    workflow_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    # 실행 당시의 그래프 (노드 + 연결선) - 기록 상세 화면에서 캔버스를 그릴 때 사용
    graph: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
    )
    # 시작 노드 입력값 {입력 칸 이름: 값}
    inputs: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
        nullable=False,
    )

    # 2. 결과
    #  - status: running(실행 중) / succeeded(성공) / failed(실패) / stopped(사용자가 중지)
    status: Mapped[str] = mapped_column(
        String(20),
        default="running",
        server_default="running",
        nullable=False,
        index=True,
    )
    output: Mapped[str | None] = mapped_column(Text, nullable=True)  # 최종 결과 (성공했을 때)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)  # 오류 메시지 (실패했을 때)
    # 오류가 난 노드 (워크플로우 전체 오류면 None)
    error_node_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 모든 에이전트 노드의 토큰 합계
    input_tokens: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    # 전체 걸린 시간 (밀리초) - 실행 중이면 None
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 3. 메타 정보
    # 실행한 사용자 (사용자가 삭제되어도 기록은 남음)
    started_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    #  * 시작/끝 시각
    #  - started_at 에 index: 기간별 통계, 오래된 기록 지우기를 빠르게
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 실행한 사용자 (run.starter.email - repository에서 selectinload로 함께 불러옴)
    starter: Mapped[User | None] = relationship()
    #  * 이 실행에서 거친 노드 목록 (실행 순서대로)
    #  - order_by: 항상 seq(실행 순서) 순서로 불러옴
    #  - passive_deletes=True: 실행 기록을 지우면 DB가 노드 기록을 함께 지움 (ondelete="CASCADE")
    steps: Mapped[list["WorkflowRunStep"]] = relationship(
        order_by="WorkflowRunStep.seq",
        passive_deletes=True,
    )


class WorkflowRunStep(Base):
    __tablename__ = "workflow_run_steps"

    # 1. 기본 정보
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )
    # 어느 실행의 노드 기록인지 (실행 기록을 지우면 함께 지워짐)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)  # 실행 순서 (1부터)
    # 노드 정보 (그래프의 노드 ID, 종류, 이름)
    node_id: Mapped[str] = mapped_column(String(50), nullable=False)
    node_type: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(50), nullable=False)

    # 2. 결과
    #  - status: done(완료) / error(오류) / stopped(중지)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    #  * 노드 종류별 결과 (orchestration/workflow_runner.py 의 node_done 이벤트 내용)
    #  - 예) 에이전트: {"prompt": ..., "answer": ..., "steps": 2, "finish_reason": "stop"}
    #  - 끝나지 못한 노드(오류, 중지)는 None
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    #  * 에이전트 노드의 진행 기록 (생각 과정, 답변 조각, 도구 실행을 도착한 순서대로)
    #  - 예) [{"kind": "reasoning", "text": ...}, {"kind": "tool", "name": "calculator", ...}]
    #  - 화면(components/agent/RunParts.tsx 의 RunPart)과 같은 모양
    parts: Mapped[list[Any]] = mapped_column(
        JSONB,
        default=list,
        server_default=text("'[]'::jsonb"),
        nullable=False,
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 에이전트 노드: 사용한 모델 이름 (모델별 사용량 통계용), 토큰
    model_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    input_tokens: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 걸린 시간 (밀리초)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
