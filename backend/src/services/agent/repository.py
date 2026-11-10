from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.services.agent.models import Agent
from src.services.llm.models import LLMModel

# 📌 selectinload 를 사용하는 이유 (llm/repository.py 설명 참고)
#  - 에이전트를 조회할 때 연결된 LLM 모델 + 그 공급자 + 만든 사용자를 "미리 함께" 불러옴
#    => 응답을 만들 때 agent.llm_model.provider.name 등을 안전하게 읽을 수 있음
#
# 📌 populate_existing 을 사용하는 이유
#  - 같은 세션 안에서 이미 불러온 에이전트를 다시 조회하면, SQLAlchemy는 DB를 다시 읽지 않고
#    "기억해 둔 객체"를 그대로 돌려줌
#  - 에이전트를 수정한 직후(예: 모델 변경) 다시 조회할 때, 예전 모델 정보가 남아 있지 않도록
#    populate_existing=True 로 항상 DB 값으로 새로 채움
#
# 📌 commit은 여기서 하지 않고 service.py 에서 함 (user/repository.py 설명 참고)


# 에이전트 조회 쿼리의 공통 부분 (연결된 정보 함께 불러오기 + 항상 DB 값으로 새로 채우기)
def _agent_query() -> Select[tuple[Agent]]:
    return (
        select(Agent)
        .options(
            selectinload(Agent.llm_model).selectinload(LLMModel.provider),
            selectinload(Agent.creator),
        )
        .execution_options(populate_existing=True)
    )


#  * 에이전트 목록 조회(R-L) - 등록 순서대로
#  - only_active=True: "사용" 상태인 에이전트만 (일반 사용자용)
async def get_agents(session: AsyncSession, only_active: bool = False) -> list[Agent]:
    # 1. Repository <- DB
    query = _agent_query().order_by(Agent.id)
    if only_active:
        query = query.where(Agent.is_active.is_(True))
    result = await session.execute(query)
    # 2. Repository -> Service
    return list(result.scalars().all())


# 에이전트 조회(R-D) by id - 연결된 모델, 공급자, 만든 사용자 포함
async def get_agent_by_id(session: AsyncSession, agent_id: int) -> Agent | None:
    # 1. Repository <- DB
    result = await session.execute(_agent_query().where(Agent.id == agent_id))
    # 2. Repository -> Service
    return result.scalar_one_or_none()


# 에이전트 조회(R-D) by name - 이름 중복 확인용
async def get_agent_by_name(session: AsyncSession, name: str) -> Agent | None:
    # 1. Repository <- DB
    result = await session.execute(select(Agent).where(Agent.name == name))
    # 2. Repository -> Service
    return result.scalar_one_or_none()


#  * 에이전트 생성(C)
#  - flush: INSERT를 DB에 보내서 id를 받아옴 (아직 commit 전)
#  - 연결된 정보까지 포함한 응답은 commit 후 get_agent_by_id로 다시 조회해서 만듦
async def create_agent(session: AsyncSession, agent: Agent) -> Agent:
    # 1. Repository -> DB (INSERT, 아직 commit 전)
    session.add(agent)
    await session.flush()
    # 2. Repository -> Service
    return agent


# 에이전트 수정(U) - 속성 값만 바꾼 뒤 호출 (user/repository.py 의 update_user 설명 참고)
async def update_agent(session: AsyncSession, agent: Agent) -> Agent:
    # 1. Repository -> DB (UPDATE)
    await session.flush()
    # 2. Repository -> Service
    return agent


# 에이전트 삭제(D)
async def delete_agent(session: AsyncSession, agent: Agent) -> None:
    await session.delete(agent)
