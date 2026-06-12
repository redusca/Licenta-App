"""
Smart Drive Scanner — agent tool that scans a directory using NTFS MFT and
analyzes each file with AI (Groq Llama 4 Scout for images, Whisper for audio,
text extraction for documents) so the agent can decide which files belong in
a virtual drive.
"""
from __future__ import annotations

import io
import json
import logging
import os
from typing import Any

import requests

import utils.ai_gateway as ai_gateway

logger = logging.getLogger(__name__)

# ── Extension categories ──────────────────────────────────────────────────────

_IMAGE_EXTS = frozenset({".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif", ".heic", ".heif", ".avif", ".raw", ".cr2", ".cr3", ".nef", ".dng", ".arw"})
_AUDIO_EXTS = frozenset({".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac", ".wma", ".mka", ".opus", ".aiff", ".aif", ".ape", ".wv", ".alac"})
_DOC_EXTS   = frozenset({".pdf", ".docx", ".doc", ".txt", ".md", ".html", ".htm", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".csv", ".rtf", ".epub"})
_VIDEO_EXTS = frozenset({".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts", ".m2ts", ".mts", ".3gp", ".vob", ".ogv", ".rm", ".rmvb"})

_MAX_FILES   = 500   # hard cap on files collected by the scan
_DEFAULT_MAX_ANALYZE = 50


def _file_type(ext: str) -> str:
    ext = ext.lower()
    if ext in _IMAGE_EXTS: return "image"
    if ext in _AUDIO_EXTS: return "audio"
    if ext in _DOC_EXTS:   return "document"
    if ext in _VIDEO_EXTS: return "video"
    return "other"


# ── AI analysis helpers ───────────────────────────────────────────────────────

def _analyze_image(path: str) -> dict[str, Any]:
    """Send image thumbnail to Groq Llama 4 Scout via the AI Gateway."""
    try:
        from PIL import Image
        img = Image.open(path).convert("RGB")
        max_dim = 512
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        img_bytes = buf.getvalue()
    except Exception as exc:
        return {"ai_description": None, "ai_tags": [], "ai_error": f"PIL error: {exc}"}

    try:
        resp = requests.post(
            f"{ai_gateway.get_url()}/api/ai/vision/llama-scout",
            files={"file": ("thumb.jpg", img_bytes, "image/jpeg")},
            data={
                "max_tokens": "80",
                "prompt": (
                    "Describe this image in 50 words or fewer. "
                    "Focus on the main subject, objects, and setting. "
                    "Be concise and factual."
                ),
            },
            headers=ai_gateway.auth_headers(),
            timeout=(5, 60),
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "ai_description": data.get("description", ""),
            "ai_tags": data.get("tags", []),
            "ai_error": None,
        }
    except requests.exceptions.ConnectionError:
        return {"ai_description": None, "ai_tags": [], "ai_error": "AI Gateway offline"}
    except Exception as exc:
        return {"ai_description": None, "ai_tags": [], "ai_error": str(exc)}


def _analyze_audio(path: str) -> dict[str, Any]:
    """Transcribe audio using the Whisper endpoint on the AI Gateway."""
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        resp = requests.post(
            f"{ai_gateway.get_url()}/api/ai/transcribe/whisper",
            files={"file": (os.path.basename(path), raw)},
            data={"max_new_tokens": "128"},
            headers=ai_gateway.auth_headers(),
            timeout=(10, 300),
        )
        resp.raise_for_status()
        data = resp.json()
        transcription = data.get("transcription", "")
        return {
            "ai_description": transcription[:400] if transcription else None,
            "ai_tags": [],
            "ai_error": None,
        }
    except requests.exceptions.ConnectionError:
        return {"ai_description": None, "ai_tags": [], "ai_error": "AI Gateway offline"}
    except Exception as exc:
        return {"ai_description": None, "ai_tags": [], "ai_error": str(exc)}


def _analyze_document(path: str) -> dict[str, Any]:
    """Extract a short text snippet from a document using existing utilities."""
    try:
        from tools.document_analytics import extract_text
        text = extract_text(path)
        snippet = text[:300].strip() if text else None
        return {"ai_description": snippet, "ai_tags": [], "ai_error": None}
    except Exception as exc:
        return {"ai_description": None, "ai_tags": [], "ai_error": str(exc)}


# ── MFT / filesystem scan ─────────────────────────────────────────────────────

def _scan_with_mft(source_folder: str, target_extensions: set[str]) -> list[str]:
    """Scan using NTFS MFT (primary). Returns list of absolute file paths."""
    from utils.mft_scan import _ensure_cached, invalidate_cache, is_admin as _mft_is_admin

    drive_letter = os.path.splitdrive(source_folder)[0].replace(":", "") or "C"
    invalidate_cache(drive_letter)
    cached = _ensure_cached(drive_letter)

    n_records = len(cached.get("records", [])) if cached else 0
    if not cached or n_records == 0:
        raise RuntimeError("MFT scan returned 0 records — run as Administrator")
    if n_records < 50 or not _mft_is_admin():
        raise RuntimeError(
            f"MFT scan requires Administrator privileges "
            f"(only {n_records} records readable, expected thousands)"
        )

    records  = cached["records"]
    path_map = cached["path_map"]
    norm_src = os.path.normpath(source_folder).lower()
    if not norm_src.endswith("\\"):
        norm_src += "\\"

    matched: list[str] = []
    for r in records:
        if r.get("is_dir"):
            continue
        rn = r.get("record_num")
        if rn not in path_map:
            continue
        full_path = path_map[rn]
        if not full_path.lower().startswith(norm_src):
            continue
        ext = os.path.splitext(r.get("name", ""))[1].lower()
        if ext in target_extensions:
            matched.append(full_path)
            if len(matched) >= _MAX_FILES:
                break
    return matched



# ── Tool definition and executor ─────────────────────────────────────────────

DEFINITION = {
    "name": "smart_drive_scan",
    "description": (
        "Scan a directory for files matching specified extensions using NTFS MFT, "
        "then analyze each file with AI: Groq Llama 4 Scout vision for images, "
        "Whisper transcription for audio, and text extraction for documents. "
        "Returns a rich file list with AI descriptions so the agent can decide "
        "which files belong in a virtual drive."
    ),
    "input_instructions": (
        "sourceFolder: the root directory to scan — use ask_user(input_type='folder') to let the user pick it. "
        "extensions: list of file extensions to search for — choose based on the user's intent:\n"
        "  Photos/Images: ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif', '.raw', '.cr2', '.nef', '.dng']\n"
        "  Music/Audio:   ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma', '.mka', '.opus', '.aiff', '.aif', '.ape', '.alac']\n"
        "  Videos:        ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.m2ts', '.3gp', '.vob']\n"
        "  Documents:     ['.pdf', '.docx', '.doc', '.pptx', '.xlsx', '.xls', '.txt', '.md', '.odt', '.epub', '.csv']\n"
        "  All media:     combine Photos + Music + Videos lists above.\n"
        "maxAnalyze: max number of files to AI-analyze (default 50, max 200). "
        "The tool uses NTFS MFT for fast full-drive scanning — run the app as Administrator."
    ),
    "output_description": (
        "JSON object: {total_found, analyzed, scan_method, files: [...], not_analyzed: [...]}. "
        "IMPORTANT — chaining to smart_drive_build: "
        "Each item in 'files' has {path, filename, type, ai_description, ai_tags}. "
        "To build the drive you MUST read ALL items from 'files', filter them based on "
        "ai_description matching the user's intent, and pass the matching ones as the "
        "'files' parameter of smart_drive_build — copying 'path' and 'ai_description' "
        "from each matching item. Do NOT pass an empty files list."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sourceFolder": {
                "type": "string",
                "description": "Absolute path to the root directory to scan.",
            },
            "extensions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "File extensions to include, e.g. [\".jpg\", \".png\", \".mp3\"].",
            },
            "maxAnalyze": {
                "type": "integer",
                "description": "Max files to AI-analyze (default 50).",
            },
        },
        "required": ["sourceFolder", "extensions"],
    },
}


def execute(input_data: dict) -> str:
    source_folder = input_data.get("sourceFolder", "")
    extensions    = input_data.get("extensions", [])
    max_analyze   = int(input_data.get("maxAnalyze", _DEFAULT_MAX_ANALYZE))
    max_analyze   = min(max_analyze, 200)

    if not source_folder:
        return json.dumps({"success": False, "error": "sourceFolder is required."})
    # Normalise: accept C:/ C:\ C: and resolve to the real path
    source_folder = source_folder.replace("/", "\\").rstrip("\\")
    # For root drives like "C:" add back the trailing backslash
    if len(source_folder) == 2 and source_folder[1] == ":":
        source_folder += "\\"
    try:
        source_folder = os.path.realpath(source_folder)
    except Exception:
        pass
    if not os.path.isdir(source_folder):
        return json.dumps({"success": False, "error": f"Folder not found: {source_folder}"})
    if not extensions:
        return json.dumps({"success": False, "error": "extensions list is required."})

    target_exts = set(
        ext.lower() if ext.startswith(".") else f".{ext}".lower()
        for ext in extensions
    )

    # 1. Scan via NTFS MFT (requires admin — no fallback).
    try:
        matched = _scan_with_mft(source_folder, target_exts)
        scan_method = "mft"
    except Exception as mft_err:
        return json.dumps({
            "success": False,
            "error": (
                f"NTFS MFT scan failed: {mft_err}. "
                "The app must run as Administrator for file scanning. "
                "Please restart the app — it will prompt for elevation automatically."
            ),
        })

    if not matched:
        return json.dumps({
            "success": True,
            "total_found": 0,
            "analyzed": 0,
            "scan_method": scan_method,
            "files": [],
            "not_analyzed": [],
            "message": "No files matching the given extensions were found in the folder.",
        })

    # 2. Analyze first `max_analyze` files with AI
    to_analyze = matched[:max_analyze]
    not_analyzed = matched[max_analyze:]

    analyzed_files: list[dict] = []
    for fpath in to_analyze:
        try:
            size = os.path.getsize(fpath)
        except OSError:
            size = 0
        ext  = os.path.splitext(fpath)[1].lower()
        ftype = _file_type(ext)

        entry: dict[str, Any] = {
            "path":      fpath,
            "filename":  os.path.basename(fpath),
            "extension": ext,
            "size_bytes": size,
            "type":      ftype,
            "ai_description": None,
            "ai_tags":   [],
            "ai_error":  None,
        }

        if ftype == "image":
            entry.update(_analyze_image(fpath))
        elif ftype == "audio":
            entry.update(_analyze_audio(fpath))
        elif ftype == "document":
            entry.update(_analyze_document(fpath))
        # video / other: no AI analysis, just metadata

        analyzed_files.append(entry)

    return json.dumps({
        "success": True,
        "total_found": len(matched),
        "analyzed": len(analyzed_files),
        "scan_method": scan_method,
        "files": analyzed_files,
        "not_analyzed": not_analyzed,
    }, ensure_ascii=False)
