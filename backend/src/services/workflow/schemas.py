from datetime import datetime

from pydantic import BaseModel, Field

from src.services.workflow.graph import WorkflowGraph

# [수정] * 워크플로우 실행 요청(WorkflowRunReq) 추가 [2026-11-10 16:30]
# [기존] 만들기/수정/조회 형식만 있었습니다.
# [변경] 맨 아래 "3. 워크플로우 실행"에 실행 요청 형식을 추가했습니다.

# ============================================================
# 1. 요청 (Req)
# ============================================================


#  * 워크플로우 만들기(C) - 요청(Req)
#  - 그래프는 받지 않고 기본 그래프(시작 => 끝)로 만듦 => 편집 화면에서 그려서 저장
class WorkflowCreateReq(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="워크플로우 이름")
    description: str | None = Field(default=None, max_length=500, description="설명")


#  * 워크플로우 수정(U) - 요청(Req)
#  - 보낸 값만 바꿈 / description은 null을 보내면 비움
#    (agent/schemas.py 의 AgentUpdateReq 설명 참고)
#  - graph: 편집 화면의 "저장" 버튼 => 노드와 연결선 전체를 통째로 보냄
class WorkflowUpdateReq(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    graph: WorkflowGraph | None = None
    is_active: bool | None = None


# ============================================================
# 2. 응답 (Res)
# ============================================================


#  * 실행 전에 고쳐야 할 문제 1건 (graph.py 의 GraphIssue)
#  - node_id: 문제가 있는 노드 (워크플로우 전체 문제면 None)
class GraphIssueRes(BaseModel):
    node_id: str | None
    message: str


#  * 워크플로우 목록용 - 응답(Res) (그래프 전체는 빼고 가볍게)
#  - issue_count: 실행 전에 고쳐야 할 문제 수 (0이면 실행 가능)
class WorkflowSummaryRes(BaseModel):
    id: int
    name: str
    description: str | None
    node_count: int
    issue_count: int
    is_active: bool
    created_by_email: str | None
    created_at: datetime
    updated_at: datetime


# 워크플로우 상세 - 응답(Res) (편집 화면용: 목록 정보 + 그래프 + 문제 목록)
class WorkflowRes(WorkflowSummaryRes):
    graph: WorkflowGraph
    issues: list[GraphIssueRes]


# 삭제(D) - 응답(Res)
class DeleteRes(BaseModel):
    success: bool = True


# ============================================================
# 3. 워크플로우 실행 (Run) - 스트리밍
# ============================================================


#  * 워크플로우 실행 - 요청(Req)
#  - inputs: 시작 노드의 입력값 {입력 칸 이름: 값} (예: {"question": "...", "amount": "1500000"})
#    - 숫자 입력 칸도 글자로 보냄 (화면 입력칸의 값이 글자이므로) => 서버에서 숫자인지 확인
#    - 시작 노드에 없는 이름은 무시함
class WorkflowRunReq(BaseModel):
    inputs: dict[str, str] = Field(default_factory=dict, max_length=20)
