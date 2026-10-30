# 함수 결과를 기억(캐시)해 두는 데코레이터(같은 호출이면 다시 계산하지 않음)
from functools import lru_cache

# 파일 경로를 다루기 위한 표준 라이브러리(.env에서 절대경로 계산용)
from pathlib import Path

from pydantic import Field, model_validator

# pydantic_settings: 환경 변수를 읽어 파이썬 객체로 자동 변환/검증해 주는 라이브러리
from pydantic_settings import BaseSettings, SettingsConfigDict

#  * .env 파일 위치를 "이 파일(config.py) 기준 절대경로"로 계산
#  - Path(__file__)            => backend/src/core/config.py
#  - .resolve().parents[2]     => 위로 3단계 올라간 폴더 = backend/
#    (parents[0]=core, parents[1]=src, parents[2]=backend)
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE_PATH = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    # 설정 동작 방식 지정:
    #  - case_sensitive=False: 환경 변수 이름의 대소문자를 구분하지 않음
    #  - extra="ignore": .env에 더 많은 변수가 있어도 에러 내지 말고 무시
    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_file=ENV_FILE_PATH,  # ".env" -> 절대경로(ENV_FILE_PATH)
        env_file_encoding="utf-8",
        extra="ignore",
        #  * 설정값 검사 에러 메시지에 .env의 값이 출력되지 않도록 설정 (보안)
        #  - 기존: 없음 => 필수값이 빠지면 에러 메시지에 .env에 적힌 다른 값들(비밀번호 등)까지
        #          함께 출력되어, 서버 로그나 화면에 비밀값이 남을 수 있었음
        #  - 변경: hide_input_in_errors=True => "어떤 설정이 잘못되었는지"만 출력하고 값은 숨김
        hide_input_in_errors=True,
    )

    # CORS 관련 (JSON 배열 형식)
    # CORS 허용 도메인 목록을 환경 변수로 관리
    # .env 작성 예시(JSON 배열 형식): CORS_ORIGINS=["http://localhost:3000","https://my-app.com"]
    # .env에 값이 없으면 아래 기본값(로컬 프론트엔드 개발 서버 주소)을 사용
    cors_origins: list[str] = ["http://localhost:3000"]

    # GOOGLE APP 관련
    my_google_email: str | None = None
    google_app_pw: str | None = None

    # JWT 관련
    jwt_algorithm: str = "HS256"  # 토큰 서명 알고리즘 (HS256: 비밀키 하나로 서명/검증)
    access_token_secret: str = Field(min_length=32)
    refresh_token_secret: str = Field(min_length=32)
    access_token_expire: int = 30  # 단위: 분
    refresh_token_expire: int = 1  # 단위: 일

    # DB 관련
    db_url: str
    db_echo: bool = False

    # Redis(Cloud) 관련
    redis_url: str = ""

    # S3(AWS) 관련
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_region: str | None = None
    aws_s3_bucket_name: str | None = None
    aws_s3_base_folder: str = "omnisense"  # 버킷 내 최상위 폴더 이름
    aws_s3_presigned_expire: int = 3600  # 화면 미리보기용 임시 주소 유효 시간 (단위: 초)

    # Vector DB(Qdrant) 관련
    vector_db_url: str  # Qdrant 접속 주소 (예: https://xxx.cloud.qdrant.io:6333) - 필수
    # API 키: Qdrant Cloud는 필수, API 키를 설정하지 않은 자체 운영 Qdrant는 비워둠(None)
    vector_db_api_key: str | None = None
    # 문서 청크(벡터)를 저장할 컬렉션 이름 (컬렉션: Qdrant에서 테이블 같은 개념)
    vector_db_collection: str = "omnisense"
    vector_db_timeout: int = 10  # Qdrant 요청 제한 시간 (단위: 초)

    # Embedding 관련
    # [수정] * 임베딩 서버 주소를 필수값 -> 선택값으로 변경 [2026-10-28 16:45]
    # [기존] embedding_base_url: str => .env에 값이 없으면 서버가 시작되지 않았습니다.
    # [변경] embedding_base_url: str | None = None => 값이 없어도 서버가 시작됩니다.
    #        (embedding.py 작업 시 다시 필수값으로 바꿀지 결정)
    embedding_base_url: str | None = None  # 임베딩 서버 주소 (/v1 까지)
    embedding_api_key: str | None = None
    embedding_model: str = "bge-m3"  # 임베딩 모델 이름 (임베딩 서버에 등록된 이름)
    embedding_dim: int = 1024
    embedding_batch_size: int = 32
    embedding_timeout: int = 60  # 임베딩 요청 제한 시간 (단위: 초, CPU는 느릴 수 있어 넉넉하게)

    #  * psycopg 드라이버용 DB 주소를 만들어 주는 속성(property)
    #  - 한 곳(여기)에 모아두고 database.py, env.py 모두 settings.async_db_url을 사용
    #  - @property: 함수지만 괄호 없이 settings.async_db_url 처럼 변수처럼 꺼내 쓸 수 있게 해줌
    @property
    def async_db_url(self) -> str:
        # Supabase가 주는 주소는 "postgresql://..." 형태
        # SQLAlchemy가 psycopg(3버전) 드라이버를 사용하려면 "postgresql+psycopg://..." 이어야 함
        if self.db_url.startswith("postgresql://"):
            return self.db_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.db_url


# @lru_cache를 붙였으므로 get_settings()는 처음 한 번만 Settings() 를 만들고,
# 그 뒤로는 같은 객체를 재사용(환경 변수를 매번 다시 읽지 않아 빠르고 일관적)
@lru_cache
def get_settings() -> Settings:
    return Settings()
