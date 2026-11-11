from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.services.agent.models import Agent
from src.services.workflow.models import Workflow

# 📌 selectinload, populate_existing 를 사용하는 이유: agent/repository.py 설명 참고
# 📌 commit은 여기서 하지 않고 service.py 에서 함 (user/repository.py 설명 참고)


#  * 워크플로우 목록 조회(R-L) - 최근 수정한 순서대로
#  - only_active=True: "사용" 상태인 워크플로우만 (일반 사용자용)
async def get_workflows(session: AsyncSession, only_active: bool = False) -> list[Workflow]:
    # 1. Repository <- DB
    query = (
        select(Workflow)
        .options(selectinload(Workflow.creator))
        .order_by(Workflow.updated_at.desc(), Workflow.id.desc())
    )
    if only_active:
        query = query.where(Workflow.is_active.is_(True))
    result = await session.execute(query)
    # 2. Repository -> Service
    return list(result.scalars().all())


# 워크플로우 조회(R-D) by id - 만든 사용자 포함, 항상 DB 값으로 새로 채움
async def get_workflow_by_id(session: AsyncSession, workflow_id: int) -> Workflow | None:
    query = (
        select(Workflow)
        .options(selectinload(Workflow.creator))
        .where(Workflow.id == workflow_id)
        .execution_options(populate_existing=True)
    )
    result = await session.execute(query)
    return result.scalar_one_or_none()


# 워크플로우 조회(R-D) by name - 이름 중복 확인용
async def get_workflow_by_name(session: AsyncSession, name: str) -> Workflow | None:
    result = await session.execute(select(Workflow).where(Workflow.name == name))
    return result.scalar_one_or_none()


# 워크플로우 생성(C) - flush로 id를 받아옴 (commit은 service에서)
async def create_workflow(session: AsyncSession, workflow: Workflow) -> Workflow:
    session.add(workflow)
    await session.flush()
    return workflow


# 워크플로우 수정(U) - 속성 값만 바꾼 뒤 호출
async def update_workflow(session: AsyncSession, workflow: Workflow) -> Workflow:
    await session.flush()
    return workflow


# 워크플로우 삭제(D)
async def delete_workflow(session: AsyncSession, workflow: Workflow) -> None:
    await session.delete(workflow)


#  * 에이전트 "사용" 여부 조회 {에이전트 번호: 사용 여부} - 워크플로우 점검용
#  - 그래프에 들어 있는 에이전트를 한 번에 조회 (DB에 없는 번호 = 삭제된 에이전트)
async def get_agent_states(session: AsyncSession, agent_ids: set[int]) -> dict[int, bool]:
    if not agent_ids:
        return {}
    result = await session.execute(
        select(Agent.id, Agent.is_active).where(Agent.id.in_(agent_ids))
    )
    return {agent_id: is_active for agent_id, is_active in result.all()}
