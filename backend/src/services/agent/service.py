from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.llm import ChatMessage, GenerationParams
from src.services.agent import repository as agent_repository
from src.services.agent.models import Agent
from src.services.agent.schemas import (
    AgentCreateReq,
    AgentModelRes,
    AgentRes,
    AgentRunReq,
    AgentUpdateReq,
    DeleteRes,
    ToolRes,
)
from src.services.iam.user.enums import UserRole
from src.services.iam.user.models import User
from src.services.llm import repository as llm_repository
from src.services.llm import service as llm_service
from src.services.orchestration.agent_runner import PreparedRun
from src.services.tool import registry as tool_registry

# 에이전트를 등록·수정·삭제할 수 있고, "사용 안 함" 에이전트도 볼 수 있는 권한
AGENT_MANAGER_ROLES = (UserRole.ADMIN, UserRole.MANAGER)


# ============================================================
# 1. 공통 도우미 함수 (이 파일 안에서만 사용)
# ============================================================


# SQLAlchemy 에이전트 객체 -> Pydantic 응답 모델 변환
def _to_agent_res(agent: Agent) -> AgentRes:
    # 1. 연결된 LLM 모델 정보 (모델이 삭제되었으면 None)
    model = agent.llm_model
    model_res = None
    if model is not None:
        model_res = AgentModelRes(
            id=model.id,
            display_name=model.display_name,
            model_id=model.model_id,
            provider_name=model.provider.name,
            # 생각 과정 설정 적용 여부 판단용 값
            provider_type=model.provider.provider_type.value,
            supports_tools=model.supports_tools,
            supports_reasoning=model.supports_reasoning,
            is_usable=model.is_active and model.provider.is_active,
        )
    # 2. 에이전트 정보
    return AgentRes(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        llm_model=model_res,
        system_prompt=agent.system_prompt,
        temperature=agent.temperature,
        max_tokens=agent.max_tokens,
        top_p=agent.top_p,
        reasoning_effort=agent.reasoning_effort,  # 생각 과정 수준
        max_iterations=agent.max_iterations,
        tool_names=agent.tool_names,
        is_active=agent.is_active,
        created_by_email=agent.creator.email if agent.creator else None,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


# 앞뒤 공백 제거 후 빈 문자열이면 None (설명 등에 사용)
def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


#  * 도구 이름 목록 정리/검사
#  - 중복 제거 (순서는 유지) / 등록되지 않은 도구 이름이 있으면 에러(400)
#  - dict.fromkeys(목록): 순서를 유지하면서 중복을 없애는 파이썬 관용 표현
def _normalize_tool_names(tool_names: list[str]) -> list[str]:
    names = list(dict.fromkeys(name.strip() for name in tool_names if name.strip()))
    unknown = [name for name in names if not tool_registry.is_known_tool(name)]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"등록되지 않은 도구입니다: {', '.join(unknown)}",
        )
    return names


#  * 선택한 LLM 모델과 도구 조합 확인
#  - 모델이 없으면 에러(400) / 도구를 연결했는데 모델이 도구 호출을 지원하지 않으면 에러(400)
#  - 모델이 "사용 안 함" 상태여도 저장은 허용 (실행할 때 다시 확인함)
async def _check_model_and_tools(
    session: AsyncSession,
    llm_model_id: int | None,
    tool_names: list[str],
) -> None:
    if llm_model_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="에이전트가 사용할 LLM 모델을 선택해 주세요.",
        )
    model = await llm_repository.get_model_by_id(session, llm_model_id)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="존재하지 않는 LLM 모델입니다.",
        )
    if tool_names and not model.supports_tools:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{model.display_name}' 모델은 도구 호출을 지원하지 않습니다. "
                "도구를 빼거나 도구 호출을 지원하는 모델을 선택해 주세요."
            ),
        )


#  * 에이전트 조회 + 없으면 에러(404)
#  - 일반 사용자(user)에게는 "사용 안 함" 에이전트를 없는 것처럼 처리
async def _get_agent_or_404(
    session: AsyncSession,
    agent_id: int,
    current_user: User | None = None,
) -> Agent:
    agent = await agent_repository.get_agent_by_id(session, agent_id)
    hidden = (
        agent is not None
        and not agent.is_active
        and current_user is not None
        and current_user.role not in AGENT_MANAGER_ROLES
    )
    if agent is None or hidden:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="존재하지 않는 에이전트입니다.",
        )
    return agent


# 이름 중복 에러 (등록/수정에서 공통 사용)
NAME_CONFLICT_ERROR = HTTPException(
    status_code=status.HTTP_409_CONFLICT,
    detail="이미 같은 이름의 에이전트가 있습니다.",
)


# ============================================================
# 2. 에이전트 (Agent)
# ============================================================


#  * 에이전트 목록 조회(R-L) API
#  - admin, manager: 전체 / user: "사용" 상태인 에이전트만
async def read_agents(session: AsyncSession, current_user: User) -> list[AgentRes]:
    # 1. Service -> Repository
    only_active = current_user.role not in AGENT_MANAGER_ROLES
    agents = await agent_repository.get_agents(session, only_active=only_active)
    # 2. SQLAlchemy 객체 -> Pydantic Response 모델 변환
    return [_to_agent_res(agent) for agent in agents]


# 에이전트 조회(R-D) API
async def read_agent(session: AsyncSession, agent_id: int, current_user: User) -> AgentRes:
    agent = await _get_agent_or_404(session, agent_id, current_user)
    return _to_agent_res(agent)


# 에이전트 등록(C) API
async def create_agent(
    session: AsyncSession,
    dto: AgentCreateReq,
    current_user: User,
) -> AgentRes:
    # 1. 이름 중복 확인
    name = dto.name.strip()
    if await agent_repository.get_agent_by_name(session, name):
        raise NAME_CONFLICT_ERROR

    # 2. 모델과 도구 확인
    tool_names = _normalize_tool_names(dto.tool_names)
    await _check_model_and_tools(session, dto.llm_model_id, tool_names)

    # 3. 에이전트 객체 생성
    agent = Agent(
        name=name,
        description=_clean_text(dto.description),
        llm_model_id=dto.llm_model_id,
        system_prompt=dto.system_prompt.strip(),
        temperature=dto.temperature,
        max_tokens=dto.max_tokens,
        top_p=dto.top_p,
        reasoning_effort=dto.reasoning_effort,  # 생각 과정 수준
        max_iterations=dto.max_iterations,
        tool_names=tool_names,
        created_by=current_user.id,
    )

    # 4. DB 저장 (동시에 같은 이름으로 등록하면 unique 제약에 걸림 => 409)
    try:
        new_agent = await agent_repository.create_agent(session, agent)
        await session.commit()
    except IntegrityError as err:
        await session.rollback()
        raise NAME_CONFLICT_ERROR from err

    # 5. 연결된 정보(모델, 공급자, 만든 사용자)까지 포함해서 다시 조회 => Service -> Router
    return _to_agent_res(await _get_agent_or_404(session, new_agent.id))


#  * 에이전트 수정(U) API
#  - dto.model_fields_set: 요청에 "실제로 보낸" 항목 이름 목록
#    (schemas.py 의 AgentUpdateReq 설명 참고)
#    => temperature 처럼 비워둘 수 있는 값은, 보냈으면 null이어도 반영 (= 비우기)
async def update_agent(session: AsyncSession, agent_id: int, dto: AgentUpdateReq) -> AgentRes:
    # 1. 대상 에이전트 조회
    agent = await _get_agent_or_404(session, agent_id)
    sent = dto.model_fields_set

    # 2. 보낸 값만 변경
    # 2-1. 이름 (바꾸려는 이름이 다른 에이전트와 겹치면 에러)
    if dto.name is not None:
        name = dto.name.strip()
        if name != agent.name and await agent_repository.get_agent_by_name(session, name):
            raise NAME_CONFLICT_ERROR
        agent.name = name
    # 2-2. 설명, 시스템 프롬프트
    if "description" in sent:
        agent.description = _clean_text(dto.description)
    if dto.system_prompt is not None:
        agent.system_prompt = dto.system_prompt.strip()
    # 2-3. 생성 옵션 (null을 보내면 비움 => 공급자 서버 기본값 사용)
    if "temperature" in sent:
        agent.temperature = dto.temperature
    if "max_tokens" in sent:
        agent.max_tokens = dto.max_tokens
    if "top_p" in sent:
        agent.top_p = dto.top_p
    #  * 생각 과정 수준
    #  - 다른 생성 옵션과 같이, null을 보내면 비움(모델 기본값)으로 처리
    if "reasoning_effort" in sent:
        agent.reasoning_effort = dto.reasoning_effort
    if dto.max_iterations is not None:
        agent.max_iterations = dto.max_iterations
    # 2-4. 모델과 도구 (둘 중 하나라도 바꾸면 바뀐 조합이 맞는지 다시 확인)
    if "llm_model_id" in sent or dto.tool_names is not None:
        llm_model_id = dto.llm_model_id if "llm_model_id" in sent else agent.llm_model_id
        tool_names = (
            _normalize_tool_names(dto.tool_names)
            if dto.tool_names is not None
            else agent.tool_names
        )
        await _check_model_and_tools(session, llm_model_id, tool_names)
        agent.llm_model_id = llm_model_id
        # 목록은 항상 새 목록으로 통째로 바꿔야 변경이 저장됨 (models.py 의 tool_names 설명 참고)
        agent.tool_names = list(tool_names)
    # 2-5. 사용 여부
    if dto.is_active is not None:
        agent.is_active = dto.is_active

    # 3. DB 반영
    try:
        await agent_repository.update_agent(session, agent)
        await session.commit()
    except IntegrityError as err:
        await session.rollback()
        raise NAME_CONFLICT_ERROR from err

    # 4. 바뀐 모델 정보까지 포함해서 다시 조회 => Service -> Router
    return _to_agent_res(await _get_agent_or_404(session, agent_id))


# 에이전트 삭제(D) API
async def delete_agent(session: AsyncSession, agent_id: int) -> DeleteRes:
    agent = await _get_agent_or_404(session, agent_id)
    await agent_repository.delete_agent(session, agent)
    await session.commit()
    return DeleteRes(success=True)


# 에이전트에 연결할 수 있는 도구 목록 API
def read_tools() -> list[ToolRes]:
    return [
        ToolRes(name=tool.definition.name, label=tool.label, description=tool.summary)
        for tool in tool_registry.list_tools()
    ]


# ============================================================
# 3. 에이전트 실행 (Run) - 스트리밍
# ============================================================


# [수정] * 실행 준비를 두 함수로 나눔 [2026-11-10 16:15]
# [기존] prepare_run 하나에서 에이전트 조회, 실행 가능 여부 확인, 메시지 만들기를 모두 했습니다.
# [변경] "에이전트 1개를 실행할 수 있게 준비"하는 부분을 prepare_agent_run 으로 떼어냈습니다.
#        => 워크플로우의 에이전트 노드(workflow/service.py)도 같은 확인 과정을 그대로 사용
#        prepare_run(에이전트 테스트 실행 API)의 동작은 그대로입니다.


#  * 에이전트 1개 실행 준비 (실행 가능 여부 확인 + 접속 정보 + 메시지/옵션/도구 변환)
#  - messages: 시스템 프롬프트 뒤에 붙일 대화
#    (워크플로우에서는 빈 목록을 넘기고, 노드를 실행할 때 질문을 붙임)
#  - 실행할 수 없으면 에러(400) - 메시지는 화면에 그대로 보여줄 수 있는 문장
#  - commit은 하지 않음 (호출하는 쪽에서 DB 작업을 모두 마친 뒤 함)
async def prepare_agent_run(
    session: AsyncSession,
    agent: Agent,
    messages: list[ChatMessage],
) -> PreparedRun:
    # 1. 실행할 수 있는 에이전트인지 확인
    if not agent.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비활성화된 에이전트입니다. 에이전트를 먼저 활성화해 주세요.",
        )
    if agent.llm_model_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="연결된 LLM 모델이 삭제되었습니다. 에이전트 설정에서 모델을 다시 선택해 주세요.",
        )

    # 2. 모델 확인 + 접속 정보 만들기 (모델/공급자가 비활성화면 400)
    model, connection = await llm_service.get_usable_model_connection(session, agent.llm_model_id)
    #  * 도구 설명 목록
    #  - 저장한 뒤에 모델 설정에서 "도구 호출 지원"을 끈 경우에도 막음
    tools = tool_registry.get_tool_definitions(agent.tool_names)
    if tools and not model.supports_tools:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{model.display_name}' 모델은 도구 호출을 지원하지 않습니다. "
                "에이전트 설정에서 도구를 빼거나 모델을 바꿔 주세요."
            ),
        )

    # 3. 메시지 만들기 (시스템 프롬프트 + 넘겨받은 대화)
    run_messages: list[ChatMessage] = []
    if agent.system_prompt:
        run_messages.append(ChatMessage(role="system", content=agent.system_prompt))
    run_messages.extend(messages)

    return PreparedRun(
        connection=connection,
        model_name=model.model_id,
        messages=run_messages,
        params=GenerationParams(
            temperature=agent.temperature,
            max_tokens=agent.max_tokens,
            top_p=agent.top_p,
            # 생각 과정 수준 전달 (OpenAI 호환 공급자만 적용됨)
            reasoning_effort=agent.reasoning_effort,
        ),
        tools=tools,
        max_iterations=agent.max_iterations,
    )


#  * 에이전트 테스트 실행 준비 (에이전트 실행 API용)
#  - 스트리밍 응답은 라우터 함수가 끝난 "뒤에" 실행되므로, DB 작업은 여기서 모두 끝냄
#    (llm/service.py 의 PreparedChat 설명 참고)
async def prepare_run(
    session: AsyncSession,
    agent_id: int,
    dto: AgentRunReq,
    current_user: User,
) -> PreparedRun:
    # 1. 에이전트 조회 (없거나, 일반 사용자에게 숨겨진 에이전트면 404)
    agent = await _get_agent_or_404(session, agent_id, current_user)
    # 2. 마지막 메시지는 사용자 질문이어야 함
    if dto.messages[-1].role != "user":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="마지막 메시지는 사용자 질문이어야 합니다.",
        )

    # 3. 실행 준비 (실행 가능 여부 확인 + 시스템 프롬프트 + 지금까지의 대화)
    prepared = await prepare_agent_run(
        session,
        agent,
        [ChatMessage(role=message.role, content=message.content) for message in dto.messages],
    )
    # 4. DB 작업 끝 => 트랜잭션 종료 (LLM 응답을 기다리는 동안 DB 연결을 붙잡지 않도록)
    await session.commit()
    return prepared
