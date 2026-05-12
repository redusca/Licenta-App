"""
Agent API routes.

Authentication:
  - JWT (Bearer)  → register / view / delete your agent API key
  - X-API-Key     → chat endpoints (no JWT needed from the APP)

── Legacy endpoints (ReAct / Gemini) ──────────────────────────────────────────
  POST   /api/agent/register      — create an api_key for the authenticated user
  GET    /api/agent/key           — return existing api_key (JWT)
  DELETE /api/agent/key           — delete api_key + close session (JWT)
  POST   /api/agent/chat          — send a message, non-streaming (X-API-Key)
  DELETE /api/agent/session       — reset conversation history (X-API-Key)

── Planning Agent — chat management (X-API-Key) ───────────────────────────────
  POST   /api/agent/chats                      — create a new chat
  GET    /api/agent/chats                      — list all chats for this key
  GET    /api/agent/chats/{chat_id}            — get chat detail with messages
  DELETE /api/agent/chats/{chat_id}            — delete a chat
  POST   /api/agent/chats/{chat_id}/message    — send message (SSE streaming)
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import settings
from Database.session import get_db
from Database.models import AgentKey, User
from utils.auth import get_current_user
from utils.agent_runner import ToolDefinition, delete_session
from utils.chat_manager import (
    create_chat,
    get_chat,
    list_chats,
    delete_chat,
    delete_all_chats,
    add_message,
    update_chat_tools,
)
from utils.planning_agent import run_planning_agent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class AgentKeyOut(BaseModel):
    api_key: str


class ToolCallOut(BaseModel):
    tool_name: str
    input: dict[str, Any]
    output: str


class ChatIn(BaseModel):
    message: str
    tools: list[ToolDefinition] = []


class ChatOut(BaseModel):
    response: str
    tool_calls: list[ToolCallOut]


# ── Planning chat schemas ────────────────────────────────────────────────────

class ChatCreateIn(BaseModel):
    tools: list[dict[str, Any]] = []
    title: str = ""


class ChatInfoOut(BaseModel):
    chat_id: str
    title: str
    created_at: str
    message_count: int


class ChatDetailOut(BaseModel):
    chat_id: str
    title: str
    created_at: str
    messages: list[dict[str, Any]]


class MessageIn(BaseModel):
    message: str
    tools: list[dict[str, Any]] = []   # optional override — updates chat's tool list


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _get_user_by_api_key(api_key: str, db: Session) -> User:
    record = db.query(AgentKey).filter(AgentKey.api_key == api_key).first()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or unknown X-API-Key",
        )
    user = record.owner
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive",
        )
    return user


def _require_api_key(request: Request, db: Session = Depends(get_db)) -> User:
    api_key = request.headers.get("X-API-Key", "")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-API-Key header",
        )
    return _get_user_by_api_key(api_key, db)


def _get_api_key_from_header(request: Request) -> str:
    api_key = request.headers.get("X-API-Key", "")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-API-Key header",
        )
    return api_key


# ---------------------------------------------------------------------------
# Key management (JWT-protected)
# ---------------------------------------------------------------------------

@router.post("/register", response_model=AgentKeyOut, status_code=status.HTTP_201_CREATED)
def register_agent_key(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate and store a new agent API key for the authenticated user."""
    existing = db.query(AgentKey).filter(AgentKey.user_id == current_user.id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An agent key already exists. DELETE /api/agent/key first.",
        )
    new_key = str(uuid.uuid4())
    record = AgentKey(user_id=current_user.id, api_key=new_key)
    db.add(record)
    db.commit()
    logger.info("Created agent key for user %s", current_user.id)
    return AgentKeyOut(api_key=new_key)


@router.get("/key", response_model=AgentKeyOut)
def get_agent_key(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(AgentKey).filter(AgentKey.user_id == current_user.id).first()
    if not record:
        raise HTTPException(
            status_code=404,
            detail="No agent key found. POST /api/agent/register first.",
        )
    return AgentKeyOut(api_key=record.api_key)


@router.delete("/key", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent_key(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(AgentKey).filter(AgentKey.user_id == current_user.id).first()
    if not record:
        raise HTTPException(status_code=404, detail="No agent key found.")
    delete_session(record.api_key)
    delete_all_chats(record.api_key)
    db.delete(record)
    db.commit()
    logger.info("Deleted agent key for user %s", current_user.id)


# ---------------------------------------------------------------------------
# Legacy chat — non-streaming ReAct / Gemini (kept for backwards compat)
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatOut)
async def chat(
    body: ChatIn,
    request: Request,
    db: Session = Depends(get_db),
):
    api_key = _get_api_key_from_header(request)
    _get_user_by_api_key(api_key, db)

    pool = request.app.state.agent_pool
    try:
        result = await pool.enqueue(api_key, body.message, body.tools or None)
    except (TimeoutError, asyncio.TimeoutError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"All {settings.AGENT_WORKER_COUNT} agent workers are busy. Try again shortly.",
        )
    except Exception as exc:
        logger.exception("Agent pool error")
        raise HTTPException(status_code=500, detail=f"Agent error: {exc}")

    return ChatOut(
        response=result.response,
        tool_calls=[
            ToolCallOut(tool_name=tc.tool_name, input=tc.input, output=tc.output)
            for tc in result.tool_calls
        ],
    )


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
def reset_session(
    request: Request,
    db: Session = Depends(get_db),
):
    """Clear the LangGraph conversation history for this user's API key."""
    api_key = _get_api_key_from_header(request)
    _get_user_by_api_key(api_key, db)
    delete_session(api_key)
    logger.info("Session reset for api_key=...%s", api_key[-6:])


# ---------------------------------------------------------------------------
# Planning Agent — chat management
# ---------------------------------------------------------------------------

@router.post("/chats", response_model=ChatInfoOut, status_code=status.HTTP_201_CREATED)
def create_agent_chat(
    body: ChatCreateIn,
    request: Request,
    db: Session = Depends(get_db),
):
    """Create a new planning-agent chat session."""
    api_key = _get_api_key_from_header(request)
    _get_user_by_api_key(api_key, db)

    chat = create_chat(
        api_key=api_key,
        tool_definitions=body.tools,
        title=body.title,
    )
    logger.info("Created chat %s for api_key=...%s", chat.chat_id, api_key[-6:])
    return ChatInfoOut(**chat.to_dict(include_messages=False))


@router.get("/chats", response_model=list[ChatInfoOut])
def list_agent_chats(
    request: Request,
    db: Session = Depends(get_db),
):
    """List all chats for the authenticated API key (newest first)."""
    api_key = _get_api_key_from_header(request)
    _get_user_by_api_key(api_key, db)

    chats = list_chats(api_key)
    return [ChatInfoOut(**c.to_dict(include_messages=False)) for c in chats]


@router.get("/chats/{chat_id}", response_model=ChatDetailOut)
def get_agent_chat(
    chat_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Get a chat with its full message history."""
    api_key = _get_api_key_from_header(request)
    _get_user_by_api_key(api_key, db)

    chat = get_chat(api_key, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found.")
    return ChatDetailOut(**chat.to_dict(include_messages=True))


@router.delete("/chats/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent_chat(
    chat_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Delete a chat and its message history."""
    api_key = _get_api_key_from_header(request)
    _get_user_by_api_key(api_key, db)

    if not delete_chat(api_key, chat_id):
        raise HTTPException(status_code=404, detail="Chat not found.")
    logger.info("Deleted chat %s for api_key=...%s", chat_id, api_key[-6:])


# ---------------------------------------------------------------------------
# Planning Agent — streaming message endpoint
# ---------------------------------------------------------------------------

@router.post("/chats/{chat_id}/message")
async def send_message(
    chat_id: str,
    body: MessageIn,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Send a message to the planning agent.
    Returns a Server-Sent Events stream of execution events.

    Each event line:
        data: <json object>\\n\\n

    Final event types: "final" (full response), "error" (on failure).
    Stream ends with:
        data: [DONE]\\n\\n
    """
    api_key = _get_api_key_from_header(request)
    _get_user_by_api_key(api_key, db)

    chat = get_chat(api_key, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found.")

    # Update tool list if the caller sent tools with this message
    tools = body.tools if body.tools else chat.tool_definitions
    if body.tools:
        update_chat_tools(api_key, chat_id, body.tools)

    # Record the user turn now so history is correct when the agent reads it
    add_message(api_key, chat_id, "user", body.message)

    async def event_stream():
        try:
            async for event in run_planning_agent(
                api_key=api_key,
                chat_id=chat_id,
                message=body.message,
                tools=tools,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            logger.exception("Streaming error for chat %s", chat_id)
            err = {"type": "error", "message": str(exc)}
            yield f"data: {json.dumps(err)}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
            "Connection": "keep-alive",
        },
    )
