"""
Agent runner — manages per-session ReAct agents backed by Gemini.

The container is a pure LLM reasoning layer.  It has NO built-in tool
implementations.  All tools live in the APP; the container receives their
definitions at session init and calls the APP back (callback_url) when the
LLM wants to invoke one.

Session lifecycle:
  create_session(tool_definitions) → session_id
  run_session(session_id, message)  → AgentResponse
  delete_session(session_id)
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

from agent.tools.base import ToolDefinition, BaseTool
from config import settings

logger = logging.getLogger(__name__)


# ── Session state ────────────────────────────────────────────────────────────

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
    agent_executor: Any  # LangGraph compiled graph
    history: list[BaseMessage] = field(default_factory=list)
    tool_map: dict[str, BaseTool] = field(default_factory=dict)


# ── Session store ─────────────────────────────────────────────────────────────

_sessions: dict[str, Session] = {}


# ── Public API ────────────────────────────────────────────────────────────────

def create_session(tool_definitions: list[ToolDefinition]) -> str:
    """
    Instantiate a new ReAct agent session.

    Every tool the APP registers becomes a callback stub: when the LLM
    decides to call the tool, the container POSTs the input to the tool's
    callback_url and returns the result to the LLM.
    """
    session_id = str(uuid.uuid4())

    resolved_tools: dict[str, BaseTool] = {}
    lc_tools = []

    for td in tool_definitions:
        stub = _make_callback_tool(td)
        resolved_tools[td.name] = stub
        lc_tools.append(stub.as_langchain_tool())

    llm = ChatGoogleGenerativeAI(
        model=settings.MODEL_NAME,
        google_api_key=settings.GOOGLE_API_KEY,
        temperature=0.7,
    )

    agent_executor = create_react_agent(llm, lc_tools)

    _sessions[session_id] = Session(
        session_id=session_id,
        agent_executor=agent_executor,
        history=[],
        tool_map=resolved_tools,
    )

    logger.info("Created session %s with %d tools", session_id, len(lc_tools))
    return session_id


async def run_session(session_id: str, message: str) -> AgentResponse:
    """
    Send a message to the agent and return the full response including
    which tools were called.
    """
    if session_id not in _sessions:
        raise KeyError(f"Session {session_id} not found")

    session = _sessions[session_id]
    session.history.append(HumanMessage(content=message))

    tool_call_records: list[ToolCallRecord] = []

    # Invoke the agent with the full conversation history
    result = await session.agent_executor.ainvoke({"messages": session.history})

    messages_out: list[BaseMessage] = result.get("messages", [])

    # Find AIMessage responses and tool calls in the output
    final_response = ""
    for msg in reversed(messages_out):
        if isinstance(msg, AIMessage) and msg.content:
            final_response = str(msg.content)
            break

    # Harvest tool call info from the message list
    for msg in messages_out:
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                tool_name = tc.get("name", "")
                tool_input = tc.get("args", {})
                tool_output = ""

                # Find the matching ToolMessage
                for tm in messages_out:
                    if hasattr(tm, "tool_call_id") and hasattr(tm, "content"):
                        if hasattr(tc, "id") and tm.tool_call_id == tc.get("id"):
                            tool_output = str(tm.content)
                            break

                tool_call_records.append(ToolCallRecord(
                    tool_name=tool_name,
                    input=tool_input,
                    output=tool_output,
                ))

    # Append the final AI message to history
    session.history.extend([m for m in messages_out if m not in session.history])

    return AgentResponse(
        response=final_response,
        tool_calls=tool_call_records,
    )


def list_sessions() -> list[str]:
    return list(_sessions.keys())


def delete_session(session_id: str) -> None:
    _sessions.pop(session_id, None)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_callback_tool(td: ToolDefinition) -> BaseTool:
    """
    Wrap a ToolDefinition in a BaseTool that calls the APP back via HTTP
    when the LLM invokes it.

    The container POSTs to td.callback_url:
      {"tool": td.name, "input": {...}}
    and expects the APP to respond with:
      {"result": "<string result>"}
    """

    class _CallbackTool(BaseTool):
        definition = td

        async def execute(self, input: dict[str, Any]) -> str:
            if not td.callback_url:
                return (
                    f"[Error] Tool '{td.name}' has no callback_url configured. "
                    "The APP must provide a callback_url when registering this tool."
                )
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(
                        td.callback_url,
                        json={"tool": td.name, "input": input},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    return str(data.get("result", data))
            except httpx.HTTPStatusError as exc:
                return f"[Error] Tool '{td.name}' callback returned HTTP {exc.response.status_code}: {exc.response.text[:200]}"
            except Exception as exc:
                return f"[Error] Tool '{td.name}' callback failed: {exc}"

    return _CallbackTool()
