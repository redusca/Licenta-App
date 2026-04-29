"""
Agent runner — manages per-user ReAct agents backed by Gemini.

Each user's session is keyed by their api_key. Sessions live in an in-process
dict shared across all 5 asyncio worker tasks (no inter-process communication
needed because workers are coroutines in the same event loop).

Tool flow (identical to the Container's runner):
  APP → POST /api/agent/chat  (X-API-Key)
  worker → run_session(api_key, message)
  LLM calls tool → callback_url POST to the APP
  APP executes tool, returns result
  LLM produces final response
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.prebuilt import create_react_agent
from pydantic import BaseModel

from config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tool types (mirrors Container/src/agent/tools/base.py)
# ---------------------------------------------------------------------------

class ToolDefinition(BaseModel):
    """Schema the APP sends alongside a chat message to register tools."""
    name: str
    description: str
    parameters: dict[str, Any] = {}
    callback_url: str = ""


# ---------------------------------------------------------------------------
# Internal data structures
# ---------------------------------------------------------------------------

@dataclass
class ToolCallRecord:
    tool_name: str
    input: dict[str, Any]
    output: str


@dataclass
class AgentResponse:
    response: str
    tool_calls: list[ToolCallRecord] = field(default_factory=list)


@dataclass
class Session:
    session_id: str
    api_key: str
    agent_executor: Any
    history: list[BaseMessage] = field(default_factory=list)
    tool_definitions: list[ToolDefinition] = field(default_factory=list)


# Shared in-process session store.  Workers are asyncio tasks in the same
# event loop so this dict is safe without locks (GIL + single-threaded loop).
_sessions: dict[str, Session] = {}     # api_key → Session
_api_key_to_session: dict[str, str] = {}   # api_key → session_id (for lookup)


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

def create_or_refresh_session(api_key: str, tool_definitions: list[ToolDefinition]) -> str:
    """
    Create a new session for *api_key* (or replace an existing one when the
    tool list changes).  Returns the session_id.
    """
    session_id = str(uuid.uuid4())

    lc_tools = [_make_callback_tool(td).as_langchain_tool() for td in tool_definitions]

    llm = ChatGoogleGenerativeAI(
        model=settings.MODEL_NAME,
        google_api_key=settings.GOOGLE_API_KEY,
        temperature=0.7,
    )
    agent_executor = create_react_agent(llm, lc_tools)

    session = Session(
        session_id=session_id,
        api_key=api_key,
        agent_executor=agent_executor,
        tool_definitions=tool_definitions,
    )
    _sessions[api_key] = session
    _api_key_to_session[api_key] = session_id
    logger.info("Created session %s for api_key=...%s with %d tools", session_id, api_key[-6:], len(lc_tools))
    return session_id


def get_session(api_key: str) -> Session | None:
    return _sessions.get(api_key)


def delete_session(api_key: str) -> None:
    session = _sessions.pop(api_key, None)
    _api_key_to_session.pop(api_key, None)
    if session:
        logger.info("Deleted session %s for api_key=...%s", session.session_id, api_key[-6:])


def list_sessions() -> list[str]:
    return list(_api_key_to_session.values())


# ---------------------------------------------------------------------------
# Run (called from worker)
# ---------------------------------------------------------------------------

async def run_session(
    api_key: str,
    message: str,
    tool_definitions: list[ToolDefinition] | None = None,
) -> AgentResponse:
    """
    Run one chat turn for *api_key*.  If no session exists (or tool_definitions
    differs from the stored ones), a new session is created automatically.
    """
    session = get_session(api_key)
    if session is None:
        create_or_refresh_session(api_key, tool_definitions or [])
        session = _sessions[api_key]

    session.history.append(HumanMessage(content=message))

    result = await session.agent_executor.ainvoke({"messages": session.history})
    messages_out: list[BaseMessage] = result.get("messages", [])

    # Extract final text response
    final_response = ""
    for msg in reversed(messages_out):
        if isinstance(msg, AIMessage) and msg.content:
            final_response = str(msg.content)
            break

    # Collect tool call records
    tool_call_records: list[ToolCallRecord] = []
    for msg in messages_out:
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                tool_name = tc.get("name", "")
                tool_input = tc.get("args", {})
                # Find matching tool result message
                tool_output = ""
                tc_id = tc.get("id")
                for tm in messages_out:
                    if (
                        hasattr(tm, "tool_call_id")
                        and tc_id
                        and getattr(tm, "tool_call_id", None) == tc_id
                    ):
                        tool_output = str(tm.content)
                        break
                tool_call_records.append(ToolCallRecord(tool_name=tool_name, input=tool_input, output=tool_output))

    # Extend history with new messages (avoid duplicates)
    existing_ids = {id(m) for m in session.history}
    for m in messages_out:
        if id(m) not in existing_ids:
            session.history.append(m)

    return AgentResponse(response=final_response, tool_calls=tool_call_records)


# ---------------------------------------------------------------------------
# Callback tool factory
# ---------------------------------------------------------------------------

def _make_callback_tool(td: ToolDefinition):
    """Return a BaseTool-compatible object that calls the APP back via HTTP."""
    from abc import ABC, abstractmethod

    class BaseTool(ABC):
        definition: ToolDefinition

        @abstractmethod
        async def execute(self, input: dict[str, Any]) -> str: ...

        def as_langchain_tool(self):
            import asyncio
            from langchain_core.tools import StructuredTool
            from pydantic import create_model

            props = self.definition.parameters.get("properties") or {}
            field_defs: dict[str, Any] = {k: (str, ...) for k in props}
            InputModel = create_model(f"{self.definition.name}_input", **field_defs) if field_defs else None

            async def _run(**kwargs):
                return await self.execute(kwargs)

            def _run_sync(**kwargs):
                loop = asyncio.get_event_loop()
                return loop.run_until_complete(self.execute(kwargs))

            return StructuredTool(
                name=self.definition.name,
                description=self.definition.description,
                func=_run_sync,
                coroutine=_run,
                args_schema=InputModel,
            )

    class _CallbackTool(BaseTool):
        definition = td

        async def execute(self, input: dict[str, Any]) -> str:
            if not td.callback_url:
                return f"[Error] Tool '{td.name}' has no callback_url configured."
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(td.callback_url, json={"tool": td.name, "input": input})
                    resp.raise_for_status()
                    data = resp.json()
                    return str(data.get("result", data))
            except httpx.HTTPStatusError as exc:
                return f"[Error] Tool '{td.name}' callback returned HTTP {exc.response.status_code}: {exc.response.text[:200]}"
            except Exception as exc:
                return f"[Error] Tool '{td.name}' callback failed: {exc}"

    return _CallbackTool()
