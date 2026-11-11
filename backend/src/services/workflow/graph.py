#  * 워크플로우 그래프(노드 + 연결선)의 형식과 검사
#  - DB를 사용하지 않는 순수 함수만 둠
#    => 저장(workflow/service.py)과 나중에 만들 실행 엔진(orchestration)에서 함께 사용
#  - 그래프 형식은 화면의 캔버스 라이브러리(React Flow)와 같은 모양으로 맞춤
#    => 화면에서 그대로 보내고, 그대로 받아서 그릴 수 있음
#
# 📌 노드 종류 (처음 버전)
#  - start    : 시작 - 워크플로우가 받을 입력 칸 정의 (예: 질문, 금액)
#  - agent    : 에이전트 - 등록된 에이전트를 골라 실행
#  - condition: 조건 분기 - 값을 비교해서 참(true) / 거짓(false) 쪽으로 나눔
#  - end      : 끝 - 최종 결과(출력) 정의
#
# 📌 노드 사이 값 전달: {{노드ID.항목}} 형식으로 앞 노드의 결과를 끼워 넣음
#  - 예) 에이전트에 보낼 내용: "{{start.question}} 를 계산해 줘"
#  - 예) 끝 노드의 출력     : "{{agent_1.answer}}"
#  - 노드별로 꺼낼 수 있는 항목은 output_fields() 참고

import re
from collections import deque
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# ============================================================
# 1. 그래프 형식 (Pydantic - 저장할 때 형식 검사에 사용)
# ============================================================

# 노드 ID 형식: 영문으로 시작, 영문/숫자/_ (예: start, agent_1) - {{노드ID.항목}} 에 쓰이므로 제한
NODE_ID_PATTERN = r"^[A-Za-z][A-Za-z0-9_]{0,49}$"
# 시작 노드 입력 칸 이름 형식: 영문/숫자/_/한글 (예: question, 금액)
INPUT_KEY_PATTERN = r"^[A-Za-z0-9_가-힣]{1,50}$"

#  * {{노드ID.항목}} 찾기 (정규식)
#  - \s*: 괄호 안쪽의 공백은 허용 (예: {{ start.question }})
#  - 괄호 ( ) 로 묶은 부분: 1번 = 노드ID, 2번 = 항목 이름
TEMPLATE_PATTERN = re.compile(r"\{\{\s*([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z0-9_가-힣]+)\s*\}\}")

# 조건 분기의 비교 방법
ConditionOperator = Literal[
    "equals",  # 같음
    "not_equals",  # 같지 않음
    "contains",  # 포함
    "not_contains",  # 포함하지 않음
    "greater_than",  # 큼 (숫자)
    "greater_or_equal",  # 크거나 같음 (숫자)
    "less_than",  # 작음 (숫자)
    "less_or_equal",  # 작거나 같음 (숫자)
    "is_empty",  # 비어 있음 (오른쪽 값 필요 없음)
    "is_not_empty",  # 비어 있지 않음 (오른쪽 값 필요 없음)
]
# 오른쪽 값이 필요 없는 비교 방법
UNARY_OPERATORS = {"is_empty", "is_not_empty"}

# 조건 분기 노드의 출구 이름 (연결선의 sourceHandle 값)
CONDITION_HANDLES = ("true", "false")

# 에이전트 노드가 내보내는 항목 (에이전트의 최종 답변)
AGENT_OUTPUT_FIELD = "answer"


# 노드 위치 (캔버스 좌표)
class Position(BaseModel):
    x: float
    y: float


# 시작 노드의 입력 칸 1개
class StartInput(BaseModel):
    key: str = Field(..., pattern=INPUT_KEY_PATTERN, description="입력 칸 이름 (예: question)")
    label: str = Field(..., min_length=1, max_length=50, description="화면 표시 이름 (예: 질문)")
    type: Literal["text", "number"] = "text"
    required: bool = True


# ----- 노드 종류별 설정값 (data) -----
#  - label: 캔버스에 보이는 노드 이름 (사용자가 바꿀 수 있음)


class StartData(BaseModel):
    label: str = Field(default="시작", max_length=50)
    inputs: list[StartInput] = Field(default_factory=list, max_length=20)


class AgentData(BaseModel):
    label: str = Field(default="에이전트", max_length=50)
    agent_id: int | None = None  # 실행할 에이전트 번호 (아직 고르지 않았으면 None)
    prompt: str = Field(default="", max_length=20000)  # 에이전트에 보낼 내용 ({{ }} 사용 가능)


class ConditionData(BaseModel):
    label: str = Field(default="조건 분기", max_length=50)
    left: str = Field(default="", max_length=2000)  # 비교할 값 (보통 {{노드ID.항목}})
    operator: ConditionOperator = "equals"
    right: str = Field(default="", max_length=2000)  # 기준 값


class EndData(BaseModel):
    label: str = Field(default="끝", max_length=50)
    output: str = Field(default="", max_length=20000)  # 최종 결과 ({{ }} 사용 가능)


#  * 노드 공통 부분
#  - extra="ignore": 화면 라이브러리가 붙이는 값(선택 여부, 크기 등)은 받아도 무시하고 저장하지 않음
class _NodeBase(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., pattern=NODE_ID_PATTERN)
    position: Position


class StartNode(_NodeBase):
    type: Literal["start"]
    data: StartData


class AgentNode(_NodeBase):
    type: Literal["agent"]
    data: AgentData


class ConditionNode(_NodeBase):
    type: Literal["condition"]
    data: ConditionData


class EndNode(_NodeBase):
    type: Literal["end"]
    data: EndData


#  * 노드 1개 = 4종류 중 하나
#  - AnyNode: 함수의 매개변수 타입 등에 짧게 쓰기 위한 별명
#  - discriminator="type": type 값을 보고 어떤 노드 형식으로 검사할지 자동으로 고름
AnyNode = StartNode | AgentNode | ConditionNode | EndNode
WorkflowNode = Annotated[AnyNode, Field(discriminator="type")]


#  * 연결선 1개 (source 노드 => target 노드)
#  - sourceHandle: 조건 분기 노드에서 나가는 선만 사용 ("true" 또는 "false")
#    (React Flow 이름을 그대로 쓰기 위해 camelCase 사용)
class WorkflowEdge(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=100)
    source: str
    target: str
    sourceHandle: Literal["true", "false"] | None = None


# 워크플로우 그래프 전체 (노드 최대 100개, 연결선 최대 300개)
class WorkflowGraph(BaseModel):
    nodes: list[WorkflowNode] = Field(default_factory=list, max_length=100)
    edges: list[WorkflowEdge] = Field(default_factory=list, max_length=300)


# 새 워크플로우의 기본 그래프: 시작(질문 입력 1개) => 끝
def default_graph() -> WorkflowGraph:
    return WorkflowGraph(
        nodes=[
            StartNode(
                id="start",
                type="start",
                position=Position(x=80, y=200),
                data=StartData(
                    inputs=[StartInput(key="question", label="질문", type="text", required=True)]
                ),
            ),
            EndNode(id="end_1", type="end", position=Position(x=640, y=200), data=EndData()),
        ],
        edges=[WorkflowEdge(id="e_start_end_1", source="start", target="end_1")],
    )


# ============================================================
# 2. 구조 검사 - 저장 자체를 막아야 하는 잘못된 형식
#  - 화면이 정상적으로 동작하면 생기지 않는 문제 (잘못된 요청 차단용)
# ============================================================


#  * 구조 오류 찾기 (문제가 없으면 None, 있으면 오류 메시지)
def find_structure_error(graph: WorkflowGraph) -> str | None:
    node_ids = [node.id for node in graph.nodes]
    nodes_by_id = {node.id: node for node in graph.nodes}

    # 1. 노드 ID 중복
    if len(node_ids) != len(set(node_ids)):
        return "노드 ID가 중복되었습니다."
    # 2. 연결선 ID 중복
    edge_ids = [edge.id for edge in graph.edges]
    if len(edge_ids) != len(set(edge_ids)):
        return "연결선 ID가 중복되었습니다."
    # 3. 시작 노드 입력 칸 이름 중복
    for node in graph.nodes:
        if isinstance(node, StartNode):
            keys = [item.key for item in node.data.inputs]
            if len(keys) != len(set(keys)):
                return "시작 노드의 입력 칸 이름이 중복되었습니다."

    seen_edges: set[tuple[str, str | None, str]] = set()
    for edge in graph.edges:
        # 4. 없는 노드를 잇는 선
        source = nodes_by_id.get(edge.source)
        if source is None or edge.target not in nodes_by_id:
            return "존재하지 않는 노드를 잇는 연결선이 있습니다."
        # 5. 자기 자신으로 돌아오는 선
        if edge.source == edge.target:
            return "노드를 자기 자신과 연결할 수 없습니다."
        # 6. 출구(sourceHandle)는 조건 분기 노드에서만, 조건 분기 노드는 출구가 꼭 있어야 함
        if isinstance(source, ConditionNode) != (edge.sourceHandle is not None):
            return "연결선의 출구(참/거짓) 정보가 올바르지 않습니다."
        # 7. 같은 선이 두 번
        key = (edge.source, edge.sourceHandle, edge.target)
        if key in seen_edges:
            return "같은 연결선이 중복되었습니다."
        seen_edges.add(key)
    return None


# ============================================================
# 3. 실행 가능 여부 점검 - 저장은 되지만 실행 전에 고쳐야 하는 문제
#  - 그리는 도중(미완성)에도 저장할 수 있어야 하므로 저장은 막지 않고 "문제 목록"으로 알려줌
# ============================================================


#  * 점검 결과 1건
#  - node_id: 문제가 있는 노드 (워크플로우 전체 문제면 None) => 화면에서 해당 노드를 강조
@dataclass(frozen=True)
class GraphIssue:
    node_id: str | None
    message: str


# 노드가 내보내는 항목 이름 목록 (다른 노드에서 {{노드ID.항목}} 으로 꺼내 쓸 수 있는 것)
def output_fields(node: AnyNode) -> list[str]:
    if isinstance(node, StartNode):
        return [item.key for item in node.data.inputs]
    if isinstance(node, AgentNode):
        return [AGENT_OUTPUT_FIELD]
    return []  # 조건 분기, 끝 노드는 내보내는 값이 없음


#  * 노드에 적힌 글(설정값) 중 {{ }} 를 쓸 수 있는 것들
#  - 반환값: [(항목 화면 이름, 글)] - 문제 메시지에 "어느 칸"인지 알려주기 위함
def _template_fields(node: AnyNode) -> list[tuple[str, str]]:
    if isinstance(node, AgentNode):
        return [("보낼 내용", node.data.prompt)]
    if isinstance(node, ConditionNode):
        return [("비교할 값", node.data.left), ("기준 값", node.data.right)]
    if isinstance(node, EndNode):
        return [("출력", node.data.output)]
    return []


#  * 어떤 노드보다 "앞에서 실행되는" 노드 ID 모음 (연결선을 거꾸로 따라감)
#  - 앞에서 실행된 노드의 결과만 {{ }} 로 꺼내 쓸 수 있음
def _ancestors(node_id: str, incoming: dict[str, list[str]]) -> set[str]:
    found: set[str] = set()
    queue = deque(incoming.get(node_id, []))
    while queue:
        current = queue.popleft()
        if current in found:
            continue
        found.add(current)
        queue.extend(incoming.get(current, []))
    return found


#  * 연결선에 되돌아가는 고리(순환)가 있는지 확인
#  - 진입 차수 방식: 앞 노드가 없는 노드부터 하나씩 지워 나감
def _has_cycle(node_ids: list[str], outgoing: dict[str, list[str]]) -> bool:
    indegree = {node_id: 0 for node_id in node_ids}
    for targets in outgoing.values():
        for target in targets:
            indegree[target] += 1
    queue = deque(node_id for node_id, count in indegree.items() if count == 0)
    removed = 0
    while queue:
        current = queue.popleft()
        removed += 1
        for target in outgoing.get(current, []):
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    # 모든 노드를 지우지 못했다면 = 서로 물고 있는 고리가 남아 있음
    return removed != len(node_ids)


#  * 실행 전에 고쳐야 할 문제 찾기
#  - agent_states: {에이전트 번호: "사용" 여부} (DB에 있는 에이전트만 들어 있음 - 없으면 삭제된 것)
#  - 문제가 없으면 빈 목록
def find_issues(graph: WorkflowGraph, agent_states: dict[int, bool]) -> list[GraphIssue]:
    issues: list[GraphIssue] = []
    nodes_by_id = {node.id: node for node in graph.nodes}
    node_ids = list(nodes_by_id)

    # 노드별로 나가는 선 / 들어오는 선 정리
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    incoming: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    handles: dict[str, list[str | None]] = {node_id: [] for node_id in node_ids}
    for edge in graph.edges:
        outgoing[edge.source].append(edge.target)
        incoming[edge.target].append(edge.source)
        handles[edge.source].append(edge.sourceHandle)

    # 1. 워크플로우 전체
    starts = [node for node in graph.nodes if isinstance(node, StartNode)]
    if len(starts) != 1:
        issues.append(GraphIssue(None, "시작 노드가 정확히 1개 있어야 합니다."))
    if not any(isinstance(node, EndNode) for node in graph.nodes):
        issues.append(GraphIssue(None, "끝 노드가 1개 이상 있어야 합니다."))
    if _has_cycle(node_ids, outgoing):
        issues.append(
            GraphIssue(None, "되돌아가는 연결(순환)이 있습니다. 연결을 한 방향으로만 이어 주세요.")
        )

    # 시작 노드에서 이어지는 노드 (시작이 1개일 때만 확인)
    reachable: set[str] | None = None
    if len(starts) == 1:
        reachable = {starts[0].id}
        queue = deque([starts[0].id])
        while queue:
            for target in outgoing[queue.popleft()]:
                if target not in reachable:
                    reachable.add(target)
                    queue.append(target)

    # 2. 노드별
    for node in graph.nodes:
        def add(message: str, node_id: str = node.id) -> None:
            issues.append(GraphIssue(node_id, message))

        # 2-1. 연결 상태
        if reachable is not None and node.id not in reachable:
            add("시작 노드에서 이어지지 않는 노드입니다.")
        if isinstance(node, StartNode):
            if incoming[node.id]:
                add("시작 노드로 들어오는 연결은 사용할 수 없습니다.")
        elif not incoming[node.id]:
            add("앞 노드와 연결되어 있지 않습니다.")
        if isinstance(node, EndNode):
            if outgoing[node.id]:
                add("끝 노드에서 나가는 연결은 사용할 수 없습니다.")
        elif isinstance(node, ConditionNode):
            for handle, name in (("true", "참"), ("false", "거짓")):
                count = handles[node.id].count(handle)
                if count == 0:
                    add(f"'{name}' 쪽이 다음 노드와 연결되어 있지 않습니다.")
                elif count > 1:
                    add(f"'{name}' 쪽은 다음 노드를 하나만 연결할 수 있습니다.")
        else:
            count = len(outgoing[node.id])
            if count == 0:
                add("다음 노드와 연결되어 있지 않습니다.")
            elif count > 1:
                add("다음 노드는 하나만 연결할 수 있습니다. (갈림길은 조건 분기 노드를 사용)")

        # 2-2. 노드 종류별 설정값
        if isinstance(node, AgentNode):
            agent_id = node.data.agent_id
            if agent_id is None:
                add("실행할 에이전트를 선택해 주세요.")
            elif agent_id not in agent_states:
                add("선택한 에이전트가 삭제되었습니다. 다시 선택해 주세요.")
            elif not agent_states[agent_id]:
                add("선택한 에이전트가 '사용 안 함' 상태입니다.")
            if not node.data.prompt.strip():
                add("에이전트에 보낼 내용을 입력해 주세요.")
        elif isinstance(node, ConditionNode):
            if not node.data.left.strip():
                add("비교할 값을 입력해 주세요.")
            if node.data.operator not in UNARY_OPERATORS and not node.data.right.strip():
                add("기준 값을 입력해 주세요.")
        elif isinstance(node, EndNode) and not node.data.output.strip():
            add("출력할 내용을 입력해 주세요.")

        # 2-3. {{노드ID.항목}} 참조 확인
        ancestors = _ancestors(node.id, incoming)
        for field_name, text in _template_fields(node):
            for ref_id, ref_field in TEMPLATE_PATTERN.findall(text):
                # 메시지용 원래 모양 (f-문자열에서 {{ }} 를 글자로 쓰려면 괄호를 두 번 씀)
                ref = f"{{{{{ref_id}.{ref_field}}}}}"
                ref_node = nodes_by_id.get(ref_id)
                if ref_node is None:
                    add(f"{field_name}: {ref} 의 노드가 없습니다.")
                elif ref_field not in output_fields(ref_node):
                    add(f"{field_name}: {ref} 의 항목이 없습니다.")
                elif ref_id not in ancestors:
                    add(f"{field_name}: {ref} 는 이 노드보다 앞에서 실행되지 않습니다.")

    return issues


# 그래프에 들어 있는 에이전트 번호 모음 (점검할 때 DB에서 한 번에 조회하기 위함)
def agent_ids_in(graph: WorkflowGraph) -> set[int]:
    return {
        node.data.agent_id
        for node in graph.nodes
        if isinstance(node, AgentNode) and node.data.agent_id is not None
    }
