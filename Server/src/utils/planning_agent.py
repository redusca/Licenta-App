"""
Planning Agent — Groq-backed Plan-and-Execute agent with SSE streaming.

Flow per request:
  1. Plan     → Groq LLM receives the user task + tool descriptions
                → returns a JSON execution plan (list of steps)
  2. Execute  → for each step:
                  • type "tool"  → POST to the tool's callback_url, yield result
                  • type "llm"   → stream a Groq response, yield token chunks
  3. Synthesize → Groq streams the final answer from all step results

Events yielded (dicts — the route serialises them as SSE):
  {"type": "status",       "message": "..."}
  {"type": "plan",         "steps": [...]}
  {"type": "step_start",   "step_id": N, "description": "...", "step_type": "tool"|"llm"}
  {"type": "tool_call",    "step_id": N, "tool": "...", "input": {...}}
  {"type": "tool_result",  "step_id": N, "tool": "...", "result": "..."}
  {"type": "tool_error",   "step_id": N, "tool": "...", "error": "..."}
  {"type": "llm_start",    "step_id": N}
  {"type": "llm_chunk",    "step_id": N, "content": "..."}
  {"type": "step_done",    "step_id": N, "result": "..."}
  {"type": "final_chunk",  "content": "..."}
  {"type": "final",        "response": "..."}
  {"type": "error",        "message": "..."}
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, AsyncGenerator

import httpx

from config import settings
from utils.chat_manager import add_message, get_chat

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Groq client (lazy singleton)
# ---------------------------------------------------------------------------

_groq_client = None


def _get_groq():
    global _groq_client
    if _groq_client is None:
        from groq import AsyncGroq
        api_key = settings.GROQ_API_KEY or os.environ.get("KEY", "")
        if not api_key:
            raise RuntimeError(
                "No Groq API key found. Set GROQ_API_KEY (or KEY) in .env"
            )
        _groq_client = AsyncGroq(api_key=api_key)
    return _groq_client


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_PLAN_SYSTEM = """\
You are the AI assistant built into a desktop file-management application.
You help users manage files, virtual drives, and media using the tools listed below.
You do NOT have internet access. Answer only from the tool list and conversation history.

IMPORTANT — choose the simplest approach that works:

ANSWER DIRECTLY with a single "llm" step when the request is:
  • A question about what you can do / what tools are available
    → prompt MUST include the full tool list so the executor can answer accurately
  • A suggestion, recommendation, opinion, or advice request
  • A continuation of a conversation (follow-up questions, clarifications)
  • A greeting, thanks, or small talk
  • Analysis of information already present in the conversation history
  → Use prompt = the user's actual question/request

USE TOOLS when the request explicitly requires:
  • File system access (list, read, move, delete, create files or folders)
  • Operations that produce side effects in the user's environment (convert, compress, merge…)

ATTACHED FILES — when the user message contains "[Attached context: ...]":
  • Parse the file paths and detect their extensions
  • Check each extension against the requested tool's supported input formats (from input_instructions)
  • If the files are valid inputs → use them directly in the tool's "files" or "sourceFolder" parameter
  • If a file type is NOT supported by the tool → tell the user which extensions ARE supported
  • If the request is ambiguous about which tool to use → pick the best matching tool based on file extensions
  • NEVER ask the user to re-specify files that are already attached

Available tools:
{tools_desc}

Produce ONLY valid JSON (no markdown, no prose):
{{
  "steps": [
    {{
      "id": 1,
      "description": "what this step achieves",
      "type": "tool",
      "tool": "<tool_name>",
      "input": {{<key>: <value>}}
    }},
    {{
      "id": 2,
      "description": "what this step achieves",
      "type": "llm",
      "prompt": "exact instruction for what to reason/write in this step"
    }}
  ]
}}

FOLLOW-UP RECOGNITION — read the conversation history carefully:
- If a previous tool call SUCCEEDED and the user is asking about that data
  ("how many?", "what was the first one?", "summarize it"), answer with a
  single "llm" step — do NOT re-call the tool.
- If a previous tool call FAILED and the user is asking about that data,
  answer with a single "llm" step explaining the failure — do NOT retry
  the tool unless the user explicitly asks you to try again.
- "Thank you", "ok", "got it", greetings → single "llm" step, always.

RULES:
- Default to a single "llm" step for conversational or knowledge requests.
- Only add tool steps when the task genuinely needs them.
- Maximum 5 steps. Never create steps just to look thorough.
- tool.input keys must exactly match the tool's parameter schema.
- NEVER suggest internet searches or external services — you only use the listed tools.
"""

_EXECUTOR_SYSTEM = """\
You are the AI assistant built into a desktop file-management application.
You help users manage files, virtual drives, and media. You do NOT have internet access.
Only answer from the information below — never invent external services or URLs.

Overall task: {task}

Steps already completed:
{past_steps}

Your assignment for this step: {prompt}

Be focused and concise — only address this step, not the whole task.
Use markdown formatting: **bold** for emphasis, bullet lists for multiple items, \
`code` for file paths or technical values.
"""

_SYNTHESIZER_SYSTEM = """\
You are the AI assistant built into a desktop file-management application.
You help users manage files, virtual drives, and media. You do NOT have internet access.

The user asked: {task}

All execution steps have been completed. Here are the results:
{step_results}

Write a clear, direct final answer for the user. Incorporate the results naturally.
Do not list step numbers or raw JSON — just answer the question.
Use markdown formatting: **bold** for emphasis, bullet lists for multiple items, \
`code` for file paths or technical values, headers (##) only for long structured answers.
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tools_desc(tools: list[dict]) -> str:
    if not tools:
        return "(no external tools — use only llm steps)"
    lines = []
    for t in tools:
        props = json.dumps(
            t.get("parameters", {}).get("properties", {}), ensure_ascii=False
        )
        line = f"- {t['name']}: {t['description']}\n  parameters: {props}"
        if t.get("input_instructions"):
            line += f"\n  input_instructions: {t['input_instructions']}"
        if t.get("output_description"):
            line += f"\n  output_description: {t['output_description']}"
        lines.append(line)
    return "\n".join(lines)


def _history_messages(chat_messages: list, max_turns: int = 10) -> list[dict]:
    """Convert the last N chat messages to Groq message dicts."""
    result = []
    for m in chat_messages[-max_turns:]:
        if m.role in ("user", "assistant", "system"):
            result.append({"role": m.role, "content": m.content})
    return result


def _extract_json(raw: str) -> dict:
    """Parse JSON from model output, stripping markdown fences if present."""
    text = raw.strip()
    # Strip ```json ... ``` or ``` ... ```
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Last resort: find the first {...} block
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise


def _find_tool(tools: list[dict], name: str) -> dict | None:
    for t in tools:
        if t.get("name") == name:
            return t
    return None


# ---------------------------------------------------------------------------
# Groq calls
# ---------------------------------------------------------------------------

async def _plan(task: str, tools: list[dict], history: list[dict]) -> list[dict]:
    client = _get_groq()
    system = _PLAN_SYSTEM.format(tools_desc=_tools_desc(tools))

    messages = [{"role": "system", "content": system}]
    messages.extend(history[-8:])
    messages.append({"role": "user", "content": task})

    resp = await client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=messages,
        temperature=1,
        max_completion_tokens=2048,
        top_p=1,
        reasoning_effort="medium",
        stream=False,
        stop=None,
    )
    raw = resp.choices[0].message.content or ""
    data = _extract_json(raw)
    return data.get("steps", [])


async def _stream_llm_step(
    prompt: str,
    task: str,
    past_steps: list[dict],
    history: list[dict],
    tools: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    client = _get_groq()
    past_str = "\n".join(
        f"Step {s['id']} ({s['description']}): {s['result']}" for s in past_steps
    ) or "None yet"
    full_prompt = prompt
    if tools:
        full_prompt = f"{prompt}\n\nAvailable tools for reference:\n{_tools_desc(tools)}"
    system = _EXECUTOR_SYSTEM.format(
        task=task, past_steps=past_str, prompt=full_prompt
    )

    stream = await client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[{"role": "system", "content": system}, *history[-6:]],
        temperature=1,
        max_completion_tokens=1024,
        top_p=1,
        reasoning_effort="medium",
        stream=True,
        stop=None,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def _stream_synthesize(
    task: str,
    step_results: list[dict],
    history: list[dict],
) -> AsyncGenerator[str, None]:
    client = _get_groq()
    results_str = "\n".join(
        f"Step {r['id']} — {r['description']}:\n{r['result']}"
        for r in step_results
    )
    system = _SYNTHESIZER_SYSTEM.format(task=task, step_results=results_str)

    stream = await client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[
            {"role": "system", "content": system},
            *history[-6:],
            {"role": "user", "content": task},
        ],
        temperature=1,
        max_completion_tokens=2048,
        top_p=1,
        reasoning_effort="medium",
        stream=True,
        stop=None,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def _call_tool(tool: dict, input_data: dict) -> str:
    """POST to the tool's callback_url and return the string result."""
    callback_url = tool.get("callback_url", "")
    tool_name = tool.get("name", "unknown")
    if not callback_url:
        return f"[Error] Tool '{tool_name}' has no callback_url."
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                callback_url, json={"tool": tool_name, "input": input_data}
            )
            resp.raise_for_status()
            data = resp.json()
            return str(data.get("result", data))
    except httpx.ConnectError as exc:
        return (
            f"[Error] Tool '{tool_name}' — cannot reach {callback_url}. "
            f"Connection refused or host unreachable. ({type(exc).__name__})"
        )
    except httpx.TimeoutException:
        return f"[Error] Tool '{tool_name}' — request timed out after 30 s ({callback_url})"
    except httpx.HTTPStatusError as exc:
        return (
            f"[Error] Tool '{tool_name}' HTTP {exc.response.status_code}: "
            f"{exc.response.text[:300]}"
        )
    except Exception as exc:
        return f"[Error] Tool '{tool_name}' — {type(exc).__name__}: {exc or '(no message)'}"


# ---------------------------------------------------------------------------
# Human-readable label helpers
# ---------------------------------------------------------------------------

def _step_label(step_id: int, total: int, desc: str) -> str:
    return f"Pasul {step_id}/{total}: {desc}"


def _input_preview(input_data: dict, max_len: int = 80) -> str:
    """Short one-line summary of tool input arguments."""
    if not input_data:
        return "(fără parametri)"
    parts = [f"{k}={json.dumps(v, ensure_ascii=False)}" for k, v in input_data.items()]
    preview = ", ".join(parts)
    return preview if len(preview) <= max_len else preview[:max_len] + "…"


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def run_planning_agent(
    api_key: str,
    chat_id: str,
    message: str,
    tools: list[dict],
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Core async generator.  The caller must have already called
    add_message(api_key, chat_id, "user", message) before invoking this.

    Every yielded dict always has a human-readable "message" key so the
    client can display it directly without inspecting "type".

    Yields SSE event dicts; the route handler serialises them as:
        data: <json>\n\n
    """
    chat = get_chat(api_key, chat_id)
    if chat is None:
        yield {"type": "error", "message": f"Chat {chat_id} not found."}
        return

    # History excludes the user message we just added (last item)
    history = _history_messages(chat.messages[:-1])

    # ── 1. Planning ─────────────────────────────────────────────────────────
    yield {
        "type": "status",
        "message": "Analizez cererea și creez planul de execuție…",
    }
    try:
        steps = await _plan(message, tools, history)
    except Exception as exc:
        logger.exception("Planning failed")
        yield {"type": "error", "message": f"Eroare la planificare: {exc}"}
        return

    if not steps:
        yield {"type": "error", "message": "Agentul nu a putut genera un plan valid."}
        return

    total = len(steps)
    tool_steps  = sum(1 for s in steps if s.get("type") == "tool")
    llm_steps   = total - tool_steps
    plan_summary = (
        f"Plan gata: {total} {'pas' if total == 1 else 'pași'}"
        + (f" ({tool_steps} tool{'uri' if tool_steps != 1 else ''}" if tool_steps else "")
        + (f", {llm_steps} LLM" if llm_steps and tool_steps else
           f" ({llm_steps} LLM" if llm_steps else "")
        + (")" if tool_steps or llm_steps else "")
    )
    yield {"type": "plan", "steps": steps, "message": plan_summary}

    # ── 2. Execute ───────────────────────────────────────────────────────────
    step_results: list[dict] = []

    for step in steps:
        step_id: int   = step.get("id", 0)
        step_desc: str = step.get("description", "")
        step_type: str = step.get("type", "llm")

        yield {
            "type": "step_start",
            "step_id": step_id,
            "description": step_desc,
            "step_type": step_type,
            "message": _step_label(step_id, total, step_desc),
        }

        if step_type == "tool":
            tool_name: str  = step.get("tool", "")
            tool_input: dict = step.get("input", {})
            tool_obj = _find_tool(tools, tool_name)

            if tool_obj is None:
                err = f"Tool '{tool_name}' nu a fost găsit în lista de tool-uri."
                yield {
                    "type": "tool_error",
                    "step_id": step_id,
                    "tool": tool_name,
                    "error": err,
                    "message": f"Eroare: {err}",
                }
                result = f"[Error] {err}"
            else:
                yield {
                    "type": "tool_call",
                    "step_id": step_id,
                    "tool": tool_name,
                    "input": tool_input,
                    "message": f"Apelez tool: {tool_name}({_input_preview(tool_input)})",
                }
                result = await _call_tool(tool_obj, tool_input)
                is_error = result.startswith("[Error]")
                yield {
                    "type": "tool_result",
                    "step_id": step_id,
                    "tool": tool_name,
                    "result": result,
                    "message": (
                        f"Eroare de la {tool_name}: {result[8:80]}"
                        if is_error
                        else f"Tool {tool_name} a returnat un rezultat"
                    ),
                }

        else:  # llm step
            step_prompt: str = step.get("prompt", step_desc)
            yield {
                "type": "llm_start",
                "step_id": step_id,
                "message": f"Mă gândesc: {step_desc}…",
            }
            chunks: list[str] = []
            try:
                async for chunk in _stream_llm_step(step_prompt, message, step_results, history, tools):
                    yield {"type": "llm_chunk", "step_id": step_id, "content": chunk, "message": chunk}
                    chunks.append(chunk)
                result = "".join(chunks)
            except Exception as exc:
                logger.exception("LLM step %d failed", step_id)
                result = f"[Error] LLM step failed: {exc}"
                yield {"type": "error", "message": f"Eroare la pasul LLM {step_id}: {exc}"}

        step_results.append({"id": step_id, "description": step_desc, "result": result})
        yield {
            "type": "step_done",
            "step_id": step_id,
            "result": result,
            "message": f"Pasul {step_id} finalizat",
        }

    # ── 3. Synthesize ────────────────────────────────────────────────────────
    yield {
        "type": "status",
        "message": f"Am completat toți cei {total} pași. Formulez răspunsul final…",
    }
    final_chunks: list[str] = []
    try:
        async for chunk in _stream_synthesize(message, step_results, history):
            yield {"type": "final_chunk", "content": chunk, "message": chunk}
            final_chunks.append(chunk)
    except Exception as exc:
        logger.exception("Synthesis failed")
        yield {"type": "error", "message": f"Eroare la sinteza finală: {exc}"}
        return

    final_response = "".join(final_chunks)
    add_message(api_key, chat_id, "assistant", final_response)
    yield {"type": "final", "response": final_response, "message": "Răspuns complet"}
