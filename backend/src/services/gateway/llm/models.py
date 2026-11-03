from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
    true,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

#  * 공통 Base(src/core/base.py)를 상속 => alembic이 모든 테이블을 한 번에 인식
from src.core.base import Base
from src.core.llm import LLMProviderType

# 📌 테이블 관계
#  - LLM 공급자(llm_providers) 1개 : LLM 모델(llm_models) 여러 개
#    예) 공급자 "로컬 Ollama" => 모델 qwen3.5:4b, qwen3.5:9b, gpt-oss:latest
#  - 공급자를 삭제하면 그 공급자의 모델도 함께 삭제됨 (ondelete="CASCADE")


class LLMProvider(Base):
    __tablename__ = "llm_providers"

    # 1. 기본 정보
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )
    # 화면에 보여줄 공급자 이름 (예: "로컬 Ollama", "AWS Bedrock 버지니아")
    name: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
    )
    #  * 연결 방식 (openai_compatible / bedrock)
    #  - values_callable, native_enum=False: user/models.py 의 role 컬럼 설명 참고
    #    (이름 대신 값을 저장 + Postgres ENUM 타입 대신 문자열로 저장)
    provider_type: Mapped[LLMProviderType] = mapped_column(
        SAEnum(
            LLMProviderType,
            native_enum=False,
            length=50,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )

    # 2. 접속 정보
    # openai_compatible: 서버 주소 (예: http://localhost:11434/v1)
    base_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )
    # bedrock: AWS 리전 (예: us-east-1)
    region: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )
    #  * 암호화된 API 키 (src/core/security.py 의 encrypt_secret 결과)
    #  - 평문 API 키는 절대 저장하지 않음 / 키가 필요 없는 공급자(Ollama)는 None
    #  - Text: 길이 제한이 없는 문자열 (암호화하면 원래 키보다 길어지므로)
    encrypted_api_key: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # 3. 사용 여부 (False면 이 공급자의 모든 모델을 사용할 수 없음)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=true(),
        nullable=False,
    )

    # 4. 메타 정보 (user/models.py 의 created_at, updated_at 설명 참고)
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

    #  * 이 공급자에 등록된 모델 목록 (DB 컬럼이 아니라 파이썬에서 쓰는 "연결 고리")
    #  - relationship: provider.models 로 모델 목록을 꺼낼 수 있게 해줌
    #  - back_populates: 반대쪽(LLMModel.provider)과 서로 연결
    #  - cascade="all, delete-orphan": 공급자를 삭제하면 모델도 함께 삭제
    #  - passive_deletes=True: 모델 삭제는 DB의 ON DELETE CASCADE에 맡김 (불필요한 조회 방지)
    #  - order_by: 등록한 순서대로 정렬
    #  - ⚠️ 비동기 환경에서는 provider.models를 그냥 읽으면 에러(MissingGreenlet)가 날 수 있으므로
    #    repository에서 selectinload로 미리 함께 불러와야 함
    models: Mapped[list["LLMModel"]] = relationship(
        back_populates="provider",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="LLMModel.id",
    )


class LLMModel(Base):
    __tablename__ = "llm_models"
    #  * 같은 공급자 안에서 같은 모델 ID를 두 번 등록할 수 없음 (공급자가 다르면 가능)
    __table_args__ = (
        UniqueConstraint("provider_id", "model_id", name="uq_llm_models_provider_model"),
    )

    # 1. 기본 정보
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )
    provider_id: Mapped[int] = mapped_column(
        ForeignKey("llm_providers.id", ondelete="CASCADE"),
        index=True,  # 공급자별 모델 조회를 빠르게
        nullable=False,
    )
    #  * 모델 ID: 공급자 서버에서 사용하는 모델 이름 (LLM을 호출할 때 그대로 보냄)
    #  - 예) Ollama: "qwen3.5:9b" / Bedrock: "anthropic.claude-3-haiku-20240307-v1:0"
    #  - 이 테이블의 번호(id)와 헷갈리지 않도록 주의!
    model_id: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    # 화면에 보여줄 이름 (예: "Qwen 3.5 9B")
    display_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    # 2. 모델 기능 (관리자가 등록할 때 직접 체크)
    # 도구 호출 지원 여부 (MCP 도구를 사용하는 에이전트에 연결할 수 있는지)
    supports_tools: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=false(),
        nullable=False,
    )
    # 생각 과정(reasoning) 출력 여부 (화면에서 생각 과정을 따로 보여줄지)
    supports_reasoning: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=false(),
        nullable=False,
    )

    # 3. 사용 여부
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=true(),
        nullable=False,
    )

    # 4. 메타 정보
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

    # 이 모델이 속한 공급자 (model.provider 로 꺼냄 / repository에서 selectinload로 함께 불러옴)
    provider: Mapped["LLMProvider"] = relationship(back_populates="models")
