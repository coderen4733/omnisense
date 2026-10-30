from fastapi import APIRouter

from src.services.iam.auth.router import auth_router
from src.services.iam.user.router import user_router

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
