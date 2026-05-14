"""
Video Converter tool — batch-convert videos between formats using FFmpeg.

Execution modes
---------------
replace        : overwrite the original file with the converted version.
copy           : place the converted file alongside the original (same folder).
virtual_drive  : copy converted files into the VideoConversionResults virtual drive
                 located at <output_path>/VideoConversionResults; creates the drive
                 (and registers it in tool_drives.json) if it does not already exist.
"""
from __future__ import annotations

import json
import os
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from config import APP_VERSION
from migrations import get_latest_schema_version
import imageio_ffmpeg

_FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()

# ── Paths ──────────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent.parent / "data"
_TOOL_DRIVES_PATH = _DATA_DIR / "tool_drives.json"

_CONFIG_FILENAME = ".drive_config.json"
SUPPORTED_INPUT_EXTENSIONS = {".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpeg", ".mpg"}
OUTPUT_FORMATS = {"mp4", "avi", "mkv", "mov", "wmv", "flv", "webm"}

# ── Agent tool definition (used by /api/tools) ─────────────────────────────────

DEFINITION = {
    "name": "video_converter",
    "description": (
        "Batch-convert video files between formats (MP4, AVI, MKV, MOV, WMV, FLV, WebM). "
        "Supports three output modes: replace originals, copy alongside, or virtual drive."
    ),
    "input_instructions": (
        "files: array of {path, outputFormat} — use ask_user(input_type='file') to pick each video from a virtual drive. "
        "outputFormat per file: 'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', or 'webm'. "
        "outputMode: 'replace' overwrites original, 'copy' places result alongside, 'virtual_drive' saves to a new virtual drive. "
        "outputPath: required only for virtual_drive — use ask_user(input_type='folder') to pick a folder from the app's virtual drives."
    ),
    "output_description": (
        "JSON {success, total, succeeded, failed, results:[{path, outputPath, success, error?}], virtualDrivePath?}"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "description": 'List of objects: [{"path": "...", "outputFormat": "mp4"}, ...]',
                "items": {"type": "object"},
            },
            "outputMode": {
                "type": "string",
                "enum": ["replace", "copy", "virtual_drive"],
                "description": "How to handle the converted file.",
            },
            "outputPath": {
                "type": "string",
                "description": "Parent directory for the virtual drive (only for virtual_drive mode).",
            },
        },
        "required": ["files", "outputMode"],
    },
}

# ── Tool-drives registry helpers ───────────────────────────────────────────────

def _load_tool_drives() -> list:
    if _TOOL_DRIVES_PATH.exists():
        try:
            return json.loads(_TOOL_DRIVES_PATH.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []

def _save_tool_drives(drives: list) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _TOOL_DRIVES_PATH.write_text(json.dumps(drives, indent=2), encoding="utf-8")

def _register_tool_drive(drive_path: str, name: str, tool: str) -> None:
    drives = _load_tool_drives()
    normalized_new = os.path.normcase(os.path.normpath(drive_path))
    for d in drives:
        existing = d.get("path", "")
        if existing and os.path.normcase(os.path.normpath(existing)) == normalized_new:
            return  # already registered
    drives.append({"path": drive_path, "name": name, "tool": tool})
    _save_tool_drives(drives)

# ── Virtual drive creation ─────────────────────────────────────────────────────

def _ensure_virtual_drive(output_path: str) -> str:
    """
    Ensure the VideoConversionResults virtual drive exists inside output_path.
    Creates the folder + .drive_config.json if missing.
    Returns the full drive path.
    """
    drive_name = "VideoConversionResults"
    drive_path = os.path.join(output_path, drive_name)
    os.makedirs(drive_path, exist_ok=True)

    config_path = os.path.join(drive_path, _CONFIG_FILENAME)
    if not os.path.exists(config_path):
        config = {
            "schema_version": get_latest_schema_version(),
            "serial": str(uuid.uuid4()),
            "name": drive_name,
            "type": "move",
            "created_at": str(os.path.getctime(drive_path)),
            "app_version_created": APP_VERSION,
            "created_by_tool": "video_converter",
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        subprocess.call(["attrib", "+h", config_path], shell=True)

    _register_tool_drive(drive_path, drive_name, "video_converter")
    return drive_path

# ── Single-video conversion ────────────────────────────────────────────────────

def _convert_video(
    src_path: str,
    out_format: str,
    dst_path: str,
) -> None:
    """Invoke ffmpeg to convert video format."""
    cmd = [
        _FFMPEG_EXE,
        "-y",               # Overwrite output
        "-i", src_path,     # Input file
        # To avoid re-encoding if not strictly necessary, we could try `-c copy`,
        # but formats often require specific codecs. Doing a standard transcode is safer.
        dst_path
    ]
    
    try:
        # Run ffmpeg, capture output for debugging if it fails
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False
        )
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg failed with exit code {result.returncode}.\n{result.stderr}")
            
    except FileNotFoundError:
        raise RuntimeError(
            "ffmpeg is not installed or not in PATH. "
            "Please install ffmpeg to use the Video Converter."
        )

def _unique_path(path: str) -> str:
    """Return a non-colliding path by appending a numeric suffix if needed."""
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    counter = 1
    while os.path.exists(path):
        path = f"{stem}_{counter}{ext}"
        counter += 1
    return path

# ── Public executor ────────────────────────────────────────────────────────────

def execute(input: dict) -> str:
    """
    Batch-convert videos.
    Returns a JSON string (for agent compatibility).
    """
    files: list = input.get("files", [])
    output_mode: str = input.get("outputMode", "copy")
    output_path: str = input.get("outputPath", "")

    if not files:
        return json.dumps({"success": False, "error": "No files provided.", "results": []})

    virtual_drive_path: str | None = None
    if output_mode == "virtual_drive":
        if not output_path or not os.path.isdir(output_path):
            return json.dumps({
                "success": False,
                "error": f"Invalid output path for virtual drive: '{output_path}'",
                "results": [],
            })
        virtual_drive_path = _ensure_virtual_drive(output_path)

    results = []
    for item in files:
        src = item.get("path", "")
        raw_fmt = item.get("outputFormat", "").lower().lstrip(".")

        if not src or not os.path.isfile(src):
            results.append({"path": src, "success": False, "error": "File not found"})
            continue

        if raw_fmt not in OUTPUT_FORMATS:
            results.append({"path": src, "success": False, "error": f"Unsupported format: {raw_fmt}"})
            continue

        ext = raw_fmt
        stem = Path(src).stem

        try:
            if output_mode == "replace":
                tmp = src + ".vid_conv_tmp." + ext
                _convert_video(src, raw_fmt, tmp)
                os.remove(src)
                final = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
                final = _unique_path(final)
                os.rename(tmp, final)

            elif output_mode == "copy":
                candidate = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
                if os.path.normcase(candidate) == os.path.normcase(src):
                    candidate = f"{os.path.join(os.path.dirname(src), stem)}_copy.{ext}"
                final = _unique_path(candidate)
                _convert_video(src, raw_fmt, final)

            else:  # virtual_drive
                dest = os.path.join(virtual_drive_path, f"{stem}.{ext}")  # type: ignore[arg-type]
                dest = _unique_path(dest)
                _convert_video(src, raw_fmt, dest)
                final = dest

            results.append({"path": src, "outputPath": final, "success": True})
        except Exception as exc:
            results.append({"path": src, "success": False, "error": str(exc)})

    succeeded = sum(1 for r in results if r["success"])
    response: dict = {
        "success": succeeded > 0,
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "results": results,
    }
    if virtual_drive_path:
        response["virtualDrivePath"] = virtual_drive_path

    return json.dumps(response)

# ── Single item processing (used by parallel executor) ───────────────────────

def _process_single_item(
    item: dict,
    output_mode: str,
    virtual_drive_path: str | None,
) -> dict:
    """Convert a single file and return its result dict."""
    src = item.get("path", "")
    raw_fmt = item.get("outputFormat", "").lower().lstrip(".")

    if not src or not os.path.isfile(src):
        return {"path": src, "success": False, "error": "File not found"}

    if raw_fmt not in OUTPUT_FORMATS:
        return {"path": src, "success": False, "error": f"Unsupported format: {raw_fmt}"}

    ext = raw_fmt
    stem = Path(src).stem

    try:
        if output_mode == "replace":
            tmp = src + ".vid_conv_tmp." + ext
            _convert_video(src, raw_fmt, tmp)
            os.remove(src)
            final = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
            final = _unique_path(final)
            os.rename(tmp, final)

        elif output_mode == "copy":
            candidate = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
            if os.path.normcase(candidate) == os.path.normcase(src):
                candidate = f"{os.path.join(os.path.dirname(src), stem)}_copy.{ext}"
            final = _unique_path(candidate)
            _convert_video(src, raw_fmt, final)

        else:  # virtual_drive
            dest = os.path.join(virtual_drive_path, f"{stem}.{ext}")  # type: ignore[arg-type]
            dest = _unique_path(dest)
            _convert_video(src, raw_fmt, dest)
            final = dest

        return {"path": src, "outputPath": final, "success": True}
    except Exception as exc:
        return {"path": src, "success": False, "error": str(exc)}

def execute_parallel(input_data: dict, max_workers: int = 2) -> str:
    """
    Parallel batch-convert. Uses a thread pool. Video conversion is CPU intensive,
    so we default to 2 workers to avoid choking the machine.
    Returns a JSON string with results in original order.
    """
    files: list = input_data.get("files", [])
    output_mode: str = input_data.get("outputMode", "copy")
    output_path: str = input_data.get("outputPath", "")

    if not files:
        return json.dumps({"success": False, "error": "No files provided.", "results": []})

    virtual_drive_path: str | None = None
    if output_mode == "virtual_drive":
        if not output_path or not os.path.isdir(output_path):
            return json.dumps({
                "success": False,
                "error": f"Invalid output path for virtual drive: '{output_path}'",
                "results": [],
            })
        virtual_drive_path = _ensure_virtual_drive(output_path)

    if output_mode == "replace":
        workers = 1
    else:
        workers = min(max_workers, len(files))

    results: list = [None] * len(files)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_idx = {
            pool.submit(
                _process_single_item,
                item, output_mode, virtual_drive_path,
            ): idx
            for idx, item in enumerate(files)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                results[idx] = {"path": files[idx].get("path", ""), "success": False, "error": str(exc)}

    succeeded = sum(1 for r in results if r and r["success"])
    response: dict = {
        "success": succeeded > 0,
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "results": results,
    }
    if virtual_drive_path:
        response["virtualDrivePath"] = virtual_drive_path

    return json.dumps(response)
