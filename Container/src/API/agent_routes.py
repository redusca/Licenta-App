"""
Agent API routes.

All routes require the X-API-Key header to match CONTAINER_API_KEY.
The key is injected by the server at container deploy time.

The container is a pure LLM reasoning layer -- it has NO built-in tools.
The APP registers tool definitions (with callback URLs) at session init.
When the LLM decides to call a tool, the container POSTs back to the APP.

Call flow:
  APP  ->  POST /api/agent/init   { tools: [{name, description, parameters, callback_url}] }
  APP  ->  POST /api/agent/chat   { session_id, message }
  LLM decides to call a tool
  Container  ->  POST {tool.callback_url}  { tool: name, input: {...} }
  APP executes it, returns { result: "..." }
  Container feeds result back to LLM -> final response returned to APP
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from agent.tools.base import ToolDefinition
from config import settings
from utils.agent_runner import (
    AgentResponse,
    ToolCallRecord,
    create_session,
    run_session,
    list_sessions,
    delete_session,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])


# -- Schemas -------------------------------------------------------------------

class InitIn(BaseModel):
    tools: list[ToolDefinition] = []


class InitOut(BaseModel):
    session_id: str
    registered_tools: list[str]


class ChatIn(BaseModel):
    session_id: str
    message: str


class ToolCallOut(BaseModel):
    tool_name: str
    input: dict[str, Any]
    output: str


class ChatOut(BaseModel):
    session_id: str
    response: str
    tool_calls: list[ToolCallOut]


class SessionsOut(BaseModel):
    sessions: list[str]


# -- Routes --------------------------------------------------------------------

@router.get("/test")
async def test_llm():
    """
    LLM connectivity test (no auth needed).
    Creates a throwaway session, sends a hello message, and returns the response.
    Confirms the container is running and the GOOGLE_API_KEY is valid.
    """
    session_id = create_session([])
    try:
        result: AgentResponse = await run_session(
            session_id,
            "Say exactly: 'Hello from Licenta agent!' and nothing else.",
        )
    finally:
        delete_session(session_id)

    return {
        "status": "ok",
        "model": settings.MODEL_NAME,
        "response": result.response,
    }


@router.post("/init", response_model=InitOut, status_code=status.HTTP_201_CREATED)
def init_session(body: InitIn):
    """
    Create a new agent session.
    Register tool definitions; each tool may include a callback_url pointing
    to the APP's tool executor endpoint.
    """
    session_id = create_session(body.tools)
    tool_names = [td.name for td in body.tools]
    logger.info("Init session %s with tools: %s", session_id, tool_names)
    return InitOut(session_id=session_id, registered_tools=tool_names)


@router.post("/chat", response_model=ChatOut)
async def chat(body: ChatIn):
    """
    Send a message to an existing agent session.
    The LLM will reason and call tools (via callback to the APP) as needed.
    """
    try:
        result: AgentResponse = await run_session(body.session_id, body.message)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Session '{body.session_id}' not found")
    except Exception as exc:
        logger.exception("Agent run failed for session %s", body.session_id)
        raise HTTPException(status_code=500, detail=f"Agent error: {exc}")

    return ChatOut(
        session_id=body.session_id,
        response=result.response,
        tool_calls=[
            ToolCallOut(tool_name=tc.tool_name, input=tc.input, output=tc.output)
            for tc in result.tool_calls
        ],
    )


@router.get("/sessions", response_model=SessionsOut)
def sessions():
    """List all active session IDs."""
    return SessionsOut(sessions=list_sessions())


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def close_session(session_id: str):
    """Delete an agent session and free its memory."""
    delete_session(session_id)
