# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

- 이 프로젝트 참여자는 모두 한국인이기 때문에 md파일이나 주석은 모두 한국어로 작성해야 합니다.
- 참여한 개발자는 모두 초급 개발자이기 때문에 코드마다 주석을 달아서 쉽게 설명해주어야 합니다.
- 주석은 현재 작성된 코드에 달려있는 주석들을 참고하여, 기존 주석과 똑같은 방식과 형식으로 일관되게 작성하여야 합니다.


## 1. 프로젝트 개요
- **라이브러리 관리**: uv
- **라이브러리 사용**: fastapi, uvicorn[standard], httpx, pydantic[email], pydantic-settings, sqlalchemy, alembic, psycopg[binary], celery[redis], prometheus-client, grafana, pyjwt, cryptography, qdrant-client, python-multipart, ruff(개발용) 등 추가/삭제될 때마다 기록 수정 예정
- **프로젝트 목적**: AI Agent 오케스트레이션 웹앱 구축
- **프로젝트 목표 기능**: 원하는 업무 기능을 가진 AI Agent를 드래그 앤 드롭 만으로 워크플로우 연결을 통해 간단하게 생성할 수 있고 관리할 수 있음. 다양한 LLM을 지원하며, 여러 도구들을 MCP를 통해 AI Agent가 활용할 수 있게 만들어 줍니다.

## 2. 백엔드 개발
백엔드 개발 시에는 `backend/` 디렉토리에서 진행합니다. (uv 프로젝트 루트)
- **의존성 설치**: `uv sync`
- **패키지 추가**: `uv add <패키지명>` (개발 도구는 `uv add --dev <패키지명>`)

## 3. 프론트엔드 개발
프론트엔드 개발 시에는 `frontend/` 디렉토리에서 진행합니다. (React + TypeScript + Vite, 라우팅 react-router-dom, 아이콘 lucide-react, 폰트 pretendard)
- **환경 변수**: `frontend/.env`의 `VITE_API_BASE_URL`(백엔드 주소)을 사용하며, 항목은 `frontend/.env.example` 참고
- **의존성 설치**: `npm install`
- **개발 서버 실행**: `npm run dev` → http://localhost:3000 (백엔드 서버가 먼저 켜져 있어야 함)
- **타입 검사 + 빌드**: `npm run build` (결과물: `frontend/dist/`)
- **폐쇄망 대비**: 폰트, 아이콘 등 외부 CDN을 사용하지 않고 npm 패키지로 설치하여 빌드 결과에 포함시킴


## 4. 규칙
- **환경 변수 관리**: 데이터베이스 URL이나 AWS 관련 비밀키는 절대 코드에 하드코딩하지 말고, `src/core/config.py`를 통해 `.env`에서 안전하게 로드하여 사용해야 합니다.
- **환경 변수 추가**: `src/core/config.py`에 필드를 추가하고 `backend/.env.example`에도 항목을 추가해야 함
- **설정**: `backend/src/core/config.py`가 `.env`의 모든 환경변수를 로드하도록 해야 함.
- **린트**: `pyproject.toml`의 `[tool.ruff]` 설정에 따라 `line-length = 100`, `select = ["E", "F", "I", "UP", "B"]` (pycodestyle, pyflakes, isort)를 준수합니다. 백엔드 작업을 마치기 전 `uv run ruff check .`를 실행하세요.

## 5. 고객사 환경 대비
- **외부 시스템 연동 (폐쇄망 납품 대비)**:
  - 모든 외부 연결 정보(주소, API 키, 모델 이름, 벡터 차원 등)는 코드에 적지 말고 `src/core/config.py`의 환경 변수로 받아야 합니다. 환경 변수만 바꾸면 클라우드/고객사 환경을 전환할 수 있어야 합니다.
  - Vector DB, 임베딩, LLM을 호출하는 코드는 각각 `src/core/` 아래 한 파일에만 둡니다. 다른 제품으로 교체할 때 그 파일만 수정하면 되도록 하기 위함입니다.
  - 앱이 실행 중에 인터넷(모델 자동 다운로드, 외부 CDN 등)에 의존하지 않도록 해야 합니다.

## 6. 주석
- **코드 수정**: 클로드가 코드를 수정한 경우 맨 윗줄에 `[수정] 날짜 시간`를 꼭 표기하고, 그 아래에 `기존`과 `변경` 후가 어떻게 다른지 각각 설명해 주어야 한다. 
주석 예시: 
[수정] * 금액 계산 적용 공식 변경 [2026-10-28 15:19]
[기존] Money = A + B 공식을 적용하여 금액을 계산하였습니다. 
[변경] Money = A + B + C 로 변경된 공식을 적용하여 금액을 계산합니다.
- **수정 확인 후**: 개발자가 클로드의 수정 내용을 모두 확인한 경우, `[수정]` 표시를 지워서 수정된 내용을 확인했음을 표시한다. 수정사항을 확인한 개발자는 [수정], [기존], [변경]에 적힌 내용들을 남겨둘 것인지 지울 것인지 적절하게 수정할 것인지 알아서 판단할 것이다.
