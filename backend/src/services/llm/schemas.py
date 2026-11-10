from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from src.core.llm import LLMProviderType

# ============================================================
# 1. LLM 공급자 (Provider)
# ============================================================


# LLM 공급자 등록(C) - 요청(Req)
class ProviderCreateReq(BaseModel):
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="공급자 이름 (예: 로컬 Ollama)",
    )
    provider_type: LLMProviderType = Field(
        default=LLMProviderType.OPENAI_COMPATIBLE,
        description="연결 방식 (openai_compatible: Ollama·vLLM / bedrock: AWS Bedrock)",
    )
    base_url: str | None = Field(
        default=None,
        max_length=500,
        description="서버 주소, openai_compatible은 필수 (예: http://localhost:11434/v1)",
    )
    region: str | None = Field(
        default=None,
        max_length=50,
        description="AWS 리전, bedrock은 필수 (예: us-east-1)",
    )
    api_key: str | None = Field(
        default=None,
        max_length=4000,
        description="API 키 (bedrock은 필수, Ollama는 비워둠) - 암호화되어 저장됨",
    )


#  * LLM 공급자 수정(U) - 요청(Req)
#  - 보내지 않은 값(None)은 바꾸지 않음
#  - 연결 방식(provider_type)은 바꿀 수 없음 (등록된 모델 ID가 연결 방식마다 다르기 때문)
#  - API 키: api_key를 보내면 새 키로 교체 / clear_api_key=true면 저장된 키 삭제
class ProviderUpdateReq(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    base_url: str | None = Field(default=None, max_length=500)
    region: str | None = Field(default=None, max_length=50)
    api_key: str | None = Field(
        default=None,
        max_length=4000,
        description="새 API 키 (보내지 않으면 기존 키 유지)",
    )
    clear_api_key: bool = Field(
        default=False,
        description="true면 저장된 API 키를 삭제",
    )
    is_active: bool | None = Field(default=None, description="사용 여부")


# LLM 모델 - 응답(Res)
class ModelRes(BaseModel):
    # from_attributes=True: SQLAlchemy 객체를 Pydantic이 자동으로 변환할 수 있도록 설정
    model_config = ConfigDict(from_attributes=True)

    id: int  # 이 테이블의 번호 (테스트 대화 등에서 모델을 고를 때 사용)
    provider_id: int
    model_id: str  # 공급자 서버의 모델 이름 (예: qwen3.5:9b)
    display_name: str
    supports_tools: bool
    supports_reasoning: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


#  * LLM 공급자 - 응답(Res)
#  - API 키는 절대 응답에 넣지 않고, "등록되어 있는지(has_api_key)"만 알려줌
#  - models: 이 공급자에 등록된 모델 목록 (화면에서 공급자별로 묶어서 보여주기 위함)
class ProviderRes(BaseModel):
    id: int
    name: str
    provider_type: str
    base_url: str | None
    region: str | None
    has_api_key: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    models: list[ModelRes]


# 공급자 서버에 설치된 모델 목록 - 응답(Res) (모델 등록 화면의 "불러오기")
class AvailableModelsRes(BaseModel):
    model_ids: list[str]


# ============================================================
# 2. LLM 모델 (Model)
# ============================================================


# LLM 모델 등록(C) - 요청(Req)
class ModelCreateReq(BaseModel):
    model_id: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="공급자 서버의 모델 이름 (예: qwen3.5:9b)",
    )
    display_name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="화면에 보여줄 이름 (예: Qwen 3.5 9B)",
    )
    supports_tools: bool = Field(default=False, description="도구 호출 지원 여부")
    supports_reasoning: bool = Field(default=False, description="생각 과정 출력 여부")


#  * LLM 모델 수정(U) - 요청(Req)
#  - 보내지 않은 값(None)은 바꾸지 않음
#  - 모델 ID는 바꿀 수 없음 (다른 모델을 쓰려면 새로 등록)
class ModelUpdateReq(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    supports_tools: bool | None = None
    supports_reasoning: bool | None = None
    is_active: bool | None = None


#  * LLM 모델 연결 테스트 - 응답(Res)
#  - 연결에 실패해도 에러(4xx/5xx)가 아니라 success=false로 응답
#    => 화면에서 모델 옆에 "실패 사유"를 바로 보여주기 위함
class ModelTestRes(BaseModel):
    success: bool
    latency_ms: int | None  # 첫 응답이 올 때까지 걸린 시간 (밀리초, 실패 시 None)
    message: str


# 삭제(D) - 응답(Res)
class DeleteRes(BaseModel):
    success: bool = True


# ============================================================
# 3. 테스트 대화 (Chat)
# ============================================================


#  * 대화 메시지 1개 - 요청
#  - tool(도구 실행 결과) 역할은 테스트 대화에서 사용하지 않으므로 받지 않음
class ChatMessageReq(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., max_length=20000)


#  * 테스트 대화 - 요청(Req)
#  - llm_model_id: llm_models 테이블의 번호(id) (모델 이름인 model_id와 다름!)
#  - messages: 지금까지의 대화 전체 (모델은 대화를 기억하지 못하므로 매번 전부 보내야 함)
#  - temperature, max_tokens, top_p: 보내지 않으면 공급자 서버의 기본값 사용
class ChatReq(BaseModel):
    llm_model_id: int
    messages: list[ChatMessageReq] = Field(..., min_length=1, max_length=100)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=32768)
    top_p: float | None = Field(default=None, gt=0, le=1)
