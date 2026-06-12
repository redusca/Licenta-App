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
import shutil
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from config import APP_VERSION
from migrations import get_latest_schema_version
import requests

_DATA_DIR = Path(__file__).parent.parent.parent / "data"
_TOOL_DRIVES_PATH = _DATA_DIR / "tool_drives.json"

_CONFIG_FILENAME = ".drive_config.json"
SUPPORTED_INPUT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
OUTPUT_FORMATS = {"png"}

# Cached path to a system Python that has rembg+onnxruntime installed
_PYTHON_EXE_CACHE: str | None = None
_PYTHON_EXE_SEARCHED = False


def _find_python_with_rembg() -> str | None:
    """Find a Python interpreter (outside this bundle) that has rembg available."""
    global _PYTHON_EXE_CACHE, _PYTHON_EXE_SEARCHED
    if _PYTHON_EXE_SEARCHED:
        return _PYTHON_EXE_CACHE

    _PYTHON_EXE_SEARCHED = True

    candidates: list[str] = []

    # When NOT bundled, the current interpreter already works — no need to spawn
    if not getattr(sys, "frozen", False):
        _PYTHON_EXE_CACHE = sys.executable
        return _PYTHON_EXE_CACHE

    # PATH lookup
    for name in ("python", "python3", "py"):
        found = shutil.which(name)
        if found:
            candidates.append(found)

    # Common Windows per-user install locations
    local_app = os.environ.get("LOCALAPPDATA", "")
    for ver in ("Python313", "Python312", "Python311", "Python310", "Python39"):
        p = os.path.join(local_app, "Programs", "Python", ver, "python.exe")
        candidates.append(p)

    # System-wide installs
    for ver in ("313", "312", "311", "310", "39"):
        candidates.append(rf"C:\Python{ver}\python.exe")

    seen: set[str] = set()
    for exe in candidates:
        if not exe or exe in seen:
            continue
        seen.add(exe)
        if not os.path.isfile(exe):
            continue
        try:
            r = subprocess.run(
                [exe, "-c", "import rembg, onnxruntime"],
                capture_output=True,
                timeout=15,
            )
            if r.returncode == 0:
                _PYTHON_EXE_CACHE = exe
                return exe
        except Exception:
            pass

    return None


# The background-removal logic executed in the subprocess
_REMBG_SCRIPT = """\
import sys
from PIL import Image
from rembg import remove

src, dst, preserve = sys.argv[1], sys.argv[2], sys.argv[3] == 'true'
img = Image.open(src)
out = remove(img)
kw = {}
if preserve:
    try:
        ex = img.info.get('exif')
        if ex:
            kw['exif'] = ex
    except Exception:
        pass
out.save(dst, format='PNG', **kw)
"""


def _remove_background_subprocess(
    src_path: str,
    dst_path: str,
    preserve_metadata: bool = True,
) -> None:
    python_exe = _find_python_with_rembg()
    if not python_exe:
        raise RuntimeError(
            "rembg requires onnxruntime, which could not be loaded in this environment. "
            "Make sure Python with 'rembg' installed is available on your PATH."
        )

    result = subprocess.run(
        [python_exe, "-c", _REMBG_SCRIPT, src_path, dst_path,
         "true" if preserve_metadata else "false"],
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0 or not os.path.isfile(dst_path):
        detail = (result.stderr or "").strip()[-500:]
        raise RuntimeError(f"Background removal failed: {detail or 'unknown error'}")


def _ensure_model(model_name: str = "u2net") -> None:
    try:
        user_home = Path.home()
        rembg_home = user_home / ".u2net"
        model_path = rembg_home / f"{model_name}.onnx"

        if model_path.exists() and model_path.stat().st_size > 0:
            return

        print(f"Downloading {model_name} model to {model_path}...")
        rembg_home.mkdir(parents=True, exist_ok=True)

        url = f"https://github.com/danielgatis/rembg/releases/download/v0.0.0/{model_name}.onnx"
        response = requests.get(url, stream=True, timeout=60)
        response.raise_for_status()

        with open(model_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"Downloaded {model_name} successfully.")
    except Exception as e:
        print(f"Warning: Failed to pre-download rembg model: {e}")


DEFINITION = {
    "name": "remove_background",
    "description": (
        "Batch-remove backgrounds from images using AI (rembg). Output is always PNG with a transparent background. "
        "Use this when the user wants to isolate subjects, remove image backgrounds, create product photos "
        "on transparent backgrounds, or prepare images for compositing. "
        "Supported inputs: JPEG, PNG, WebP."
    ),
    "input_instructions": (
        "files: array of {path} — provide file paths directly if you already have them (e.g. from a prior tool's output). "
        "Only call ask_user(input_type='file') when the user has not yet specified which files to process. "
        "CHAINING: if a previous tool (e.g. image_converter) returned a result, extract each item's outputPath "
        "and pass them as [{\"path\": outputPath}, ...] — do NOT call ask_user again. "
        "Output is always PNG with a transparent background — no outputFormat needed in files objects. "
        "outputMode: 'copy' is recommended (keeps originals alongside the new PNG); "
        "'replace' overwrites the original file; 'virtual_drive' saves to a new virtual drive. "
        "outputPath: required only for virtual_drive — use ask_user(input_type='folder') to pick a folder. "
        "preserveMetadata: set to false only if the user specifically does not want EXIF data copied."
    ),
    "output_description": (
        "JSON {success, total, succeeded, failed, results:[{path, outputPath, success, error?}], virtualDrivePath?}. "
        "CHAINING: each result's outputPath is the produced PNG file — pass it directly as the 'path' "
        "in the next tool's files array without calling ask_user."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "description": 'List of image file objects: [{"path": "C:\\\\...\\\\photo.jpg"}]',
                "items": {"type": "object"},
            },
            "outputMode": {
                "type": "string",
                "enum": ["replace", "copy", "virtual_drive"],
                "description": (
                    "'copy' saves the transparent PNG alongside the original (recommended). "
                    "'replace' overwrites the original. "
                    "'virtual_drive' saves into a new virtual drive (requires outputPath)."
                ),
            },
            "outputPath": {
                "type": "string",
                "description": "Parent directory for the virtual drive (only for virtual_drive mode).",
            },
            "preserveMetadata": {
                "type": "boolean",
                "description": "Copy EXIF metadata from the source to the output PNG (default true).",
            },
        },
        "required": ["files", "outputMode"],
    },
}


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


def _remove_background(
    src_path: str,
    dst_path: str,
    preserve_metadata: bool = True,
) -> None:
    # When running inside a PyInstaller bundle, onnxruntime native DLLs may not
    # be loadable — delegate to the system Python which has them properly installed.
    if getattr(sys, "frozen", False):
        _remove_background_subprocess(src_path, dst_path, preserve_metadata)
        return

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
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    counter = 1
    while os.path.exists(path):
        path = f"{stem}_{counter}{ext}"
        counter += 1
    return path


def execute(input: dict) -> str:
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


def _process_single_item(
    item: dict,
    output_mode: str,
    virtual_drive_path: str | None,
    preserve_metadata: bool,
) -> dict:
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

    if output_mode == "replace":
        workers = 1
    else:
        workers = min(max_workers, len(files))

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
