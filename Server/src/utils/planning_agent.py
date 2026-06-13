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

_groq_client = None


def _get_groq():
    global _groq_client
    if _groq_client is None:
        from groq import AsyncGroq
        api_key = settings.GROQ_API_KEY or os.environ.get("GROQ_API_KEY", "")
        if not api_key:
            raise RuntimeError(
                "No Groq API key found. Set GROQ_API_KEY in .env"
            )
        _groq_client = AsyncGroq(api_key=api_key)
    return _groq_client


_PLAN_SYSTEM = """\
You are the AI assistant built into a desktop file-management application.
You help users manage files, virtual drives, and media using the tools listed below.
You do NOT have internet access. Answer only from the tool list and conversation history.
Always respond in English regardless of the language used in the user's message.

SCOPE — you are ONLY allowed to help with:
  • Tasks that use the listed tools (file operations, media processing, drive management)
  • Questions about what you can do or how to use the tools
  • Clarifications or follow-ups about an ongoing file task
  • Brief greetings and acknowledgements

OUT-OF-SCOPE — if the user's request has nothing to do with file management or the listed tools
(e.g. recipes, general knowledge, coding tutorials, math problems, trivia, essay writing,
creative writing, weather, news, or any topic unrelated to the user's files and drives):
  → Produce a single "llm" step whose prompt instructs the executor to POLITELY DECLINE
    and remind the user that you are a file-management assistant.
    Do NOT answer the off-topic question, even partially.
  Example refusal prompt: "Politely tell the user you can only help with file management
    tasks and list 2-3 example things you CAN do for them."

IMPORTANT — choose the simplest approach that works:

ANSWER DIRECTLY with a single "llm" step when the request is:
  • A question about what you can do / what tools are available
    → prompt MUST include the full tool list so the executor can answer accurately
  • A follow-up or clarification about an active file task
  • A continuation of a conversation already about file management
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
  ("how many?", "what was the first one?", "summarize it", "mulțumesc", "câte"),
  answer with a single "llm" step — do NOT re-call the tool again.
  Example: user asked to list files → assistant returned the list → user asks
  "how many files?" → use a single "llm" step counting from the existing list.
- If a previous tool call FAILED and the user is asking about that data,
  answer with a single "llm" step explaining the failure — do NOT retry
  the tool unless the user explicitly asks you to try again.
- "Thank you", "ok", "got it", greetings → single "llm" step, always.

PROACTIVE TOOL USE — take action, do not ask for clarification when:
- The user's request explicitly mentions an operation AND the drive tools can
  fulfill it (list, read, move, create, delete).
  Example: "listează fișierele și citește raportul Q1" →
    step 1: list_files (folder="") to find files,
    step 2: read_file using the filename that matches "raport Q1" (e.g. "raport_Q1.pdf"),
    step 3: llm to summarize extracted data.
  Do NOT ask the user for a path you can discover by listing files first.
- When a filename is mentioned but the path is unknown, list files first to
  locate it, then read it — never ask the user to specify paths you can find.

SMART DRIVE WORKFLOW — always follow this exact sequence when the user asks to create
a smart/virtual/AI drive or to organize files into a drive:
  Step 1: ask_user(question="Which folder should I scan for files?", input_type="folder", answer="")
  Step 2: smart_drive_scan(sourceFolder=<answer from step 1>, extensions=[relevant extensions])
  Step 3: smart_drive_build(driveName=..., outputPath=<ask_user folder>, action="shortcuts",
          files=<files list from step 2 result>)
  • NEVER call smart_drive_build with an empty files list.
  • NEVER use ask_user(input_type="file") to collect individual files — always scan a folder.
  • For outputPath in smart_drive_build, use ask_user(input_type="folder") to let the user pick
    where to save the drive (separate from the source folder).

TOOL CHAINING — when a step needs output produced by a previous step, use {{step_N.field}} placeholders:
  • {{step_N.answer}}                — the user's typed answer from ask_user step N (folder path, text, etc.)
  • {{step_N.results[0].outputPath}} — the output file path from the first result of step N
  • {{step_N.results[0].path}}       — the source path echoed back from step N's first result
  • {{step_N.virtualDrivePath}}      — the virtual drive folder created by step N
  Placeholders are resolved at runtime once step N has completed.
  Example — ask folder, then scan:
    Step 1: ask_user(question="Which folder?", input_type="folder", answer="")
    Step 2: smart_drive_scan(sourceFolder="{{step_1.answer}}", extensions=[...])
  Example — remove background then vectorize to SVG:
    Step 1: remove_background(files=[{{"path": "C:/img.jpg"}}], outputMode="copy")
    Step 2: image_to_svg(files=[{{"path": "{{step_1.results[0].outputPath}}"}}], outputMode="copy")
  Example — move the output file to a drive:
    Step N: drive_file_mover(files=[{{"path": "{{step_N-1.results[0].outputPath}}"}}], destinationDrive="<drive name or path>", action="move")
  Use outputMode="copy" for intermediate steps so no outputPath folder is required.
  Only use outputMode="virtual_drive" on the LAST step, and only when the user explicitly asks for a virtual drive.

RULES:
- Default to a single "llm" step for conversational or knowledge requests.
- Only add tool steps when the task genuinely needs them.
- Maximum 5 steps. Never create steps just to look thorough.
- tool.input keys must exactly match the tool's parameter schema.
- NEVER suggest internet searches or external services — you only use the listed tools.
- ask_user step descriptions must describe what is being asked, not what the next step does.
  Example: use "Ask user to select an image file" instead of "Remove background from the file".
  Example: use "Ask user to choose a source folder" instead of "Scan folder for files".
"""

_EXECUTOR_SYSTEM = """\
You are the AI assistant built into a desktop file-management application.
You help users manage files, virtual drives, and media. You do NOT have internet access.
Only answer from the information below — never invent external services or URLs.
Always respond in English.
IMPORTANT: If this step asks you to refuse an off-topic request, do so politely and do NOT
answer the off-topic question. Redirect the user to file-management tasks instead.

Overall task: {task}

Steps already completed:
{past_steps}

Your assignment for this step: {prompt}

Be focused and concise — only address this step, not the whole task.
Use markdown formatting: **bold** for emphasis, bullet lists for multiple items, \
`code` for file paths or technical values.
IMPORTANT: Do NOT call any tools — this is a text-reasoning step only. \
Answer in plain text or markdown.
"""

_SYNTHESIZER_SYSTEM = """\
You are the AI assistant built into a desktop file-management application.
You help users manage files, virtual drives, and media. You do NOT have internet access.
Always respond in English.
IMPORTANT: If the task is unrelated to file management, write a polite refusal and redirect
the user to file-management tasks. Do NOT answer off-topic questions, even partially.

The user asked: {task}

All execution steps have been completed. Here are the results:
{step_results}

Write a clear, direct final answer for the user. Incorporate the results naturally.
Do not list step numbers or raw JSON — just answer the question.
Use markdown formatting: **bold** for emphasis, bullet lists for multiple items, \
`code` for file paths or technical values, headers (##) only for long structured answers.
IMPORTANT: Do NOT call any tools — write the final answer directly in plain text or markdown.
"""


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


def _tools_desc_short(tools: list[dict]) -> str:
    if not tools:
        return "(no external tools — use only llm steps)"
    lines = []
    for t in tools:
        line = f"- {t['name']}: {t['description']}"
        if t.get("input_instructions"):
            line += f"\n  [HOW TO USE: {t['input_instructions']}]"
        lines.append(line)
    return "\n".join(lines)


def _history_messages(chat_messages: list, max_turns: int = 10) -> list[dict]:
    result = []
    for m in chat_messages[-max_turns:]:
        if m.role in ("user", "assistant", "system"):
            result.append({"role": m.role, "content": m.content})
    return result


def _extract_json(raw: str) -> dict:
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


def _resolve_templates(value: Any, step_outputs: dict[int, Any]) -> Any:
    """
    Recursively replace {step_N.a.b.c} or {{step_N.a.b.c}} placeholders.

    Path segments that look like integers index into lists; everything else is a
    dict key.  If a segment can't be resolved the placeholder is left unchanged.
    """
    if isinstance(value, str):
        def _replacer(m: re.Match) -> str:
            step_id = int(m.group(1))
            parts = m.group(2).split(".")
            data: Any = step_outputs.get(step_id)
            if data is None:
                return m.group(0)
            for part in parts:
                if isinstance(data, dict):
                    data = data.get(part)
                elif isinstance(data, list):
                    try:
                        data = data[int(part)]
                    except (ValueError, IndexError):
                        return m.group(0)
                else:
                    return m.group(0)
                if data is None:
                    return m.group(0)
            return str(data)
        # Accept both single-brace {step_N.x} and double-brace {{step_N.x}}
        return re.sub(r"\{+step_(\d+)\.([^{}]+?)\}+", _replacer, value)
    if isinstance(value, dict):
        return {k: _resolve_templates(v, step_outputs) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_templates(item, step_outputs) for item in value]
    return value


async def _plan(task: str, tools: list[dict], history: list[dict]) -> list[dict]:
    client = _get_groq()
    system = _PLAN_SYSTEM.format(tools_desc=_tools_desc_short(tools))

    messages = [{"role": "system", "content": system}]
    messages.extend(history[-4:])
    messages.append({"role": "user", "content": task})

    resp = await client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=messages,
        temperature=1,
        max_completion_tokens=1024,
        top_p=1,
        stream=False,
        stop=None,
    )
    raw = resp.choices[0].message.content or ""
    data = _extract_json(raw)
    if isinstance(data, list):
        return data
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

    llm_kwargs: dict[str, Any] = dict(
        model=settings.GROQ_MODEL,
        messages=[{"role": "system", "content": system}, *history[-6:]],
        temperature=1,
        max_completion_tokens=1024,
        top_p=1,
        stop=None,
    )
    stream = await client.chat.completions.create(**llm_kwargs, stream=True)
    try:
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
        return
    except Exception as exc:
        if "tool" not in str(exc).lower():
            raise
        logger.warning("LLM step: model attempted tool call during streaming — retrying without stream")

    try:
        resp = await client.chat.completions.create(**llm_kwargs, stream=False)
        content = resp.choices[0].message.content or ""
        if content:
            yield content
            return
    except Exception as exc2:
        if "tool" not in str(exc2).lower():
            raise
        logger.warning("LLM step: non-stream also triggered tool call — retrying with anti-tool instruction")

    # Last resort: inject an explicit user message forbidding tool calls
    anti_tool_msgs = list(llm_kwargs["messages"]) + [
        {"role": "user", "content": "CRITICAL: Do NOT call any tool. Answer in plain text only."}
    ]
    resp2 = await client.chat.completions.create(
        **{k: v for k, v in llm_kwargs.items() if k != "messages"},
        messages=anti_tool_msgs,
        stream=False,
    )
    content = resp2.choices[0].message.content or ""
    if content:
        yield content


def _compact_result(result: str, max_len: int = 1200) -> str:
    if len(result) <= max_len:
        return result
    try:
        data = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        return result[:max_len] + f"\n…[truncated, {len(result)} chars total]"

    # Smart Drive scan — keep counts + first few file names
    if isinstance(data, dict) and "files" in data and "total_files" in data:
        files = data.get("files", [])
        sample = [f.get("filename") or f.get("path", "") for f in files[:5]]
        summary = (
            f"success={data.get('success')}, total_files={data.get('total_files')}, "
            f"analyzed={len(files)}, not_analyzed={len(data.get('not_analyzed', []))}, "
            f"sample_files={sample}"
        )
        return f"[scan result summary] {summary}"

    # Generic tool result with a results array
    if isinstance(data, dict) and "results" in data:
        results_list = data.get("results", [])
        succeeded = data.get("succeeded", sum(1 for r in results_list if r.get("success")))
        failed = data.get("failed", len(results_list) - succeeded)
        outputs = [r.get("outputPath") or r.get("path", "") for r in results_list[:5] if r.get("success")]
        summary = (
            f"success={data.get('success')}, total={data.get('total', len(results_list))}, "
            f"succeeded={succeeded}, failed={failed}, output_paths={outputs}"
        )
        return f"[tool result summary] {summary}"

    # Fallback: serialize compactly and truncate
    compact = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(compact) <= max_len:
        return compact
    return compact[:max_len] + f"…[truncated]"


async def _stream_synthesize(
    task: str,
    step_results: list[dict],
    history: list[dict],
) -> AsyncGenerator[str, None]:
    client = _get_groq()
    results_str = "\n".join(
        f"Step {r['id']} — {r['description']}:\n{_compact_result(r['result'])}"
        for r in step_results
    )
    system = _SYNTHESIZER_SYSTEM.format(task=task, step_results=results_str)

    messages = [
        {"role": "system", "content": system},
        *history[-6:],
        {"role": "user", "content": task},
    ]
    base_kwargs: dict[str, Any] = dict(
        model=settings.GROQ_MODEL,
        messages=messages,
        temperature=1,
        max_completion_tokens=2048,
        top_p=1,
        stop=None,
    )

    # Try streaming; fall back to non-streaming if the model emits a tool call
    # (Groq raises "Tool choice is none, but model called a tool" in that case).
    stream = await client.chat.completions.create(**base_kwargs, stream=True)
    try:
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
        return
    except Exception as exc:
        if "tool" not in str(exc).lower():
            raise
        logger.warning("Synthesizer: model attempted tool call during streaming — retrying without stream")

    # Fallback: non-streaming call avoids the tool-call streaming error
    try:
        resp = await client.chat.completions.create(**base_kwargs, stream=False)
        content = resp.choices[0].message.content or ""
        if content:
            yield content
            return
    except Exception as exc2:
        if "tool" not in str(exc2).lower():
            raise
        logger.warning("Synthesizer: non-stream also triggered tool call — retrying with anti-tool instruction")

    anti_tool_msgs = list(base_kwargs["messages"]) + [
        {"role": "user", "content": "CRITICAL: Do NOT call any tool. Write the final answer in plain text only."}
    ]
    resp2 = await client.chat.completions.create(
        **{k: v for k, v in base_kwargs.items() if k != "messages"},
        messages=anti_tool_msgs,
        stream=False,
    )
    content = resp2.choices[0].message.content or ""
    if content:
        yield content


async def _call_tool(tool: dict, input_data: dict) -> str:
    """POST to the tool's callback_url and return the string result."""
    callback_url = tool.get("callback_url", "")
    tool_name = tool.get("name", "unknown")
    if not callback_url:
        return f"[Error] Tool '{tool_name}' has no callback_url."
    # Long read timeout: scan + AI analysis of 50+ files can take 10+ minutes.
    _timeout = httpx.Timeout(connect=10.0, read=900.0, write=30.0, pool=10.0)
    try:
        async with httpx.AsyncClient(timeout=_timeout) as client:
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
        return f"[Error] Tool '{tool_name}' — request timed out ({callback_url})"
    except httpx.HTTPStatusError as exc:
        return (
            f"[Error] Tool '{tool_name}' HTTP {exc.response.status_code}: "
            f"{exc.response.text[:300]}"
        )
    except Exception as exc:
        return f"[Error] Tool '{tool_name}' — {type(exc).__name__}: {exc or '(no message)'}"


def _step_label(step_id: int, total: int, desc: str) -> str:
    return f"Step {step_id}/{total}: {desc}"


def _input_preview(input_data: dict, max_len: int = 80) -> str:
    if not input_data:
        return "(no parameters)"
    parts = [f"{k}={json.dumps(v, ensure_ascii=False)}" for k, v in input_data.items()]
    preview = ", ".join(parts)
    return preview if len(preview) <= max_len else preview[:max_len] + "…"


async def run_planning_agent(
    api_key: str,
    chat_id: str,
    message: str,
    tools: list[dict],
) -> AsyncGenerator[dict[str, Any], None]:
    chat = get_chat(api_key, chat_id)
    if chat is None:
        yield {"type": "error", "message": f"Chat {chat_id} not found."}
        return

    # History excludes the user message we just added (last item)
    history = _history_messages(chat.messages[:-1])

    yield {
        "type": "status",
        "message": "Analyzing request and creating execution plan…",
    }
    try:
        steps = await _plan(message, tools, history)
    except Exception as exc:
        logger.exception("Planning failed")
        yield {"type": "error", "message": f"Planning error: {exc}"}
        return

    if not steps:
        yield {"type": "error", "message": "Agent could not generate a valid plan."}
        return

    total = len(steps)
    tool_steps  = sum(1 for s in steps if s.get("type") == "tool")
    llm_steps   = total - tool_steps
    plan_summary = (
        f"Plan ready: {total} {'step' if total == 1 else 'steps'}"
        + (f" ({tool_steps} tool{'s' if tool_steps != 1 else ''}" if tool_steps else "")
        + (f", {llm_steps} LLM" if llm_steps and tool_steps else
           f" ({llm_steps} LLM" if llm_steps else "")
        + (")" if tool_steps or llm_steps else "")
    )
    yield {"type": "plan", "steps": steps, "message": plan_summary}

    step_results: list[dict] = []

    ctx_source_folder: str = ""   # filled by ask_user(input_type='folder')
    ctx_scan_files: list = []     # filled by smart_drive_scan result

    step_outputs: dict[int, Any] = {}

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
            tool_name: str   = step.get("tool", "")
            tool_input: dict = dict(step.get("input", {}))   # shallow copy — safe to mutate

            tool_input = _resolve_templates(tool_input, step_outputs)

            tool_obj = _find_tool(tools, tool_name)

            if tool_name == "smart_drive_scan":
                sf = (tool_input.get("sourceFolder") or "").strip()
                if not sf:
                    if ctx_source_folder:
                        tool_input["sourceFolder"] = ctx_source_folder
                        logger.info(
                            "Injected ctx_source_folder=%r → smart_drive_scan.sourceFolder",
                            ctx_source_folder,
                        )
                    else:
                        # LLM skipped the ask_user step — ask for the folder now
                        ask_tool = _find_tool(tools, "ask_user")
                        if ask_tool:
                            auto_ask_input = {
                                "question": "Which folder should I scan for files?",
                                "input_type": "folder",
                                "answer": "",
                            }
                            yield {
                                "type": "tool_call",
                                "step_id": step_id,
                                "tool": "ask_user",
                                "input": auto_ask_input,
                                "message": "Requesting source folder for scan…",
                            }
                            ask_result = await _call_tool(ask_tool, auto_ask_input)
                            yield {
                                "type": "tool_result",
                                "step_id": step_id,
                                "tool": "ask_user",
                                "result": ask_result,
                                "message": f"Folder selected: {ask_result[:80]}",
                            }
                            if (
                                not ask_result.startswith("[Error]")
                                and not ask_result.startswith("[Rejected]")
                            ):
                                candidate = ask_result.strip()
                                if candidate:
                                    ctx_source_folder = candidate
                                    tool_input["sourceFolder"] = ctx_source_folder
                                    logger.info(
                                        "Auto-asked: ctx_source_folder=%r", ctx_source_folder
                                    )
            elif tool_name == "smart_drive_build":
                if not tool_input.get("files") and ctx_scan_files:
                    tool_input["files"] = ctx_scan_files
                    logger.info(
                        "Injected %d files → smart_drive_build.files", len(ctx_scan_files)
                    )

            if tool_obj is None:
                err = f"Tool '{tool_name}' not found in tool list."
                yield {
                    "type": "tool_error",
                    "step_id": step_id,
                    "tool": tool_name,
                    "error": err,
                    "message": f"Error: {err}",
                }
                result = f"[Error] {err}"
            else:
                yield {
                    "type": "tool_call",
                    "step_id": step_id,
                    "tool": tool_name,
                    "input": tool_input,
                    "message": f"Calling tool: {tool_name}({_input_preview(tool_input)})",
                }
                result = await _call_tool(tool_obj, tool_input)
                is_error = result.startswith("[Error]")
                yield {
                    "type": "tool_result",
                    "step_id": step_id,
                    "tool": tool_name,
                    "result": result,
                    "message": (
                        f"Error from {tool_name}: {result[8:80]}"
                        if is_error
                        else f"Tool {tool_name} returned a result"
                    ),
                }

                if not result.startswith("[Error]") and not result.startswith("[Rejected]"):
                    try:
                        parsed = json.loads(result)
                        if isinstance(parsed, dict):
                            step_outputs[step_id] = parsed
                        else:
                            # Scalar JSON (number, bool) — also expose as .answer/.raw
                            step_outputs[step_id] = {"answer": result, "raw": result, "value": parsed}
                    except (json.JSONDecodeError, TypeError):
                        # Plain string result (e.g. ask_user) — expose as .answer and .raw
                        step_outputs[step_id] = {"answer": result, "raw": result}

                if not result.startswith("[Error]") and not result.startswith("[Rejected]"):
                    if tool_name == "ask_user":
                        if step.get("input", {}).get("input_type") == "folder":
                            candidate = result.strip()
                            if candidate:
                                ctx_source_folder = candidate
                                logger.info(
                                    "Captured ctx_source_folder=%r from ask_user",
                                    ctx_source_folder,
                                )
                    elif tool_name == "smart_drive_scan":
                        try:
                            scan_data = json.loads(result)
                            if scan_data.get("success"):
                                analyzed = scan_data.get("files", [])
                                not_analyzed = scan_data.get("not_analyzed", [])
                                not_analyzed_dicts = [
                                    {
                                        "path": p,
                                        "filename": os.path.basename(p),
                                        "extension": os.path.splitext(p)[1].lower(),
                                    }
                                    for p in not_analyzed
                                ]
                                ctx_scan_files = analyzed + not_analyzed_dicts
                                logger.info(
                                    "Captured %d scan files (%d analyzed + %d not_analyzed)",
                                    len(ctx_scan_files), len(analyzed), len(not_analyzed_dicts),
                                )
                        except (json.JSONDecodeError, TypeError):
                            pass

        else:  # llm step
            step_prompt: str = step.get("prompt", step_desc)
            yield {
                "type": "llm_start",
                "step_id": step_id,
                "message": f"Thinking: {step_desc}…",
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

        step_results.append({"id": step_id, "description": step_desc, "result": result})
        yield {
            "type": "step_done",
            "step_id": step_id,
            "result": result,
            "message": f"Step {step_id} complete",
        }

        if result.startswith("[Rejected]"):
            yield {
                "type": "error",
                "message": f"Process stopped: step {step_id} was cancelled by the user.",
            }
            return
        if result.startswith("[Error]"):
            yield {
                "type": "error",
                "message": f"Process stopped: step {step_id} failed — {result[8:120]}",
            }
            return

    yield {
        "type": "status",
        "message": f"Completed all {total} steps. Writing final answer…",
    }
    final_chunks: list[str] = []
    try:
        async for chunk in _stream_synthesize(message, step_results, history):
            yield {"type": "final_chunk", "content": chunk, "message": chunk}
            final_chunks.append(chunk)
    except Exception as exc:
        logger.exception("Synthesis failed")
        yield {"type": "error", "message": f"Error in final synthesis: {exc}"}
        return

    final_response = "".join(final_chunks)
    add_message(api_key, chat_id, "assistant", final_response)
    yield {"type": "final", "response": final_response, "message": "Response complete"}
