"""
File Content Reader — agent tool that reads and understands the CONTENT of files.

Routing:
  image    → Groq Llama 4 Scout vision  (/api/ai/vision/llama-scout)
  audio    → Whisper transcription       (/api/ai/transcribe/whisper)
  video    → FFmpeg audio extract → Whisper transcription
             + middle-frame thumbnail → vision description
  document → text extraction (PyMuPDF / python-docx / plain text)
  other    → metadata only

Use this when the user asks WHAT is in a file, or when you need to understand
file contents to make decisions (organize, search, categorize).
Does NOT modify any files — read-only, no approval required.
"""
from __future__ import annotations

import io
import json
import logging
import os
import subprocess
import tempfile
from typing import Any

import requests

import utils.ai_gateway as ai_gateway

logger = logging.getLogger(__name__)

# ── Extension sets ────────────────────────────────────────────────────────────

_IMAGE_EXTS = frozenset({
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif",
    ".tiff", ".tif", ".heic", ".heif",
})
_AUDIO_EXTS = frozenset({
    ".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac",
    ".wma", ".opus", ".aiff",
})
_VIDEO_EXTS = frozenset({
    ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv",
    ".webm", ".m4v", ".mpeg", ".mpg",
})
_DOC_EXTS = frozenset({
    ".pdf", ".docx", ".doc", ".txt", ".md",
    ".html", ".htm", ".rtf", ".odt",
})

_MAX_AUDIO_SECONDS = 300   # cap audio/video transcription at 5 min
_MAX_DOC_CHARS = 2000      # characters returned from document


def _file_type(ext: str) -> str:
    ext = ext.lower()
    if ext in _IMAGE_EXTS: return "image"
    if ext in _AUDIO_EXTS: return "audio"
    if ext in _VIDEO_EXTS: return "video"
    if ext in _DOC_EXTS:   return "document"
    return "other"


def _ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


# ── per-type analyzers ────────────────────────────────────────────────────────

def _analyze_image(path: str, question: str | None) -> dict[str, Any]:
    try:
        from PIL import Image
        img = Image.open(path).convert("RGB")
        max_dim = 768
        if max(img.size) > max_dim:
            r = max_dim / max(img.size)
            img = img.resize((int(img.width * r), int(img.height * r)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=82)
        img_bytes = buf.getvalue()
    except Exception as exc:
        return {"error": f"Cannot open image: {exc}"}

    if question:
        prompt = (
            f"Answer this question about the image: {question}  "
            "Be specific and concise (80 words max)."
        )
    else:
        prompt = (
            "Describe this image in detail (80 words max). "
            "Cover: main subject, objects present, text visible, colors, setting."
        )

    try:
        resp = requests.post(
            f"{ai_gateway.get_url()}/api/ai/vision/llama-scout",
            files={"file": ("image.jpg", img_bytes, "image/jpeg")},
            data={"max_tokens": "120", "prompt": prompt},
            headers=ai_gateway.auth_headers(),
            timeout=(5, 90),
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "description": data.get("description", ""),
            "tags": data.get("tags", []),
        }
    except requests.exceptions.ConnectionError:
        return {"error": "AI Gateway offline"}
    except Exception as exc:
        return {"error": str(exc)}


def _transcribe_audio_bytes(filename: str, raw: bytes, question: str | None) -> dict[str, Any]:
    """Send raw audio bytes to the Whisper endpoint and return transcript."""
    try:
        resp = requests.post(
            f"{ai_gateway.get_url()}/api/ai/transcribe/whisper",
            files={"file": (filename, raw)},
            data={"max_new_tokens": "256"},
            headers=ai_gateway.auth_headers(),
            timeout=(10, 600),
        )
        resp.raise_for_status()
        data = resp.json()
        transcript = (data.get("transcription") or "").strip()
        result: dict[str, Any] = {"transcript": transcript}
        if question and transcript:
            # Surface a quick relevance hint so the agent doesn't have to re-read everything
            lower_t = transcript.lower()
            lower_q = question.lower()
            keywords = [w for w in lower_q.split() if len(w) > 3]
            hits = [kw for kw in keywords if kw in lower_t]
            result["question_keywords_found"] = hits
        return result
    except requests.exceptions.ConnectionError:
        return {"error": "AI Gateway offline"}
    except Exception as exc:
        return {"error": str(exc)}


def _analyze_audio(path: str, question: str | None) -> dict[str, Any]:
    try:
        file_size = os.path.getsize(path)
    except OSError:
        file_size = 0

    # For very large files, extract the first N seconds with FFmpeg
    if file_size > 30 * 1024 * 1024:  # > 30 MB
        tmp = tempfile.mktemp(suffix=".wav")
        try:
            subprocess.run(
                [_ffmpeg_exe(), "-y", "-i", path, "-t", str(_MAX_AUDIO_SECONDS),
                 "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", tmp],
                capture_output=True, timeout=120,
            )
            with open(tmp, "rb") as fh:
                raw = fh.read()
        except Exception as exc:
            return {"error": f"Audio extraction failed: {exc}"}
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    else:
        try:
            with open(path, "rb") as fh:
                raw = fh.read()
        except Exception as exc:
            return {"error": f"Cannot read file: {exc}"}

    return _transcribe_audio_bytes(os.path.basename(path), raw, question)


def _analyze_video(path: str, question: str | None) -> dict[str, Any]:
    """Extract audio → Whisper transcript + middle frame → vision description."""
    result: dict[str, Any] = {}
    ffmpeg = _ffmpeg_exe()

    # ── 1. Audio track → Whisper ──────────────────────────────────────────────
    audio_tmp = tempfile.mktemp(suffix=".wav")
    try:
        proc = subprocess.run(
            [ffmpeg, "-y", "-i", path,
             "-t", str(_MAX_AUDIO_SECONDS),
             "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
             audio_tmp],
            capture_output=True, timeout=180,
        )
        if proc.returncode == 0 and os.path.isfile(audio_tmp):
            with open(audio_tmp, "rb") as fh:
                raw_audio = fh.read()
            audio_result = _transcribe_audio_bytes(
                os.path.basename(path) + ".wav", raw_audio, question
            )
            result["transcript"] = audio_result.get("transcript", "")
            if "question_keywords_found" in audio_result:
                result["question_keywords_found"] = audio_result["question_keywords_found"]
            if "error" in audio_result:
                result["audio_error"] = audio_result["error"]
        else:
            result["audio_error"] = "FFmpeg could not extract audio (no audio track?)"
    except subprocess.TimeoutExpired:
        result["audio_error"] = "Audio extraction timed out"
    except FileNotFoundError:
        result["audio_error"] = "FFmpeg not found — install FFmpeg and add it to PATH"
    except Exception as exc:
        result["audio_error"] = str(exc)
    finally:
        if os.path.exists(audio_tmp):
            os.remove(audio_tmp)

    # ── 2. Middle frame → vision ──────────────────────────────────────────────
    frame_tmp = tempfile.mktemp(suffix=".jpg")
    try:
        # Get duration first
        probe = subprocess.run(
            [ffmpeg, "-i", path],
            capture_output=True, text=True, timeout=10,
        )
        duration = 0.0
        for line in probe.stderr.splitlines():
            if "Duration:" in line:
                parts = line.split("Duration:")[1].split(",")[0].strip().split(":")
                try:
                    h, m, s = parts
                    duration = float(h) * 3600 + float(m) * 60 + float(s)
                except Exception:
                    pass
                break

        seek_pos = max(0, min(duration / 2, _MAX_AUDIO_SECONDS / 2))

        subprocess.run(
            [ffmpeg, "-y", "-ss", str(seek_pos), "-i", path,
             "-frames:v", "1", "-f", "image2", frame_tmp],
            capture_output=True, timeout=30,
        )
        if os.path.isfile(frame_tmp):
            vision_q = question or "Describe the scene visible in this video frame."
            result["thumbnail_description"] = _analyze_image(frame_tmp, vision_q)
    except Exception as exc:
        result["thumbnail_error"] = str(exc)
    finally:
        if os.path.exists(frame_tmp):
            os.remove(frame_tmp)

    if not result:
        return {"error": "Could not analyze video — check FFmpeg installation"}
    return result


def _analyze_document(path: str, question: str | None) -> dict[str, Any]:
    try:
        from tools.document_analytics import extract_text
        text = (extract_text(path) or "").strip()
    except Exception as exc:
        # Fallback for plain text files
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read(4096).strip()
        except Exception:
            return {"error": f"Cannot read document: {exc}"}

    if not text:
        return {"error": "No extractable text found in document"}

    preview = text[:_MAX_DOC_CHARS]
    if len(text) > _MAX_DOC_CHARS:
        preview += f"\n… ({len(text) - _MAX_DOC_CHARS} more characters)"

    result: dict[str, Any] = {"text_preview": preview}

    if question:
        lower_t = text.lower()
        keywords = [w for w in question.lower().split() if len(w) > 3]
        result["question_keywords_found"] = [kw for kw in keywords if kw in lower_t]

    return result


# ── main dispatcher ───────────────────────────────────────────────────────────

def _analyze_file(path: str, question: str | None) -> dict[str, Any]:
    if not os.path.isfile(path):
        return {"path": path, "error": f"File not found: {path}"}

    ext = os.path.splitext(path)[1].lower()
    ftype = _file_type(ext)

    try:
        size = os.path.getsize(path)
    except OSError:
        size = 0

    base: dict[str, Any] = {
        "path": path,
        "filename": os.path.basename(path),
        "type": ftype,
        "size_bytes": size,
    }

    ok, gw_err = ai_gateway.health_check()
    if not ok and ftype in ("image", "audio", "video"):
        return {**base, "error": f"AI Gateway unavailable: {gw_err}"}

    if ftype == "image":
        base["content"] = _analyze_image(path, question)
    elif ftype == "audio":
        base["content"] = _analyze_audio(path, question)
    elif ftype == "video":
        base["content"] = _analyze_video(path, question)
    elif ftype == "document":
        base["content"] = _analyze_document(path, question)
    else:
        base["content"] = {"note": "Unsupported type — only metadata returned"}

    return base


# ── tool interface ────────────────────────────────────────────────────────────

DEFINITION = {
    "name": "file_content_reader",
    "description": (
        "Read and understand the CONTENT of files using AI. "
        "Automatically picks the best approach by file type:\n"
        "  • image  → vision AI describes objects, text, and scene\n"
        "  • audio  → Whisper transcribes speech\n"
        "  • video  → Whisper transcribes the audio track; vision describes a key frame\n"
        "  • document/text → extracts readable text\n"
        "Use this when the user asks what a file contains, or when you need to understand "
        "content to decide how to organize, label, or respond about specific files. "
        "Read-only — does not modify any files."
    ),
    "input_instructions": (
        "files: list of {path, question?} objects — each 'path' is an absolute file path. "
        "Optionally include a 'question' per file (e.g. 'does this mention invoices?'). "
        "question (top-level): a global question applied to all files that don't have their own. "
        "Alternatively, use the shorthand filePath + question for a single file. "
        "Tip: call drive_inspector first to get the list of file paths inside a drive, "
        "then pass those paths here."
    ),
    "output_description": (
        "JSON {success, results: [{path, filename, type, size_bytes, content: {...}, error?}]}. "
        "content varies by type: "
        "image → {description, tags}; "
        "audio → {transcript, question_keywords_found?}; "
        "video → {transcript, thumbnail_description, question_keywords_found?}; "
        "document → {text_preview, question_keywords_found?}."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "description": "List of files to analyze.",
                "items": {
                    "type": "object",
                    "properties": {
                        "path":     {"type": "string", "description": "Absolute file path."},
                        "question": {"type": "string", "description": "Optional targeted question."},
                    },
                    "required": ["path"],
                },
            },
            "filePath": {
                "type": "string",
                "description": "Shorthand: single file path (used when files list is omitted).",
            },
            "question": {
                "type": "string",
                "description": "Global question applied to every file (e.g. 'what animals are visible?').",
            },
        },
        "required": [],
    },
}


def execute(input_data: dict) -> str:
    files: list[dict] = input_data.get("files") or []
    global_question: str | None = input_data.get("question") or None

    # Shorthand: single filePath field
    if not files:
        fp = (input_data.get("filePath") or "").strip()
        if fp:
            files = [{"path": fp}]

    if not files:
        return json.dumps({"success": False, "error": "Provide 'files' list or 'filePath'."})

    results = []
    for item in files:
        # Accept both {"path": "...", "question": "..."} and bare "path" strings
        if isinstance(item, str):
            path = item.strip()
            question = global_question
        else:
            path = (item.get("path") or "").strip()
            question = item.get("question") or global_question
        if not path:
            results.append({"error": "Empty path"})
            continue
        results.append(_analyze_file(path, question))

    return json.dumps({"success": True, "results": results}, ensure_ascii=False)
