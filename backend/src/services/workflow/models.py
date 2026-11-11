from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func, text, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

#  * 공통 Base(src/core/base.py)를 상속 => alembic이 모든 테이블을 한 번에 인식
from src.core.base import Base
from src.services.iam.user.models import User

# 📌 워크플로우(Workflow)란?
#  - 여러 노드(시작, 에이전트, 조건 분기, 끝)를 연결선으로 이어서 하나의 업무 흐름으로 만든 것
#    예) 시작(견적 금액 입력) => 계산 도우미 에이전트 => 조건 분기(100만 원 이상?) => 끝
#  - 노드와 연결선 정보(그래프)는 graph 칸 하나에 JSON으로 저장 (형식은 workflow/graph.py 참고)
#  - 이 테이블은 "설계도"만 저장함 (실행은 orchestration 폴더, 실행 기록은 나중에 별도 테이블)


class Workflow(Base):
    __tablename__ = "workflows"

    # 1. 기본 정보
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )
    # 화면에 보여줄 워크플로우 이름 (예: "견적 금액 검토")
    name: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    #  * 그래프 (노드 + 연결선) - 예) {"nodes": [...], "edges": [...]}
    #  - JSONB: Postgres의 JSON 저장 형식
    #  - ⚠️ 안의 값만 바꾸면 SQLAlchemy가 변경을 알아채지 못하므로,
    #    바꿀 때는 항상 새 dict를 통째로 넣어야 함 (agent/models.py 의 tool_names 설명 참고)
    graph: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        default=dict,
        server_default=text("'{}'::jsonb"),
        nullable=False,
    )

    # 2. 사용 여부 (False면 실행할 수 없고, 일반 사용자(user) 목록에서 보이지 않음)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=true(),
        nullable=False,
    )

    # 3. 메타 정보 (user/models.py 의 created_at, updated_at 설명 참고)
    # 만든 사용자 (사용자가 삭제되어도 워크플로우는 남음)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # 만든 사용자 (workflow.creator.email - repository에서 selectinload로 함께 불러옴)
    creator: Mapped[User | None] = relationship()
