from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class Message:
    role: str          # "user" | "assistant" | "system"
    content: str
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict:
        return {"role": self.role, "content": self.content, "timestamp": self.timestamp}


@dataclass
class Chat:
    chat_id: str
    api_key: str
    title: str
    messages: list[Message] = field(default_factory=list)
    # Tool definitions are stored as plain dicts to avoid circular imports;
    # planning_agent.py converts them to ToolDefinition objects.
    tool_definitions: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self, include_messages: bool = True) -> dict:
        d: dict[str, Any] = {
            "chat_id": self.chat_id,
            "title": self.title,
            "created_at": self.created_at,
            "message_count": len(self.messages),
        }
        if include_messages:
            d["messages"] = [m.to_dict() for m in self.messages]
        return d


# All callers run as asyncio coroutines in a single event loop (no preemption
# between synchronous operations), so the dict is safe without locks in the
# current architecture. The lock below is defensive: it prevents data races
# if the code is ever moved to a thread-pool or multi-threaded executor.
_store: dict[str, dict[str, Chat]] = {}
_lock = threading.Lock()


def create_chat(
    api_key: str,
    tool_definitions: list[dict[str, Any]] | None = None,
    title: str = "",
) -> Chat:
    chat_id = str(uuid.uuid4())
    chat = Chat(
        chat_id=chat_id,
        api_key=api_key,
        title=title or f"Chat {chat_id[:8]}",
        tool_definitions=tool_definitions or [],
    )
    with _lock:
        _store.setdefault(api_key, {})[chat_id] = chat
    return chat


def get_chat(api_key: str, chat_id: str) -> Chat | None:
    with _lock:
        return _store.get(api_key, {}).get(chat_id)


def list_chats(api_key: str) -> list[Chat]:
    with _lock:
        chats = list(_store.get(api_key, {}).values())
    chats.sort(key=lambda c: c.created_at, reverse=True)
    return chats


def delete_chat(api_key: str, chat_id: str) -> bool:
    with _lock:
        user_chats = _store.get(api_key, {})
        if chat_id in user_chats:
            del user_chats[chat_id]
            return True
    return False


def delete_all_chats(api_key: str) -> None:
    with _lock:
        _store.pop(api_key, None)


def add_message(api_key: str, chat_id: str, role: str, content: str) -> Message | None:
    with _lock:
        chat = _store.get(api_key, {}).get(chat_id)
        if chat is None:
            return None
        msg = Message(role=role, content=content)
        chat.messages.append(msg)
        if role == "user" and chat.title.startswith("Chat "):
            chat.title = content[:60] + ("..." if len(content) > 60 else "")
    return msg


def update_chat_tools(
    api_key: str,
    chat_id: str,
    tool_definitions: list[dict[str, Any]],
) -> None:
    with _lock:
        chat = _store.get(api_key, {}).get(chat_id)
        if chat:
            chat.tool_definitions = tool_definitions
