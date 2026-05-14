"""
Video Compressor tool — reduce video file size using H.264 / H.265 encoding with configurable CRF.

Execution modes
---------------
replace        : overwrite the original file with the converted version.
copy           : place the converted file alongside the original (same folder).
virtual_drive  : copy converted files into the VideoCompressionResults virtual drive.
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
SUPPORTED_INPUT_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm"}

# ── Agent tool definition (used by /api/tools) ─────────────────────────────────

DEFINITION = {
    "name": "video_compressor",
    "description": (
        "Reduce video file size using H.264/H.265 with configurable CRF. "
        "Supports batch processing and output mode selection."
    ),
    "input_instructions": (
        "files: array of {path, codec?, crf?, maxResolution?, stripAudio?} — use ask_user(input_type='file') to pick each video from a virtual drive. "
        "codec: 'h264' (default) or 'h265'. crf: quality 0-51, default 28 (lower = better quality). "
        "maxResolution: 'original', '1080p', '720p', '480p', or '360p'. stripAudio: true to remove audio. "
        "outputMode: 'replace' overwrites original, 'copy' adds _compressed suffix, 'virtual_drive' saves to a new virtual drive. "
        "outputPath: required only for virtual_drive — use ask_user(input_type='folder') to pick a folder from the app's virtual drives."
    ),
    "output_description": (
        "JSON {success, total, succeeded, failed, results:[{path, outputPath, success, error?}], virtualDrivePath?} "
        "— output files are always MP4 format."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "description": 'List of objects: [{"path": "...", "codec": "h264", "crf": 28, "maxResolution": "original", "stripAudio": false}, ...]',
                "items": {"type": "object"},
            },
            "outputMode": {
                "type": "string",
                "enum": ["replace", "copy", "virtual_drive"],
                "description": "How to handle the compressed file.",
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
    for d in drives:
        if d.get("name") == name and d.get("tool") == tool:
            if d.get("path") != drive_path:
                d["path"] = drive_path
                _save_tool_drives(drives)
            return
    drives.append({"path": drive_path, "name": name, "tool": tool})
    _save_tool_drives(drives)

def _ensure_virtual_drive(output_path: str) -> str:
    drive_name = "VideoCompressionResults"
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
            "created_by_tool": "video_compressor",
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        subprocess.call(["attrib", "+h", config_path], shell=True)

    _register_tool_drive(drive_path, drive_name, "video_compressor")
    return drive_path

# ── Video processing ──────────────────────────────────────────────────────────

def _compress_video(
    src_path: str,
    dst_path: str,
    codec: str,
    crf: int,
    max_resolution: str,
    strip_audio: bool
) -> None:
    cmd = [
        _FFMPEG_EXE,
        "-y",               # Overwrite output
        "-i", src_path      # Input file
    ]
    
    # Codec setup
    if codec == "h265" or codec == "hevc":
        cmd.extend(["-c:v", "libx265"])
    else:
        cmd.extend(["-c:v", "libx264"])

    # CRF
    cmd.extend(["-crf", str(crf)])
    # preset to balance speed
    cmd.extend(["-preset", "fast"])

    # Resolution downscale
    if max_resolution != "original":
        scale_val = {
            "1080p": "1080",
            "720p": "720",
            "480p": "480",
            "360p": "360"
        }.get(max_resolution)
        if scale_val:
            cmd.extend(["-vf", f"scale=-2:{scale_val}"])

    # Audio handling
    if strip_audio:
        cmd.append("-an")
    else:
        cmd.extend(["-c:a", "aac", "-b:a", "128k"]) # Compress audio too
    
    cmd.append(dst_path)
    
    try:
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
        raise RuntimeError("ffmpeg is not installed or not in PATH.")

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

# ── Single item processing (used by parallel executor) ───────────────────────

def _process_single_item(
    item: dict,
    output_mode: str,
    virtual_drive_path: str | None,
) -> dict:
    src = item.get("path", "")
    codec = item.get("codec", "h264")
    crf = item.get("crf", 28)
    max_resolution = item.get("maxResolution", "original")
    strip_audio = item.get("stripAudio", False)

    if not src or not os.path.isfile(src):
        return {"path": src, "success": False, "error": "File not found"}

    ext = Path(src).suffix.lower()
    if ext not in SUPPORTED_INPUT_EXTENSIONS:
        return {"path": src, "success": False, "error": f"Unsupported format: {ext}"}

    stem = Path(src).stem

    try:
        if output_mode == "replace":
            # For safe replacement, write to tmp first
            tmp = src + ".vid_comp_tmp.mp4"
            _compress_video(src, tmp, codec, crf, max_resolution, strip_audio)
            os.remove(src)
            final = os.path.join(os.path.dirname(src), f"{stem}.mp4")
            final = _unique_path(final)
            os.rename(tmp, final)

        elif output_mode == "copy":
            candidate = os.path.join(os.path.dirname(src), f"{stem}_compressed.mp4")
            final = _unique_path(candidate)
            _compress_video(src, final, codec, crf, max_resolution, strip_audio)

        else:  # virtual_drive
            dest = os.path.join(virtual_drive_path, f"{stem}_compressed.mp4")  # type: ignore[arg-type]
            dest = _unique_path(dest)
            _compress_video(src, dest, codec, crf, max_resolution, strip_audio)
            final = dest

        return {"path": src, "outputPath": final, "success": True}
    except Exception as exc:
        return {"path": src, "success": False, "error": str(exc)}

def execute(input_data: dict) -> str:
    """Batch-compress videos synchronously."""
    return execute_parallel(input_data, max_workers=1)

def execute_parallel(input_data: dict, max_workers: int = 2) -> str:
    """Parallel batch-compress"""
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
