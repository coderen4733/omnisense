import base64
import hashlib  # 토큰을 SHA-256으로 해시(DB 저장용)
import os
import uuid  # 토큰마다 겹치지 않는 고유 번호(jti) 생성
from datetime import UTC, datetime, timedelta

import jwt  # PyJWT 라이브러리 (JWT 토큰 생성/검증)

# Fernet(양방향 암호화) - LLM API 키 암호화용
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from src.core.config import get_settings

# get_settings()를 호출하여 환경변수 객체 가져오기 (JWT 비밀키, 만료 시간 등)
settings = get_settings()

#  * LLM API 키 암호화/복호화 도구 추가
#  * DB에 저장할 LLM API 키를 암호화(양방향)하는 Fernet 도구를 추가합니다.
#  * 비밀번호와 API 키를 다르게 저장하는 이유
#  - 비밀번호: 원래 값을 다시 알 필요가 없음 => 해시(단방향, 되돌릴 수 없음)로 저장
#  - API 키  : LLM을 호출할 때 원래 값이 필요함 => 암호화(양방향, 비밀키로 되돌릴 수 있음)로 저장
#  - Fernet: cryptography 라이브러리가 제공하는 "안전하게 쓰기 쉬운" 암호화 방식 (AES + 위조 검사)
try:
    _fernet = Fernet(settings.llm_secret_key.encode("utf-8"))
except ValueError as err:
    # 키 형식이 틀리면 서버 시작 시점에 바로 알려줌 (에러 메시지에 키 값은 포함되지 않음)
    raise RuntimeError(
        "LLM_SECRET_KEY 형식이 올바르지 않습니다. "
        ".env.example의 생성 방법으로 새 키를 만들어 주세요."
    ) from err


# 저장된 API 키를 복호화하지 못했을 때 발생하는 에러
class SecretDecryptError(Exception):
    pass


# Scrypt 해싱 설정값 (권장 보안 표준 표준값)
SCRYPT_N = 16384  # CPU/Memory 비용 계수
SCRYPT_R = 8  # 블록 크기
SCRYPT_P = 1  # 병렬화 계수


# 비밀번호 해시 - Scrypt 알고리즘으로 해싱
def hash_password(password: str) -> str:
    # 1. 무작위 16바이트 솔트(Salt) 생성
    salt = os.urandom(16)
    # 2. Scrypt KDF 초기화
    kdf = Scrypt(salt=salt, length=32, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
    # 3. 해시값 계산 및 [Salt + Hash] 결합 후 문자열(base64)로 저장
    hashed_bytes = kdf.derive(password.encode("utf-8"))
    # DB 저장의 편의성을 위해 솔트와 해시값을 붙여서 문자열로 인코딩
    return base64.b64encode(salt + hashed_bytes).decode("utf-8")


# 평문과 해시된 비밀번호 일치 검증
def verify_password(plain_password: str, hashed_password_str: str) -> bool:
    try:
        # 1. base64 문자열을 바이트로 복원
        decoded_bytes = base64.b64decode(hashed_password_str.encode("utf-8"))
        # 2. 앞의 16바이트는 솔트, 뒤의 32바이트는 해시값
        salt = decoded_bytes[:16]
        stored_hash = decoded_bytes[16:]
        # 3. 검증용 Scrypt KDF 인스턴스 생성
        kdf = Scrypt(salt=salt, length=32, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
        # 4. 검증 실행 (불일치 시 InvalidKey 예외 발생)
        kdf.verify(plain_password.encode("utf-8"), stored_hash)
        return True
    except Exception:
        return False


# 가짜 비밀번호 트릭 : 서버 시작 시 한 번만 계산해 두고 재사용함
# 로그인 시 "존재하지 않는 email"일 때 사용할 가짜 비밀번호 해시
DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-timing-attack")


# JWT 토큰 생성 공통 함수
# 앞에 _(언더바)가 붙은 함수: "이 파일 안에서만 쓰는 함수"라는 파이썬의 관례
def _create_token(
    user_id: int,
    token_type: str,
    secret: str,
    expires_delta: timedelta,
) -> tuple[str, datetime]:
    # 1. 만료 시각 계산
    now = datetime.now(UTC)
    expires_at = now + expires_delta
    # 2. 토큰에 담을 정보(payload)
    payload = {
        "sub": str(user_id),  # JWT 표준 규칙상 sub는 반드시 문자열로
        "type": token_type,  # 토큰 종류 ("access" 또는 "refresh")
        "iat": now,  # 발급 시각 (issued at)
        "exp": expires_at,  # 만료 시각 (expiration)
        "jti": uuid.uuid4().hex,  # 같은 시각에 2번 로그인하면 똑같은 토큰 생성되는 것 방지용
    }
    # 3. 토큰 생성 (비밀키로 서명)
    token = jwt.encode(payload, secret, algorithm=settings.jwt_algorithm)
    return token, expires_at


# 액세스 토큰 생성 함수
def create_access_token(user_id: int) -> str:
    token, _ = _create_token(
        user_id,
        token_type="access",
        secret=settings.access_token_secret,
        expires_delta=timedelta(minutes=settings.access_token_expire),  # 기본값: 30분
    )
    return token


# 리프레시 토큰 생성 함수
# 토큰과 함께 만료 시각도 돌려줌 => DB의 expires_at에 "토큰과 똑같은 만료 시각"을 저장하기 위함
def create_refresh_token(user_id: int) -> tuple[str, datetime]:
    return _create_token(
        user_id,
        token_type="refresh",
        secret=settings.refresh_token_secret,
        expires_delta=timedelta(days=settings.refresh_token_expire),  # 기본값: 1일
    )


# JWT 토큰 검증(디코드) 함수
# 토큰이 "우리 서버가 서명한 토큰인지", "만료되지 않았는지", "종류가 맞는지" 검사
# 검증에 실패하면 jwt.PyJWTError(또는 그 하위 에러)가 발생하므로, 사용하는 쪽에서 처리해야 함
def decode_token(token: str, token_type: str) -> dict:
    # 1. 토큰 종류에 맞는 비밀키 선택
    if token_type == "access":
        secret = settings.access_token_secret
    else:
        secret = settings.refresh_token_secret
    # 2. 서명 + 만료 시각 검증 (만료되었으면 ExpiredSignatureError 발생)
    #  - require: 이 항목들이 토큰에 없으면 에러 발생
    payload = jwt.decode(
        token,
        secret,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "type", "exp"]},
    )
    # 3. 토큰 종류 검사 (예: 리프레시 토큰 자리에 액세스 토큰을 넣은 경우 거절)
    if payload["type"] != token_type:
        raise jwt.InvalidTokenError("토큰 종류가 올바르지 않습니다.")
    return payload


#  * 비밀값 암호화 함수 추가
#  * 평문(예: API 키) => 암호문(DB 저장용 문자열)으로 바꿈
#  - 같은 평문이라도 암호화할 때마다 결과가 달라짐 (암호문만 보고 같은 키인지 알 수 없음)
def encrypt_secret(plain_text: str) -> str:
    return _fernet.encrypt(plain_text.encode("utf-8")).decode("utf-8")


#  * 비밀값 복호화 함수 추가
#  * 암호문(DB에 저장된 문자열) => 평문(예: API 키)으로 되돌림
#  - LLM_SECRET_KEY가 암호화할 때와 다르면 InvalidToken 에러 => SecretDecryptError로 바꿔서 던짐
def decrypt_secret(encrypted_text: str) -> str:
    try:
        return _fernet.decrypt(encrypted_text.encode("utf-8")).decode("utf-8")
    except InvalidToken as err:
        raise SecretDecryptError(
            "저장된 API 키를 복호화할 수 없습니다. "
            "LLM_SECRET_KEY가 바뀌었다면 공급자의 API 키를 다시 입력해 주세요."
        ) from err


# 토큰 해시 함수 (리프레시 토큰을 DB에 저장할 때 사용)
# 비밀번호는 Scrypt(일부러 느린 해시)를 쓰지만, 토큰은 이미 충분히 길고 랜덤하므로
# 빠른 SHA-256으로도 안전함 (결과는 항상 64자리 문자열)
def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
