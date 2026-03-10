"""
Summarize tool  (requires_ai=True)

Demonstrates the 3-tier call pattern:
  1. User message → main ReAct agent (primary LLM call)
  2. Agent decides to call this tool
  3. Tool makes a secondary Gemini call to summarise the text

This tool is intentionally simple — in practice any tool that needs
language-level reasoning (classification, extraction, rewriting…) can
follow the same pattern.
"""
from __future__ import annotations

import logging
from typing import Any

from langchain_google_genai import ChatGoogleGenerativeAI

from agent.tools.base import BaseTool, ToolDefinition
from config import settings

logger = logging.getLogger(__name__)


class SummarizeTool(BaseTool):
    definition = ToolDefinition(
        name="summarize",
        description=(
            "Summarise a long piece of text into a concise paragraph. "
            "Use this when the user provides a large block of text and wants a brief summary."
        ),
        parameters={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The text to summarise"},
                "max_sentences": {
                    "type": "integer",
                    "description": "Target number of sentences in the summary (default 3)",
                },
            },
            "required": ["text"],
        },
        requires_ai=True,  # ← triggers a secondary LLM call
    )

    async def execute(self, input: dict[str, Any]) -> str:
        text = input.get("text", "")
        max_sentences = int(input.get("max_sentences", 3))

        if not text.strip():
            return "No text provided to summarise."

        logger.info("[SummarizeTool] Secondary Gemini call — summarising %d chars", len(text))

        # Secondary LLM call — independent from the main agent's chat session
        llm = ChatGoogleGenerativeAI(
            model=settings.MODEL_NAME,
            google_api_key=settings.GOOGLE_API_KEY,
            temperature=0.3,
        )

        prompt = (
            f"Summarise the following text in at most {max_sentences} sentences. "
            f"Be concise and factual.\n\n---\n{text}\n---"
        )

        response = await llm.ainvoke(prompt)
        summary = response.content if hasattr(response, "content") else str(response)

        logger.info("[SummarizeTool] Secondary call completed — %d chars in summary", len(summary))
        return summary
