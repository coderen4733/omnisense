from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from src.core.llm import ReasoningEffort

# ============================================================
# 1. 에이전트 (Agent)
# ============================================================


# 에이전트 등록(C) - 요청(Req)
class AgentCreateReq(BaseModel):
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="에이전트 이름 (예: 사내 계산 도우미)",
    )
    description: str | None = Field(
        default=None,
        max_length=500,
        description="에이전트 설명",
    )
    llm_model_id: int = Field(
        ...,
        description="사용할 LLM 모델 번호 (llm_models 테이블의 id)",
    )
    system_prompt: str = Field(
        default="",
        max_length=20000,
        description="시스템 프롬프트 (에이전트의 역할, 말투, 규칙)",
    )
    # 생성 옵션: 보내지 않으면(None) 공급자 서버의 기본값 사용
    #  (범위는 llm/schemas.py 의 ChatReq와 동일)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=32768)
    top_p: float | None = Field(default=None, gt=0, le=1)
    # * 생각 과정 수준 추가
    # - none/low/medium/high 중 하나를 받음 (보내지 않으면 모델 기본값)
    reasoning_effort: ReasoningEffort | None = Field(
        default=None,
        description="생각 과정 수준 (none: 끄기 / low / medium / high, OpenAI 호환 공급자만 적용)",
    )
    max_iterations: int = Field(
        default=5,
        ge=1,
        le=20,
        description="도구 호출 최대 반복 횟수 (1~20)",
    )
    tool_names: list[str] = Field(
        default_factory=list,
        max_length=20,
        description="연결할 도구 이름 목록 (GET /agents/tools 참고)",
    )


#  * 에이전트 수정(U) - 요청(Req)
#  - "보낸 값만" 바꿈 (보내지 않은 항목은 그대로)
#  - 다른 수정 API와 다른 점: temperature 처럼 비워둘 수 있는 값은 null을 보내면 "비움"으로 처리
#    => None(null)이 "보내지 않음"인지 "비우기"인지 구분하기 위해,
#       service.py 에서 dto.model_fields_set(실제로 보낸 항목 이름 목록)을 확인함
class AgentUpdateReq(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    llm_model_id: int | None = None
    system_prompt: str | None = Field(default=None, max_length=20000)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=32768)
    top_p: float | None = Field(default=None, gt=0, le=1)
    reasoning_effort: ReasoningEffort | None = None  # 생각 과정 수준
    max_iterations: int | None = Field(default=None, ge=1, le=20)
    tool_names: list[str] | None = Field(default=None, max_length=20)
    is_active: bool | None = None


#  * 에이전트에 연결된 LLM 모델 정보 - 응답(Res)
#  - is_usable: 모델과 공급자가 모두 "사용" 상태인지 (False면 에이전트를 실행할 수 없음)
#  * 공급자 연결 방식, 생각 과정 지원 여부
#  - 화면에서 생각 과정 설정이 적용되는 모델인지 판단할 수 있도록 두 값을 추가
class AgentModelRes(BaseModel):
    id: int
    display_name: str
    model_id: str  # 공급자 서버의 모델 이름 (예: qwen3.5:9b)
    provider_name: str
    provider_type: str  # openai_compatible / bedrock
    supports_tools: bool
    supports_reasoning: bool
    is_usable: bool


#  * 에이전트 - 응답(Res)
#  - llm_model: 연결된 모델이 삭제된 경우 None (화면에서 모델을 다시 선택해야 함)
#  - created_by_email: 만든 사용자 이메일 (사용자가 삭제된 경우 None)
class AgentRes(BaseModel):
    id: int
    name: str
    description: str | None
    llm_model: AgentModelRes | None
    system_prompt: str
    temperature: float | None
    max_tokens: int | None
    top_p: float | None
    reasoning_effort: str | None  # 생각 과정 수준
    max_iterations: int
    tool_names: list[str]
    is_active: bool
    created_by_email: str | None
    created_at: datetime
    updated_at: datetime


# 삭제(D) - 응답(Res)
class DeleteRes(BaseModel):
    success: bool = True


# ============================================================
# 2. 도구 (Tool)
# ============================================================


# 에이전트에 연결할 수 있는 도구 - 응답(Res)
class ToolRes(BaseModel):
    name: str  # 도구 이름 (에이전트에 저장되는 값, 예: calculator)
    label: str  # 화면에 보여줄 이름 (예: 계산기)
    description: str  # 화면에 보여줄 설명


# ============================================================
# 3. 에이전트 실행 (Run) - 스트리밍
# ============================================================


#  * 대화 메시지 1개 - 요청
#  - system(시스템 프롬프트)은 에이전트에 저장된 값을 사용하므로 받지 않음
class AgentMessageReq(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=20000)


#  * 에이전트 실행 - 요청(Req)
#  - messages: 지금까지의 대화 전체 (마지막은 사용자 질문이어야 함)
#    모델은 대화를 기억하지 못하므로 매번 전부 보내야 함
class AgentRunReq(BaseModel):
    messages: list[AgentMessageReq] = Field(..., min_length=1, max_length=100)
