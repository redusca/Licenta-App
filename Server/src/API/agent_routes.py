"""
Agent API routes.

Authentication:
  - JWT (Bearer)  → register / view / delete your agent API key
  - X-API-Key     → send chat messages (no JWT needed from the APP)

Endpoints:
  POST   /api/agent/register   — create an api_key for the authenticated user
  GET    /api/agent/key        — return existing api_key (JWT)
  DELETE /api/agent/key        — delete api_key + close session (JWT)
  POST   /api/agent/chat       — send a message (X-API-Key)
  DELETE /api/agent/session    — reset conversation history (X-API-Key)
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import settings
from Database.session import get_db
from Database.models import AgentKey, User
from utils.auth import get_current_user
from utils.agent_runner import ToolDefinition, delete_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])


# ---------------------------------------------------------------------------
# Schemas
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


# ---------------------------------------------------------------------------
# Auth helper: look up a user by their agent API key
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
        raise HTTPException(status_code=404, detail="No agent key found. POST /api/agent/register first.")
    return AgentKeyOut(api_key=record.api_key)


@router.delete("/key", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent_key(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(AgentKey).filter(AgentKey.user_id == current_user.id).first()
    if not record:
        raise HTTPException(status_code=404, detail="No agent key found.")
    # Close in-memory LangGraph session
    delete_session(record.api_key)
    db.delete(record)
    db.commit()
    logger.info("Deleted agent key for user %s", current_user.id)


# ---------------------------------------------------------------------------
# Chat (X-API-Key protected)
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatOut)
async def chat(
    body: ChatIn,
    request: Request,
    db: Session = Depends(get_db),
):
    api_key = _get_api_key_from_header(request)
    _get_user_by_api_key(api_key, db)   # validates key + active user

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
