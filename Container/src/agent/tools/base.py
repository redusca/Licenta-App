"""
Base types for container tools.

The container does NOT implement tools — it is a pure LLM reasoning layer.

Call flow:
  APP  →  POST /api/agent/init  (sends tool definitions + callback_url per tool)
  APP  →  POST /api/agent/chat  (sends user message)
  Container/LLM decides which tool to call
  Container  →  POST {tool.callback_url}  (executes tool on the APP side)
  APP returns result; container feeds it back to the LLM
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel


class ToolDefinition(BaseModel):
    """Schema that the APP sends to /api/agent/init to register a tool."""

    name: str
    description: str
    # JSON Schema describing the tool's expected input object
    parameters: dict[str, Any] = {}
    # URL on the APP side that the container calls to execute this tool.
    # The container POSTs {"tool": name, "input": {...}} and expects {"result": "..."}
    callback_url: str = ""


class BaseTool(ABC):
    """Runtime base class for all built-in and dynamically-loaded tools."""

    definition: ToolDefinition

    @abstractmethod
    async def execute(self, input: dict[str, Any]) -> str:
        """
        Run the tool with the given input dict and return a string result.
        The agent will see this string as the tool's output.
        """
        ...

    # ── LangChain compatibility ───────────────────────────────────────────────

    def as_langchain_tool(self):
        """
        Return a langchain_core.tools.StructuredTool wrapping this BaseTool.
        """
        import asyncio
        from langchain_core.tools import StructuredTool
        from pydantic import create_model

        # Build a Pydantic model from the parameter schema (best-effort)
        field_defs: dict[str, Any] = {
            k: (str, ...) for k in (self.definition.parameters.get("properties") or {})
        }
        InputModel = create_model(f"{self.definition.name}_input", **field_defs) if field_defs else None

        async def _run(**kwargs):
            return await self.execute(kwargs)

        def _run_sync(**kwargs):
            return asyncio.get_event_loop().run_until_complete(self.execute(kwargs))

        return StructuredTool(
            name=self.definition.name,
            description=self.definition.description,
            func=_run_sync,
            coroutine=_run,
            args_schema=InputModel,
        )
