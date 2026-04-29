"""
Remove Background tool — batch-remove image backgrounds using rembg.

Execution modes
---------------
replace        : overwrite the original file with the converted version.
copy           : place the converted file alongside the original (same folder).
virtual_drive  : copy converted files into the RemovedBackgrounds virtual drive
                 located at <output_path>/RemovedBackgrounds; creates the drive
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
import requests

# ── Paths ──────────────────────────────────────────────────────────────────────
# __file__ = APP/src/tools/image_converter.py → .parent x3 = APP/
_DATA_DIR = Path(__file__).parent.parent.parent / "data"
_TOOL_DRIVES_PATH = _DATA_DIR / "tool_drives.json"

_CONFIG_FILENAME = ".drive_config.json"
SUPPORTED_INPUT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
OUTPUT_FORMATS = {"png"}

# ── Agent tool definition (used by /api/tools) ─────────────────────────────────

def _ensure_model(model_name: str = "u2net") -> None:
    """
    Ensure the rembg model is downloaded to ~/.u2net to avoid
    'fails to fetch' errors during execution due to timeouts or SSL issues.
    """
    try:
        user_home = Path.home()
        rembg_home = user_home / ".u2net"
        model_path = rembg_home / f"{model_name}.onnx"

        # Check if model exists and is not empty
        if model_path.exists() and model_path.stat().st_size > 0:
            return

        print(f"Downloading {model_name} model to {model_path}...")
        rembg_home.mkdir(parents=True, exist_ok=True)

        url = f"https://github.com/danielgatis/rembg/releases/download/v0.0.0/{model_name}.onnx"
        # Use a generous timeout for large file
        response = requests.get(url, stream=True, timeout=60)
        response.raise_for_status()

        with open(model_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"Downloaded {model_name} successfully.")
    except Exception as e:
        print(f"Warning: Failed to pre-download rembg model: {e}")
        # We don't raise here, let rembg try its own download method as backup.

DEFINITION = {
    "name": "remove_background",
    "description": (
        "Batch-remove backgrounds from images using rembg. "
        "Supports three output modes: replace originals, copy alongside, or virtual drive."
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
                "description": "JPEG/WebP lossy quality 1–100 (default 85). Ignored (output is PNG).",
            },
            "preserveMetadata": {
                "type": "boolean",
                "description": "Copy EXIF metadata to PNG outputs (default true).",
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
    Ensure the RemovedBackgrounds virtual drive exists inside output_path.
    Creates the folder + .drive_config.json if missing.
    Returns the full drive path.
    """
    drive_name = "RemovedBackgrounds"
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
            "created_by_tool": "remove_background",
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        subprocess.call(["attrib", "+h", config_path], shell=True)

    _register_tool_drive(drive_path, drive_name, "remove_background")
    return drive_path


# ── Single-image conversion ────────────────────────────────────────────────────

def _remove_background(
    src_path: str,
    dst_path: str,
    preserve_metadata: bool = True,
) -> None:
    """Open src_path, pass to rembg remove, save at dst_path."""
    try:
        from PIL import Image
    except ImportError:
        raise RuntimeError(
            "Pillow is not installed in the Python used by the backend. "
            "Open a terminal and run:  pip install Pillow"
        )
    try:
        from rembg import remove
    except ImportError:
        raise RuntimeError(
            "rembg is not installed. "
            "Open a terminal and run:  pip install rembg"
        )

    img = Image.open(src_path)
    output = remove(img)

    save_kwargs: dict = {}
    if preserve_metadata:
        try:
            exif_bytes = img.info.get("exif")
            if exif_bytes:
                save_kwargs["exif"] = exif_bytes
        except Exception:
            pass

    output.save(dst_path, format="PNG", **save_kwargs)


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
    Batch-remove backgrounds.  Called by POST /api/tools/execute and
    POST /api/tools/remove-background/run.
    Returns a JSON string (for agent compatibility).
    """
    _ensure_model()
    files: list = input.get("files", [])
    output_mode: str = input.get("outputMode", "copy")
    output_path: str = input.get("outputPath", "")
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

        ext = "png"
        stem = Path(src).stem

        try:
            if output_mode == "replace":
                tmp = src + ".img_rm_tmp"
                _remove_background(src, tmp, preserve_metadata)
                os.remove(src)
                final = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
                final = _unique_path(final)
                os.rename(tmp, final)

            elif output_mode == "copy":
                candidate = os.path.join(os.path.dirname(src), f"{stem}_nobg.{ext}")
                final = _unique_path(candidate)
                _remove_background(src, final, preserve_metadata)

            else:  # virtual_drive
                dest = os.path.join(virtual_drive_path, f"{stem}.{ext}")  # type: ignore[arg-type]
                dest = _unique_path(dest)
                _remove_background(src, dest, preserve_metadata)
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
    preserve_metadata: bool,
) -> dict:
    """Remove background of a single file and return its result dict."""
    src = item.get("path", "")

    if not src or not os.path.isfile(src):
        return {"path": src, "success": False, "error": "File not found"}

    ext = "png"
    stem = Path(src).stem

    try:
        if output_mode == "replace":
            tmp = src + ".img_rm_tmp"
            _remove_background(src, tmp, preserve_metadata)
            os.remove(src)
            final = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
            final = _unique_path(final)
            os.rename(tmp, final)

        elif output_mode == "copy":
            candidate = os.path.join(os.path.dirname(src), f"{stem}_nobg.{ext}")
            final = _unique_path(candidate)
            _remove_background(src, final, preserve_metadata)

        else:  # virtual_drive
            dest = os.path.join(virtual_drive_path, f"{stem}.{ext}")  # type: ignore[arg-type]
            dest = _unique_path(dest)
            _remove_background(src, dest, preserve_metadata)
            final = dest

        return {"path": src, "outputPath": final, "success": True}
    except Exception as exc:
        return {"path": src, "success": False, "error": str(exc)}

def execute_parallel(input_data: dict, max_workers: int = 4) -> str:
    """
    Parallel batch-remove. Uses a thread pool.
    Returns a JSON string with results in original order.
    """
    _ensure_model()
    files: list = input_data.get("files", [])
    output_mode: str = input_data.get("outputMode", "copy")
    output_path: str = input_data.get("outputPath", "")
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
                item, output_mode, virtual_drive_path, preserve_metadata,
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
