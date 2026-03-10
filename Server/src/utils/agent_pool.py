"""
Agent pool — 5 asyncio worker tasks backed by Redis as a task queue.

Architecture:
  - On server startup, AgentPool.start() spawns AGENT_WORKER_COUNT asyncio tasks.
  - AgentPool.enqueue(api_key, message, tool_definitions) pushes a task onto the
    Redis list "agent:tasks" and waits (via pub/sub) for the worker to finish.
  - Each worker loops on BRPOP from "agent:tasks", calls agent_runner.run_session(),
    writes the result JSON to "agent:result:{task_id}" (EX 120 s), and publishes
    a notification on "agent:done:{task_id}".
  - The HTTP handler is unblocked by the pub/sub message and reads the result.

All workers are coroutines in the same asyncio event loop, so they share the
_sessions dict inside agent_runner without any inter-process locking.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import asdict
from typing import Any

import redis.asyncio as aioredis

from config import settings
from utils.agent_runner import AgentResponse, ToolCallRecord, ToolDefinition, run_session

logger = logging.getLogger(__name__)

_QUEUE_KEY = "agent:tasks"
_RESULT_PREFIX = "agent:result:"
_DONE_CHANNEL_PREFIX = "agent:done:"


class AgentPool:
    """Manages the pool of agent worker tasks and the Redis queuing layer."""

    def __init__(self) -> None:
        self._redis: aioredis.Redis | None = None
        self._workers: list[asyncio.Task] = []

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self, n: int = settings.AGENT_WORKER_COUNT) -> None:
        self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        # Verify connectivity
        await self._redis.ping()
        logger.info("Redis connected at %s", settings.REDIS_URL)

        for i in range(n):
            task = asyncio.create_task(self._worker(i + 1), name=f"agent-worker-{i+1}")
            self._workers.append(task)

        logger.info("Agent pool started with %d workers", n)

    async def shutdown(self) -> None:
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()
        if self._redis:
            await self._redis.aclose()
            self._redis = None
        logger.info("Agent pool shut down")

    # ------------------------------------------------------------------
    # Public API — called from HTTP handlers
    # ------------------------------------------------------------------

    async def enqueue(
        self,
        api_key: str,
        message: str,
        tool_definitions: list[ToolDefinition] | None = None,
    ) -> AgentResponse:
        """
        Push a chat task and block until a worker finishes.
        Raises asyncio.TimeoutError if no result arrives within AGENT_TASK_TIMEOUT.
        """
        if self._redis is None:
            raise RuntimeError("AgentPool has not been started")

        task_id = str(uuid.uuid4())
        done_channel = f"{_DONE_CHANNEL_PREFIX}{task_id}"

        payload = json.dumps({
            "task_id": task_id,
            "api_key": api_key,
            "message": message,
            "tool_definitions": [td.model_dump() for td in (tool_definitions or [])],
        })

        # Subscribe BEFORE pushing so we never miss the publish
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(done_channel)

        try:
            await self._redis.lpush(_QUEUE_KEY, payload)

            async def _wait_for_result() -> str:
                async for msg in pubsub.listen():
                    if msg["type"] == "message":
                        return msg["data"]
                return ""

            await asyncio.wait_for(
                _wait_for_result(),
                timeout=settings.AGENT_TASK_TIMEOUT,
            )
        finally:
            await pubsub.unsubscribe(done_channel)
            await pubsub.aclose()

        result_json = await self._redis.getdel(f"{_RESULT_PREFIX}{task_id}")
        if not result_json:
            raise RuntimeError(f"Worker finished task {task_id} but result was missing from Redis")

        return _deserialize_response(json.loads(result_json))

    # ------------------------------------------------------------------
    # Worker loop
    # ------------------------------------------------------------------

    async def _worker(self, worker_id: int) -> None:
        """Long-running coroutine: pulls tasks from Redis and runs the agent."""
        redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        logger.info("Worker %d ready", worker_id)
        try:
            while True:
                try:
                    # BRPOP blocks up to 1 s so the task can be cancelled cleanly
                    item = await redis.brpop(_QUEUE_KEY, timeout=1)
                    if item is None:
                        continue

                    _, raw = item
                    data: dict[str, Any] = json.loads(raw)
                    task_id: str = data["task_id"]
                    api_key: str = data["api_key"]
                    message: str = data["message"]
                    tool_defs = [
                        ToolDefinition(**td) for td in data.get("tool_definitions", [])
                    ]

                    logger.info("Worker %d processing task %s for ...%s", worker_id, task_id, api_key[-6:])

                    try:
                        response: AgentResponse = await run_session(api_key, message, tool_defs)
                    except Exception as exc:
                        logger.exception("Worker %d: agent error for task %s", worker_id, task_id)
                        response = AgentResponse(
                            response=f"[Agent error] {exc}",
                            tool_calls=[],
                        )

                    result_json = json.dumps(_serialize_response(response))
                    result_key = f"{_RESULT_PREFIX}{task_id}"
                    done_channel = f"{_DONE_CHANNEL_PREFIX}{task_id}"

                    await redis.set(result_key, result_json, ex=120)
                    await redis.publish(done_channel, "1")
                    logger.info("Worker %d finished task %s", worker_id, task_id)

                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.error("Worker %d unexpected error: %s", worker_id, exc)
                    await asyncio.sleep(1)
        finally:
            await redis.aclose()
            logger.info("Worker %d stopped", worker_id)


# ------------------------------------------------------------------
# Serialisation helpers
# ------------------------------------------------------------------

def _serialize_response(r: AgentResponse) -> dict:
    return {
        "response": r.response,
        "tool_calls": [
            {"tool_name": tc.tool_name, "input": tc.input, "output": tc.output}
            for tc in r.tool_calls
        ],
    }


def _deserialize_response(d: dict) -> AgentResponse:
    return AgentResponse(
        response=d["response"],
        tool_calls=[
            ToolCallRecord(
                tool_name=tc["tool_name"],
                input=tc["input"],
                output=tc["output"],
            )
            for tc in d.get("tool_calls", [])
        ],
    )
