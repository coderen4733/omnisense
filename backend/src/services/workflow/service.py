# [수정] * 워크플로우 실행 준비(prepare_run) 추가 [2026-11-10 16:30]
# [기존] 워크플로우 목록/조회/만들기/수정/삭제만 있었습니다.
# [변경] 맨 아래 "3. 워크플로우 실행"에 실행 전 확인 + 준비 함수를 추가했습니다.
#        (실제 실행은 orchestration/workflow_runner.py 가 담당)

# [수정] * 실행할 때 실행 기록을 만들도록 변경 [2026-11-11 11:40]
# [기존] prepare_run 은 실행 준비(PreparedWorkflowRun)만 돌려줬습니다.
# [변경] 실행 기록(workflow_runs)을 "실행 중" 상태로 먼저 만들고, 그 번호(run_id)도 함께 돌려줍니다.
#        이때 보관 기간(WORKFLOW_RUN_RETENTION_DAYS)이 지난 오래된 기록도 지웁니다.

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import get_settings
from src.services.agent import repository as agent_repository
from src.services.agent import service as agent_service
from src.services.iam.user.enums import UserRole
from src.services.iam.user.models import User
from src.services.orchestration.agent_runner import PreparedRun
from src.services.orchestration.workflow_runner import PreparedWorkflowRun, parse_number
from src.services.run import repository as run_repository
from src.services.run.models import WorkflowRun
from src.services.workflow import graph as workflow_graph
from src.services.workflow import repository as workflow_repository
from src.services.workflow.graph import AgentNode, GraphIssue, StartNode, WorkflowGraph
from src.services.workflow.models import Workflow
from src.services.workflow.schemas import (
    DeleteRes,
    GraphIssueRes,
    WorkflowCreateReq,
    WorkflowRes,
    WorkflowRunReq,
    WorkflowSummaryRes,
    WorkflowUpdateReq,
)

# 워크플로우를 만들기·수정·삭제할 수 있고, "사용 안 함" 워크플로우도 볼 수 있는 권한
WORKFLOW_MANAGER_ROLES = (UserRole.ADMIN, UserRole.MANAGER)

# 이름 중복 에러 (만들기/수정에서 공통 사용)
NAME_CONFLICT_ERROR = HTTPException(
    status_code=status.HTTP_409_CONFLICT,
    detail="이미 같은 이름의 워크플로우가 있습니다.",
)


# ============================================================
# 1. 공통 도우미 함수 (이 파일 안에서만 사용)
# ============================================================


#  * DB에 저장된 그래프(dict) => WorkflowGraph 변환
#  - 저장할 때 이미 형식을 검사하므로 보통 실패하지 않음
#  - 나중에 그래프 형식이 바뀌어 예전 데이터를 읽지 못하는 경우를 대비해,
#    실패하면 빈 그래프 + 문제 메시지로 돌려줌 (화면이 아예 열리지 않는 것을 방지)
def _load_graph(raw: dict) -> tuple[WorkflowGraph, list[GraphIssue]]:
    try:
        return WorkflowGraph.model_validate(raw), []
    except ValidationError:
        return WorkflowGraph(), [GraphIssue(None, "저장된 그래프를 읽을 수 없습니다.")]


# 문제 목록 => 응답 형식
def _to_issue_res(issues: list[GraphIssue]) -> list[GraphIssueRes]:
    return [GraphIssueRes(node_id=issue.node_id, message=issue.message) for issue in issues]


# 목록용 응답 만들기 (그래프는 빼고 노드 수, 문제 수만)
def _to_summary_res(
    workflow: Workflow,
    graph: WorkflowGraph,
    issue_count: int,
) -> WorkflowSummaryRes:
    return WorkflowSummaryRes(
        id=workflow.id,
        name=workflow.name,
        description=workflow.description,
        node_count=len(graph.nodes),
        issue_count=issue_count,
        is_active=workflow.is_active,
        created_by_email=workflow.creator.email if workflow.creator else None,
        created_at=workflow.created_at,
        updated_at=workflow.updated_at,
    )


#  * 상세 응답 만들기 (그래프 + 실행 전에 고쳐야 할 문제 목록)
#  - 문제 점검에 필요한 에이전트 상태를 DB에서 조회함
async def _to_workflow_res(session: AsyncSession, workflow: Workflow) -> WorkflowRes:
    graph, load_issues = _load_graph(workflow.graph)
    agent_states = await workflow_repository.get_agent_states(
        session, workflow_graph.agent_ids_in(graph)
    )
    issues = load_issues + workflow_graph.find_issues(graph, agent_states)
    summary = _to_summary_res(workflow, graph, len(issues))
    return WorkflowRes(**summary.model_dump(), graph=graph, issues=_to_issue_res(issues))


# 앞뒤 공백 제거 후 빈 문자열이면 None
def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


#  * 워크플로우 조회 + 없으면 에러(404)
#  - 일반 사용자(user)에게는 "사용 안 함" 워크플로우를 없는 것처럼 처리
async def _get_workflow_or_404(
    session: AsyncSession,
    workflow_id: int,
    current_user: User | None = None,
) -> Workflow:
    workflow = await workflow_repository.get_workflow_by_id(session, workflow_id)
    hidden = (
        workflow is not None
        and not workflow.is_active
        and current_user is not None
        and current_user.role not in WORKFLOW_MANAGER_ROLES
    )
    if workflow is None or hidden:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="존재하지 않는 워크플로우입니다.",
        )
    return workflow


# ============================================================
# 2. 워크플로우 (Workflow)
# ============================================================


#  * 워크플로우 목록 조회(R-L) API
#  - admin, manager: 전체 / user: "사용" 상태인 워크플로우만
#  - 각 워크플로우의 문제 수(issue_count)도 함께 계산
#    (에이전트 상태는 모든 워크플로우의 에이전트를 모아서 DB에서 한 번에 조회)
async def read_workflows(session: AsyncSession, current_user: User) -> list[WorkflowSummaryRes]:
    # 1. Service -> Repository
    only_active = current_user.role not in WORKFLOW_MANAGER_ROLES
    workflows = await workflow_repository.get_workflows(session, only_active=only_active)

    # 2. 그래프 읽기 + 에이전트 상태 한 번에 조회
    loaded = [(workflow, *_load_graph(workflow.graph)) for workflow in workflows]
    all_agent_ids: set[int] = set()
    for _, graph, _ in loaded:
        all_agent_ids |= workflow_graph.agent_ids_in(graph)
    agent_states = await workflow_repository.get_agent_states(session, all_agent_ids)

    # 3. 응답 만들기
    return [
        _to_summary_res(
            workflow,
            graph,
            len(load_issues) + len(workflow_graph.find_issues(graph, agent_states)),
        )
        for workflow, graph, load_issues in loaded
    ]


# 워크플로우 조회(R-D) API - 편집 화면용 (그래프 + 문제 목록)
async def read_workflow(
    session: AsyncSession,
    workflow_id: int,
    current_user: User,
) -> WorkflowRes:
    workflow = await _get_workflow_or_404(session, workflow_id, current_user)
    return await _to_workflow_res(session, workflow)


#  * 워크플로우 만들기(C) API
#  - 기본 그래프(시작 => 끝)로 만듦 => 이후 편집 화면에서 그려서 저장
async def create_workflow(
    session: AsyncSession,
    dto: WorkflowCreateReq,
    current_user: User,
) -> WorkflowRes:
    # 1. 이름 중복 확인
    name = dto.name.strip()
    if await workflow_repository.get_workflow_by_name(session, name):
        raise NAME_CONFLICT_ERROR

    # 2. 워크플로우 객체 생성
    #  - model_dump(): Pydantic 객체 => dict (JSON으로 저장할 수 있는 모양)
    workflow = Workflow(
        name=name,
        description=_clean_text(dto.description),
        graph=workflow_graph.default_graph().model_dump(),
        created_by=current_user.id,
    )

    # 3. DB 저장 (동시에 같은 이름으로 만들면 unique 제약에 걸림 => 409)
    try:
        new_workflow = await workflow_repository.create_workflow(session, workflow)
        await session.commit()
    except IntegrityError as err:
        await session.rollback()
        raise NAME_CONFLICT_ERROR from err

    # 4. 만든 사용자 정보까지 포함해서 다시 조회 => Service -> Router
    return await _to_workflow_res(session, await _get_workflow_or_404(session, new_workflow.id))


#  * 워크플로우 수정(U) API
#  - 그래프는 "구조 오류"(없는 노드를 잇는 선 등)만 저장을 막고,
#    "실행 전에 고쳐야 할 문제"(에이전트 미선택 등)는 저장한 뒤 issues로 알려줌
#    (그리는 도중에도 저장할 수 있도록)
async def update_workflow(
    session: AsyncSession,
    workflow_id: int,
    dto: WorkflowUpdateReq,
) -> WorkflowRes:
    # 1. 대상 워크플로우 조회
    workflow = await _get_workflow_or_404(session, workflow_id)

    # 2. 보낸 값만 변경
    if dto.name is not None:
        name = dto.name.strip()
        if name != workflow.name and await workflow_repository.get_workflow_by_name(session, name):
            raise NAME_CONFLICT_ERROR
        workflow.name = name
    if "description" in dto.model_fields_set:
        workflow.description = _clean_text(dto.description)
    if dto.graph is not None:
        error = workflow_graph.find_structure_error(dto.graph)
        if error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
        # 새 dict로 통째로 넣어야 변경이 저장됨 (models.py 의 graph 설명 참고)
        workflow.graph = dto.graph.model_dump()
    if dto.is_active is not None:
        workflow.is_active = dto.is_active

    # 3. DB 반영
    try:
        await workflow_repository.update_workflow(session, workflow)
        await session.commit()
    except IntegrityError as err:
        await session.rollback()
        raise NAME_CONFLICT_ERROR from err

    # 4. 바뀐 내용으로 다시 조회 (updated_at 등) => Service -> Router
    return await _to_workflow_res(session, await _get_workflow_or_404(session, workflow_id))


# 워크플로우 삭제(D) API
async def delete_workflow(session: AsyncSession, workflow_id: int) -> DeleteRes:
    workflow = await _get_workflow_or_404(session, workflow_id)
    await workflow_repository.delete_workflow(session, workflow)
    await session.commit()
    return DeleteRes(success=True)


# ============================================================
# 3. 워크플로우 실행 (Run) - 스트리밍
# ============================================================

# 시작 노드 입력값 1개의 최대 글자 수 (에이전트에 보낼 내용의 최대 길이와 같게)
MAX_INPUT_LENGTH = 20000


#  * 시작 노드 입력값 확인 + 정리 => {입력 칸 이름: 값}
#  - 앞뒤 공백 제거 / 필수 칸이 비었거나, 숫자 칸에 숫자가 아닌 값이 오면 에러(400)
#  - 선택 칸을 비워 두면 빈 글자("")로 넣음 ({{start.입력칸}} 이 빈 글자로 바뀜)
#  - 시작 노드에 없는 이름으로 보낸 값은 버림
def _check_inputs(start: StartNode, raw_inputs: dict[str, str]) -> dict[str, str]:
    inputs: dict[str, str] = {}
    for item in start.data.inputs:
        value = raw_inputs.get(item.key, "").strip()
        if len(value) > MAX_INPUT_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{item.label}' 칸은 {MAX_INPUT_LENGTH:,}자까지 입력할 수 있습니다.",
            )
        if not value and item.required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{item.label}' 칸을 입력해 주세요.",
            )
        if value and item.type == "number" and parse_number(value) is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{item.label}' 칸에는 숫자를 입력해 주세요.",
            )
        inputs[item.key] = value
    return inputs


#  * 워크플로우 실행 준비
#  - 실행 가능 여부 확인 + 입력값 확인 + 에이전트 노드 준비 + 실행 기록 만들기
#  - 스트리밍 응답은 라우터 함수가 끝난 "뒤에" 실행되므로, DB 작업은 여기서 모두 끝냄
#    (agent/service.py 의 prepare_run 과 같은 방식)
#  - 실행은 "마지막으로 저장한" 그래프 기준 (화면에서 고치고 저장하지 않은 내용은 반영되지 않음)
#  - 반환값: (실행 준비, 실행 기록 번호)
#    (실행하면서 기록을 채우는 것은 orchestration/run_recorder.py)
async def prepare_run(
    session: AsyncSession,
    workflow_id: int,
    dto: WorkflowRunReq,
    current_user: User,
) -> tuple[PreparedWorkflowRun, int]:
    # 1. 실행할 수 있는 워크플로우인지 확인
    workflow = await _get_workflow_or_404(session, workflow_id, current_user)
    if not workflow.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="'사용 안 함' 상태인 워크플로우입니다. 먼저 '사용'으로 바꿔 주세요.",
        )

    # 2. 실행 전에 고쳐야 할 문제가 남아 있으면 실행하지 않음
    graph, load_issues = _load_graph(workflow.graph)
    agent_states = await workflow_repository.get_agent_states(
        session, workflow_graph.agent_ids_in(graph)
    )
    issues = load_issues + workflow_graph.find_issues(graph, agent_states)
    if issues:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"실행 전에 고쳐야 할 문제가 {len(issues)}개 있습니다. "
                "편집 화면의 문제 목록을 확인해 주세요."
            ),
        )

    # 3. 시작 노드 입력값 확인 (점검을 통과했으므로 시작 노드는 정확히 1개)
    start = next(node for node in graph.nodes if isinstance(node, StartNode))
    inputs = _check_inputs(start, dto.inputs)

    #  4. 에이전트 노드 실행 준비 (에이전트 테스트 실행과 같은 확인 과정 - 모델 사용 여부 등)
    #  - 같은 에이전트를 여러 노드에서 쓰면 한 번만 준비해서 함께 사용 (prepared_by_agent)
    #  - 실패하면 어느 노드의 문제인지 메시지 앞에 붙여서 알려줌
    agent_runs: dict[str, PreparedRun] = {}
    prepared_by_agent: dict[int, PreparedRun] = {}
    for node in graph.nodes:
        if not isinstance(node, AgentNode) or node.data.agent_id is None:
            continue
        agent_id = node.data.agent_id
        if agent_id not in prepared_by_agent:
            agent = await agent_repository.get_agent_by_id(session, agent_id)
            if agent is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"'{node.data.label}' 노드: 선택한 에이전트가 삭제되었습니다.",
                )
            try:
                prepared_by_agent[agent_id] = await agent_service.prepare_agent_run(
                    session, agent, []
                )
            except HTTPException as err:
                raise HTTPException(
                    status_code=err.status_code,
                    detail=f"'{node.data.label}' 노드: {err.detail}",
                ) from err
        agent_runs[node.id] = prepared_by_agent[agent_id]

    #  5. 보관 기간이 지난 오래된 실행 기록 지우기 (0 이면 지우지 않음)
    #  - 새 실행을 시작할 때마다 확인 (started_at 에 index 가 있어서 빠름)
    retention_days = get_settings().workflow_run_retention_days
    if retention_days > 0:
        await run_repository.delete_runs_before(
            session, datetime.now(UTC) - timedelta(days=retention_days)
        )

    #  6. 실행 기록 만들기 ("실행 중" 상태)
    #  - 워크플로우 이름과 그래프는 복사해 둠 (나중에 워크플로우를 고치거나 지워도 기록은 그대로)
    run = await run_repository.create_run(
        session,
        WorkflowRun(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            graph=graph.model_dump(),
            inputs=inputs,
            started_by=current_user.id,
        ),
    )

    # 7. DB 작업 끝 => 트랜잭션 종료 (LLM 응답을 기다리는 동안 DB 연결을 붙잡지 않도록)
    await session.commit()
    return PreparedWorkflowRun(graph=graph, inputs=inputs, agent_runs=agent_runs), run.id
