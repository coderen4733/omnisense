#  * 워크플로우 실행 기록 저장
#  - workflow_runner.py 가 만드는 이벤트를 화면으로 그대로 보내면서, 같은 내용을 DB에 기록함
#    (실행 엔진은 DB를 모르고, 기록은 이 파일이 맡음 => 실행 엔진은 지금처럼 단순하게 유지)
#  - 실행 기록 1건(workflow_runs)은 실행을 시작하기 전에 workflow/service.py 의 prepare_run 이
#    "실행 중(running)" 상태로 미리 만들어 둠 => 이 파일은 노드 기록을 추가하고 마지막 상태를 채움
#
# 📌 저장 시점
#  - 노드 하나가 끝날 때마다(node_done) 그 노드의 기록을 저장
#    => 실행 도중 서버가 꺼져도 그때까지 끝난 노드의 기록은 남음
#  - 실행이 끝나면(done / error / 중지) 실행 기록의 상태, 결과, 걸린 시간, 토큰 합계를 채움
#
# 📌 사용자가 중지하거나 창을 닫은 경우 (연결 끊김)
#  - 서버는 실행을 "취소"하는데, 취소된 작업 안에서는 DB 저장도 함께 취소되어 버림
#  - anyio.CancelScope(shield=True): 그 안의 코드는 취소되지 않도록 "보호막"을 씌움
#    => 중지된 경우에도 "중지(stopped)" 상태와 실행 중이던 노드 기록을 저장할 수 있음
#
# 📌 기록 저장에 실패해도(DB 연결 오류 등) 실행은 계속함
#  - 기록은 부가 기능이므로, 저장 실패 때문에 사용자의 실행이 멈추지 않도록 서버 로그만 남김
#
# 📌 프론트엔드로 보내는 이벤트
#  - 맨 처음에 {"type": "run_start", "run_id": 12} 를 하나 더 보냄
#    (화면에서 실행 기록 상세로 이동할 때 사용)
#  - 나머지는 workflow_runner.py 맨 위 설명과 같음

import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from datetime import UTC, datetime
from typing import Any

import anyio  # FastAPI가 내부에서 쓰는 비동기 도구 (취소 보호막 CancelScope 에 사용)

from src.core.database import async_session_factory
from src.services.orchestration import workflow_runner
from src.services.orchestration.workflow_runner import PreparedWorkflowRun
from src.services.run import repository as run_repository
from src.services.run.models import WorkflowRunStep

logger = logging.getLogger(__name__)

#  * 기록에 남기는 글 1개의 최대 글자 수
#  - 생각 과정이나 도구 결과가 아주 길면 DB 용량이 커지므로 뒷부분을 자름
MAX_PART_CHARS = 20_000


# SSE(Server-Sent Events) 형식 한 덩어리 만들기 => "data: {JSON}\n\n"
def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# 글이 너무 길면 뒷부분을 자르고 잘렸다는 표시를 붙임
def _clip(text: str) -> str:
    if len(text) <= MAX_PART_CHARS:
        return text
    return f"{text[:MAX_PART_CHARS]}\n... (기록에는 {MAX_PART_CHARS:,}자까지만 저장)"


#  * 에이전트 진행 상황 이벤트 1개를 조각 목록(parts)에 반영
#  - 화면의 components/agent/RunParts.tsx 의 applyRunEvent 와 같은 규칙, 같은 모양으로 저장
#    => 기록 상세 화면에서 실행 패널과 같은 부품으로 그대로 보여줄 수 있음
#    (그래서 도구 결과의 이름은 화면과 같이 isError, durationMs 로 저장함)
#  - 생각 과정/답변 글: 마지막 조각과 같은 종류면 이어 붙이고, 다르면 새 조각 추가
#  - 도구 실행 결과: 같은 id의 도구 조각을 찾아 결과를 채움
def _apply_part(parts: list[dict[str, Any]], event: dict[str, Any]) -> None:
    kind = event["type"]
    if kind in ("reasoning", "content"):
        if parts and parts[-1]["kind"] == kind:
            parts[-1]["text"] += event["text"]
        else:
            parts.append({"kind": kind, "text": event["text"]})
    elif kind == "tool_call":
        parts.append(
            {
                "kind": "tool",
                "id": event["id"],
                "name": event["name"],
                "arguments": event["arguments"],
            }
        )
    elif kind == "tool_result":
        for part in parts:
            if part["kind"] == "tool" and part["id"] == event["id"]:
                part["result"] = {
                    "text": event["result"],
                    "isError": event["is_error"],
                    "durationMs": event["duration_ms"],
                }


# 저장 직전에 긴 글 자르기 (생각 과정, 답변 글, 도구 결과)
def _clip_parts(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    clipped: list[dict[str, Any]] = []
    for part in parts:
        copied = dict(part)
        if "text" in copied:
            copied["text"] = _clip(copied["text"])
        if "result" in copied:
            copied["result"] = {**copied["result"], "text": _clip(copied["result"]["text"])}
        clipped.append(copied)
    return clipped


class _RunLog:
    """실행 1번의 기록을 모으고 DB에 저장하는 도우미 (이 파일 안에서만 사용)

    - current: 지금 실행 중인 노드의 기록 (아직 저장 전)
    - final: 실행 기록에 마지막으로 채울 값 (끝나지 않았으면 None => 중지로 처리)
    """

    def __init__(self, run_id: int, prepared: PreparedWorkflowRun) -> None:
        self.run_id = run_id
        self.prepared = prepared
        self.started = time.perf_counter()
        self.seq = 0  # 지금까지 시작한 노드 수 (노드 기록의 실행 순서)
        self.current: dict[str, Any] | None = None
        self.final: dict[str, Any] | None = None
        self.input_tokens = 0  # 끝난 에이전트 노드의 토큰 합계 (실패, 중지했을 때 사용)
        self.output_tokens = 0

    #  * 이벤트 1개 반영 (저장이 필요한 시점이면 DB에 저장)
    async def apply(self, event: dict[str, Any]) -> None:
        kind = event["type"]
        if kind == "node_start":
            self.seq += 1
            agent_run = self.prepared.agent_runs.get(event["node_id"])
            self.current = {
                "seq": self.seq,
                "node_id": event["node_id"],
                "node_type": event["node_type"],
                "label": event["label"],
                "parts": [],
                "model_name": agent_run.model_name if agent_run else None,
                "started_at": datetime.now(UTC),
                "perf": time.perf_counter(),
            }
        elif kind in ("reasoning", "content", "tool_call", "tool_result"):
            if self.current:
                _apply_part(self.current["parts"], event)
        elif kind == "node_done":
            # 노드 종류별 결과 = 이벤트에서 공통 값(type, node_id, node_type, duration_ms)을
            # 뺀 나머지
            result = {
                key: value
                for key, value in event.items()
                if key not in ("type", "node_id", "node_type", "duration_ms")
            }
            self.input_tokens += result.get("input_tokens", 0)
            self.output_tokens += result.get("output_tokens", 0)
            await self._save_step("done", result=result, duration_ms=event["duration_ms"])
        elif kind == "done":
            self.final = {
                "status": "succeeded",
                "output": event["output"],
                "input_tokens": event["input_tokens"],
                "output_tokens": event["output_tokens"],
                "latency_ms": event["latency_ms"],
            }
        elif kind == "error":
            await self._save_step("error", error=event["message"])
            self.final = {
                "status": "failed",
                "error": event["message"],
                "error_node_id": event["node_id"],
            }

    #  * 실행 중이던 노드의 기록 저장 (저장할 노드가 없으면 아무것도 안 함)
    async def _save_step(
        self,
        status: str,
        *,
        result: dict[str, Any] | None = None,
        duration_ms: int | None = None,
        error: str | None = None,
    ) -> None:
        current, self.current = self.current, None
        if current is None:
            return
        if duration_ms is None:
            duration_ms = int((time.perf_counter() - current["perf"]) * 1000)
        step = WorkflowRunStep(
            run_id=self.run_id,
            seq=current["seq"],
            node_id=current["node_id"],
            node_type=current["node_type"],
            label=current["label"],
            status=status,
            result=result,
            parts=_clip_parts(current["parts"]),
            error=error,
            model_name=current["model_name"],
            input_tokens=(result or {}).get("input_tokens", 0),
            output_tokens=(result or {}).get("output_tokens", 0),
            duration_ms=duration_ms,
            started_at=current["started_at"],
        )
        try:
            async with async_session_factory() as session:
                await run_repository.add_step(session, step)
                await session.commit()
        except Exception:
            logger.exception("실행 기록(노드)을 저장하지 못했습니다. (run_id=%s)", self.run_id)

    #  * 실행 기록 마무리 (상태, 결과, 걸린 시간, 토큰 합계)
    #  - final 이 없음 = done/error 없이 끝남 = 사용자가 중지(연결 끊김)
    #    => 실행 중이던 노드를 "중지"로 저장하고, 실행 기록도 "중지"로
    async def finish(self) -> None:
        if self.final is None:
            await self._save_step("stopped")
            self.final = {"status": "stopped"}
        values = {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "latency_ms": int((time.perf_counter() - self.started) * 1000),
            **self.final,
            "finished_at": datetime.now(UTC),
        }
        try:
            async with async_session_factory() as session:
                await run_repository.finish_run(session, self.run_id, values)
                await session.commit()
        except Exception:
            logger.exception("실행 기록을 마무리하지 못했습니다. (run_id=%s)", self.run_id)


#  * 워크플로우 실행 + 기록 저장 => 진행 상황을 SSE 형식으로 하나씩 돌려줌
#  - 라우터의 StreamingResponse 가 사용 (workflow/router.py 의 run_workflow)
#  - run_id: prepare_run 이 미리 만들어 둔 실행 기록 번호
async def stream_recorded_events(
    prepared: PreparedWorkflowRun, run_id: int
) -> AsyncIterator[str]:
    log = _RunLog(run_id, prepared)
    try:
        yield _sse({"type": "run_start", "run_id": run_id})
        async with aclosing(workflow_runner.run_workflow_events(prepared)) as events:
            async for event in events:
                await log.apply(event)
                yield _sse(event)
    finally:
        # 정상 종료, 오류, 중지(취소) 모두 여기서 마무리 - 취소되지 않도록 보호막 안에서 저장
        with anyio.CancelScope(shield=True):
            await log.finish()
