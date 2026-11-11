from fastapi import APIRouter

from src.services.agent.router import agent_router
from src.services.iam.auth.router import auth_router
from src.services.iam.user.router import user_router
from src.services.llm.router import llm_router

# [수정] 실행 기록 라우터 import 추가 [2026-11-11 11:50]
from src.services.run.router import run_router

# [수정] 워크플로우 라우터 import 추가 [2026-11-10 13:40]
from src.services.workflow.router import workflow_router

api_router = APIRouter()

# 각 라우터를 여기서 api_router에 등록한다
# api_router.include_router(라우터명)

# 인증/인가(Auth) 라우터
api_router.include_router(
    auth_router,
    prefix="/auth",
    tags=["인증인가(Auth)"],
)

# 사용자/계정(User) 라우터
api_router.include_router(
    user_router,
    prefix="/users",
    tags=["사용자(User)"],
)

# LLM 공급자·모델 라우터 등록
api_router.include_router(
    llm_router,
    prefix="/llm",
    tags=["LLM 공급자·모델(LLM)"],
)

# 에이전트(Agent) 라우터
api_router.include_router(
    agent_router,
    prefix="/agents",
    tags=["에이전트(Agent)"],
)

# [수정] * 워크플로우 라우터 등록 [2026-11-10 13:40]
# [기존] 인증, 사용자, LLM, 에이전트 라우터만 등록되어 있었습니다.
# [변경] 워크플로우 만들기·조회·수정(그래프 저장)·삭제 API(/workflows)를 추가로 등록합니다.
# 워크플로우(Workflow) 라우터
api_router.include_router(
    workflow_router,
    prefix="/workflows",
    tags=["워크플로우(Workflow)"],
)

# [수정] * 실행 기록 라우터 등록 [2026-11-11 11:50]
# [기존] 워크플로우 실행 기록을 조회하는 API가 없었습니다.
# [변경] 실행 기록 목록·상세, 모니터링 통계 API(/runs)를 등록합니다.
# 실행 기록(Run) 라우터
api_router.include_router(
    run_router,
    prefix="/runs",
    tags=["실행 기록(Run)"],
)
