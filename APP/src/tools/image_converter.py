"""
Image Converter tool — batch-convert images between formats using Pillow.

Execution modes
---------------
replace        : overwrite the original file with the converted version.
copy           : place the converted file alongside the original (same folder).
virtual_drive  : copy converted files into the ImageConversionResults virtual drive
                 located at <output_path>/ImageConversionResults; creates the drive
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

# ── Paths ──────────────────────────────────────────────────────────────────────
# __file__ = APP/src/tools/image_converter.py → .parent x3 = APP/
_DATA_DIR = Path(__file__).parent.parent.parent / "data"
_TOOL_DRIVES_PATH = _DATA_DIR / "tool_drives.json"

_CONFIG_FILENAME = ".drive_config.json"
SUPPORTED_INPUT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif"}
OUTPUT_FORMATS = {"jpeg", "jpg", "png", "webp", "bmp", "tiff", "gif"}

# ── Agent tool definition (used by /api/tools) ─────────────────────────────────

DEFINITION = {
    "name": "image_converter",
    "description": (
        "Batch-convert image files between formats (JPEG, PNG, WebP, BMP, TIFF, GIF). "
        "Supports three output modes: replace originals, copy alongside, or virtual drive."
    ),
    "input_instructions": (
        "files: array of {path, outputFormat} — use ask_user(input_type='file') to pick each file from a virtual drive. "
        "outputFormat per file: 'jpeg', 'png', 'webp', 'bmp', 'tiff', or 'gif'. "
        "outputMode: 'replace' overwrites the original, 'copy' places result alongside, 'virtual_drive' saves into a new virtual drive. "
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
                "description": 'List of objects: [{"path": "...", "outputFormat": "png"}, ...]',
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
            "quality": {
                "type": "integer",
                "description": "JPEG/WebP lossy quality 1–100 (default 85).",
            },
            "preserveMetadata": {
                "type": "boolean",
                "description": "Copy EXIF metadata to JPEG/WebP outputs (default true).",
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


# ── Virtual drive creation ─────────────────────────────────────────────────────

def _ensure_virtual_drive(output_path: str) -> str:
    """
    Ensure the ImageConversionResults virtual drive exists inside output_path.
    Creates the folder + .drive_config.json if missing.
    Returns the full drive path.
    """
    drive_name = "ImageConversionResults"
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
            "created_by_tool": "image_converter",
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        subprocess.call(["attrib", "+h", config_path], shell=True)

    _register_tool_drive(drive_path, drive_name, "image_converter")
    return drive_path


# ── Single-image conversion ────────────────────────────────────────────────────

def _convert_image(
    src_path: str,
    out_format: str,
    dst_path: str,
    quality: int = 85,
    preserve_metadata: bool = True,
) -> None:
    """Open src_path, convert to out_format, save at dst_path."""
    try:
        from PIL import Image
    except ImportError:
        raise RuntimeError(
            "Pillow is not installed in the Python used by the backend. "
            "Open a terminal and run:  pip install Pillow"
        )

    fmt = out_format.upper()
    if fmt == "JPG":
        fmt = "JPEG"

    img = Image.open(src_path)

    # RGBA / palette → RGB required for JPEG and BMP
    if fmt in ("JPEG", "BMP") and img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    save_kwargs: dict = {}
    if fmt in ("JPEG", "WEBP"):
        save_kwargs["quality"] = quality
    if fmt == "JPEG":
        save_kwargs["optimize"] = True
        if preserve_metadata:
            try:
                exif_bytes = img.info.get("exif")
                if exif_bytes:
                    save_kwargs["exif"] = exif_bytes
            except Exception:
                pass

    img.save(dst_path, format=fmt, **save_kwargs)


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
    Batch-convert images.  Called by POST /api/tools/execute and
    POST /api/tools/image-converter/run.
    Returns a JSON string (for agent compatibility).
    """
    files: list = input.get("files", [])
    output_mode: str = input.get("outputMode", "copy")
    output_path: str = input.get("outputPath", "")
    quality: int = int(input.get("quality", 85))
    preserve_metadata: bool = bool(input.get("preserveMetadata", True))

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

        ext = "jpg" if raw_fmt == "jpeg" else raw_fmt
        stem = Path(src).stem

        try:
            if output_mode == "replace":
                tmp = src + ".img_conv_tmp"
                _convert_image(src, raw_fmt, tmp, quality, preserve_metadata)
                os.remove(src)
                final = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
                final = _unique_path(final)
                os.rename(tmp, final)

            elif output_mode == "copy":
                candidate = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
                # Don't overwrite the source if extension matches
                if os.path.normcase(candidate) == os.path.normcase(src):
                    candidate = f"{os.path.join(os.path.dirname(src), stem)}_copy.{ext}"
                final = _unique_path(candidate)
                _convert_image(src, raw_fmt, final, quality, preserve_metadata)

            else:  # virtual_drive
                dest = os.path.join(virtual_drive_path, f"{stem}.{ext}")  # type: ignore[arg-type]
                dest = _unique_path(dest)
                _convert_image(src, raw_fmt, dest, quality, preserve_metadata)
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
    quality: int,
    preserve_metadata: bool,
) -> dict:
    """Convert a single file and return its result dict."""
    src = item.get("path", "")
    raw_fmt = item.get("outputFormat", "").lower().lstrip(".")

    if not src or not os.path.isfile(src):
        return {"path": src, "success": False, "error": "File not found"}

    if raw_fmt not in OUTPUT_FORMATS:
        return {"path": src, "success": False, "error": f"Unsupported format: {raw_fmt}"}

    ext = "jpg" if raw_fmt == "jpeg" else raw_fmt
    stem = Path(src).stem

    try:
        if output_mode == "replace":
            tmp = src + ".img_conv_tmp"
            _convert_image(src, raw_fmt, tmp, quality, preserve_metadata)
            os.remove(src)
            final = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
            final = _unique_path(final)
            os.rename(tmp, final)

        elif output_mode == "copy":
            candidate = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
            if os.path.normcase(candidate) == os.path.normcase(src):
                candidate = f"{os.path.join(os.path.dirname(src), stem)}_copy.{ext}"
            final = _unique_path(candidate)
            _convert_image(src, raw_fmt, final, quality, preserve_metadata)

        else:  # virtual_drive
            dest = os.path.join(virtual_drive_path, f"{stem}.{ext}")  # type: ignore[arg-type]
            dest = _unique_path(dest)
            _convert_image(src, raw_fmt, dest, quality, preserve_metadata)
            final = dest

        return {"path": src, "outputPath": final, "success": True}
    except Exception as exc:
        return {"path": src, "success": False, "error": str(exc)}


def execute_parallel(input_data: dict, max_workers: int = 4) -> str:
    """
    Parallel batch-convert. Uses a thread pool for IO-bound Pillow work.
    Returns a JSON string with results in original order.
    """
    files: list = input_data.get("files", [])
    output_mode: str = input_data.get("outputMode", "copy")
    output_path: str = input_data.get("outputPath", "")
    quality: int = int(input_data.get("quality", 85))
    preserve_metadata: bool = bool(input_data.get("preserveMetadata", True))

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

    # For replace mode, run sequentially to avoid race conditions on same files
    if output_mode == "replace":
        workers = 1
    else:
        workers = min(max_workers, len(files))

    # Map future → index to preserve order
    results: list = [None] * len(files)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_idx = {
            pool.submit(
                _process_single_item,
                item, output_mode, virtual_drive_path, quality, preserve_metadata,
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
