from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

#  * 공통 Base(src/core/base.py)를 상속 => alembic이 모든 테이블을 한 번에 인식
from src.core.base import Base
from src.services.iam.user.models import User
from src.services.llm.models import LLMModel

# 📌 에이전트(Agent)란?
#  - "LLM 모델 + 지시문(시스템 프롬프트) + 사용할 도구"를 묶어서 하나의 업무 담당자로 만든 것
#    예) "사내 계산 도우미" = Qwen 3.5 9B + "항상 한국어로 답하세요" + [계산기, 현재 시각]
#  - 질문을 받으면 모델이 필요한 도구를 스스로 골라 호출하고, 그 결과를 보고 답변함
#
# 📌 테이블 관계
#  - LLM 모델(llm_models) 1개 : 에이전트(agents) 여러 개
#  - 연결된 LLM 모델(또는 그 공급자)을 삭제하면 llm_model_id가 비워짐 (ondelete="SET NULL")
#    => 에이전트는 남아 있고, 화면에서 모델을 다시 선택하면 다시 사용할 수 있음
#  - 에이전트를 만든 사용자가 삭제되어도 에이전트는 남음 (created_by만 비워짐)


class Agent(Base):
    __tablename__ = "agents"

    # 1. 기본 정보
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )
    # 화면에 보여줄 에이전트 이름 (예: "사내 계산 도우미")
    name: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
    )
    # 에이전트 설명 (어떤 일을 하는 에이전트인지)
    description: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    # 2. 사용할 LLM 모델 (llm_models 테이블의 번호)
    llm_model_id: Mapped[int | None] = mapped_column(
        ForeignKey("llm_models.id", ondelete="SET NULL"),
        index=True,  # 모델별 에이전트 조회를 빠르게
        nullable=True,
    )

    # 3. 지시문과 생성 옵션
    #  * 시스템 프롬프트: 에이전트의 역할, 말투, 지켜야 할 규칙 (예: "항상 한국어로 답하세요")
    #  - Text: 길이 제한이 없는 문자열 / server_default="": 비어 있으면 빈 문자열
    system_prompt: Mapped[str] = mapped_column(
        Text,
        default="",
        server_default="",
        nullable=False,
    )
    #  * 생성 옵션 (비어 있으면 공급자 서버의 기본값 사용)
    #  - temperature: 답변의 무작위성 (0에 가까울수록 일정한 답변)
    #  - max_tokens : 한 번에 만들 수 있는 최대 토큰 수
    #  - top_p      : 다음 단어 후보를 고르는 범위
    temperature: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    max_tokens: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    top_p: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    #  * 생각 과정 수준(reasoning_effort) 컬럼
    #  - 에이전트마다 생각 과정을 끄거나(none) 줄일 수 있도록 저장
    #  * 생각 과정 수준: none(끄기) / low / medium / high / None(모델 기본값)
    #  - 단순한 일을 하는 에이전트는 끄면 답변이 훨씬 빨라짐 (core/llm.py 의 ReasoningEffort 참고)
    reasoning_effort: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )
    #  * 도구 호출 최대 반복 횟수
    #  - 모델이 "도구 호출 => 결과 확인 => 또 도구 호출"을 끝없이 반복하지 않도록 제한
    #  - 이 횟수만큼 LLM을 호출해도 최종 답변이 나오지 않으면 실행을 멈춤
    max_iterations: Mapped[int] = mapped_column(
        Integer,
        default=5,
        server_default="5",
        nullable=False,
    )

    #  * 연결된 도구 이름 목록 (예: ["calculator", "get_current_time"])
    #  - JSONB: Postgres의 JSON 저장 형식 (목록을 한 칸에 저장)
    #  - 사용할 수 있는 도구 이름은 tool/registry.py 참고
    #  - ⚠️ 목록 안의 값만 바꾸면(append 등) SQLAlchemy가 변경을 알아채지 못하므로,
    #    값을 바꿀 때는 항상 "새 목록"을 통째로 넣어야 함 (예: agent.tool_names = [...])
    tool_names: Mapped[list[str]] = mapped_column(
        JSONB,
        default=list,
        server_default=text("'[]'::jsonb"),
        nullable=False,
    )

    # 4. 사용 여부 (False면 실행할 수 없고, 일반 사용자(user) 목록에서 보이지 않음)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=true(),
        nullable=False,
    )

    # 5. 메타 정보 (user/models.py 의 created_at, updated_at 설명 참고)
    # 만든 사용자 (users 테이블의 번호)
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

    #  * 연결된 LLM 모델과 만든 사용자 (DB 컬럼이 아니라 파이썬에서 쓰는 "연결 고리")
    #  - agent.llm_model.display_name, agent.creator.email 처럼 꺼내 쓸 수 있음
    #  - ⚠️ 비동기 환경에서는 repository에서 selectinload로 미리 함께 불러와야 함
    #    (llm/models.py 의 LLMProvider.models 설명 참고)
    llm_model: Mapped[LLMModel | None] = relationship()
    creator: Mapped[User | None] = relationship()
