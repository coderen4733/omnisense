from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.services.gateway.llm.models import LLMModel, LLMProvider

# 📌 selectinload 를 사용하는 이유
#  - 비동기 SQLAlchemy에서는 provider.models 처럼 "연결된 데이터"를 나중에 꺼내면
#    MissingGreenlet 에러가 날 수 있음 (자동으로 추가 조회를 할 수 없기 때문)
#  - selectinload(LLMProvider.models): 공급자를 조회할 때 모델 목록도 "미리 함께" 불러옴
#
# 📌 commit은 여기서 하지 않고 service.py 에서 함 (user/repository.py 설명 참고)


# ============================================================
# 1. LLM 공급자 (Provider)
# ============================================================


# LLM 공급자 목록 조회(R-L) - 모델 목록 포함, 등록 순서대로
async def get_providers(session: AsyncSession) -> list[LLMProvider]:
    # 1. Repository <- DB
    query = select(LLMProvider).options(selectinload(LLMProvider.models)).order_by(LLMProvider.id)
    result = await session.execute(query)
    # 2. Repository -> Service
    return list(result.scalars().all())


# LLM 공급자 조회(R-D) by id - 모델 목록 포함
async def get_provider_by_id(session: AsyncSession, provider_id: int) -> LLMProvider | None:
    # 1. Repository <- DB
    query = (
        select(LLMProvider)
        .options(selectinload(LLMProvider.models))
        .where(LLMProvider.id == provider_id)
    )
    result = await session.execute(query)
    # 2. Repository -> Service
    return result.scalar_one_or_none()


# LLM 공급자 조회(R-D) by name - 이름 중복 확인용
async def get_provider_by_name(session: AsyncSession, name: str) -> LLMProvider | None:
    # 1. Repository <- DB
    query = select(LLMProvider).where(LLMProvider.name == name)
    result = await session.execute(query)
    # 2. Repository -> Service
    return result.scalar_one_or_none()


# LLM 공급자 생성(C)
async def create_provider(session: AsyncSession, provider: LLMProvider) -> LLMProvider:
    # 1. Repository -> DB (INSERT, 아직 commit 전)
    session.add(provider)
    await session.flush()
    # 2. provider 객체 갱신
    #  - refresh(provider): DB가 채운 값(id, created_at 등)을 다시 읽어옴
    #  - refresh(provider, ["models"]): 모델 목록(새 공급자라 빈 목록)도 불러옴
    #    => 응답(ProviderRes)을 만들 때 provider.models 를 안전하게 읽기 위함
    await session.refresh(provider)
    await session.refresh(provider, attribute_names=["models"])
    # 3. Repository -> Service
    return provider


# LLM 공급자 수정(U) - 속성 값만 바꾼 뒤 호출 (user/repository.py 의 update_user 설명 참고)
async def update_provider(session: AsyncSession, provider: LLMProvider) -> LLMProvider:
    # 1. Repository -> DB (UPDATE)
    await session.flush()
    # 2. provider 객체 갱신 (DB가 바꾼 updated_at 등 + 모델 목록)
    await session.refresh(provider)
    await session.refresh(provider, attribute_names=["models"])
    # 3. Repository -> Service
    return provider


# LLM 공급자 삭제(D) - 그 공급자의 모델도 함께 삭제됨 (CASCADE)
async def delete_provider(session: AsyncSession, provider: LLMProvider) -> None:
    await session.delete(provider)


# ============================================================
# 2. LLM 모델 (Model)
#  - 매개변수 llm_model_id: llm_models 테이블의 번호(id) (모델 이름인 model_id와 구분)
# ============================================================


# LLM 모델 조회(R-D) by id - 공급자 정보 포함 (LLM 호출 시 공급자 접속 정보가 필요하므로)
async def get_model_by_id(session: AsyncSession, llm_model_id: int) -> LLMModel | None:
    # 1. Repository <- DB
    query = (
        select(LLMModel).options(selectinload(LLMModel.provider)).where(LLMModel.id == llm_model_id)
    )
    result = await session.execute(query)
    # 2. Repository -> Service
    return result.scalar_one_or_none()


# LLM 모델 조회(R-D) by 공급자 + 모델 이름 - 중복 등록 확인용
async def get_model_by_provider_and_model_id(
    session: AsyncSession,
    provider_id: int,
    model_id: str,
) -> LLMModel | None:
    # 1. Repository <- DB
    query = select(LLMModel).where(
        LLMModel.provider_id == provider_id,
        LLMModel.model_id == model_id,
    )
    result = await session.execute(query)
    # 2. Repository -> Service
    return result.scalar_one_or_none()


# LLM 모델 생성(C)
async def create_model(session: AsyncSession, model: LLMModel) -> LLMModel:
    # 1. Repository -> DB
    session.add(model)
    await session.flush()
    # 2. model 객체 갱신 (DB가 채운 id, created_at 등)
    await session.refresh(model)
    # 3. Repository -> Service
    return model


# LLM 모델 수정(U)
async def update_model(session: AsyncSession, model: LLMModel) -> LLMModel:
    # 1. Repository -> DB
    await session.flush()
    # 2. model 객체 갱신 (DB가 바꾼 updated_at)
    await session.refresh(model)
    # 3. Repository -> Service
    return model


# LLM 모델 삭제(D)
async def delete_model(session: AsyncSession, model: LLMModel) -> None:
    await session.delete(model)
