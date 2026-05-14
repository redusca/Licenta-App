"""
Image to SVG Vectorizer — batch-convert raster images to SVG vector files using vtracer.

Execution modes
---------------
replace        : overwrite the original file with the SVG (removes original raster).
copy           : place the SVG alongside the original (same folder).
virtual_drive  : copy SVG files into the SVGVectorResults virtual drive
                 located at <output_path>/SVGVectorResults; creates the drive
                 (and registers it in tool_drives.json) if it does not already exist.

Requires: pip install vtracer
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from config import APP_VERSION
from migrations import get_latest_schema_version

# ── Paths ──────────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent.parent / "data"
_TOOL_DRIVES_PATH = _DATA_DIR / "tool_drives.json"
_CONFIG_FILENAME = ".drive_config.json"

SUPPORTED_INPUT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# ── Agent tool definition (used by /api/tools) ─────────────────────────────────

DEFINITION = {
    "name": "image_to_svg",
    "description": (
        "Batch-convert raster images (JPEG, PNG, WebP, BMP) to SVG vector files using vtracer. "
        "Supports three output modes: replace originals, copy alongside, or virtual drive."
    ),
    "input_instructions": (
        "files: array of {path} — use ask_user(input_type='file') to pick each raster image from a virtual drive. "
        "Supported inputs: JPEG, PNG, WebP, BMP. Output is always SVG. "
        "outputMode: 'replace' removes original, 'copy' places SVG alongside, 'virtual_drive' saves to a new virtual drive. "
        "outputPath: required only for virtual_drive — use ask_user(input_type='folder') to pick a folder from the app's virtual drives. "
        "colormode: 'color' (default) or 'binary' (black-and-white)."
    ),
    "output_description": (
        "JSON {success, total, succeeded, failed, results:[{path, outputPath, success, svgContent?, error?}], virtualDrivePath?}"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "description": 'List of objects: [{"path": "..."}, ...]',
                "items": {"type": "object"},
            },
            "outputMode": {
                "type": "string",
                "enum": ["replace", "copy", "virtual_drive"],
                "description": "How to handle the output SVG file.",
            },
            "outputPath": {
                "type": "string",
                "description": "Parent directory for the virtual drive (only for virtual_drive mode).",
            },
            "colormode": {
                "type": "string",
                "enum": ["color", "binary"],
                "description": "Color mode: 'color' for full color, 'binary' for black-and-white (default: color).",
            },
            "hierarchical": {
                "type": "string",
                "enum": ["stacked", "cutout"],
                "description": "Layering mode for color SVG (default: stacked).",
            },
            "filterSpeckle": {
                "type": "integer",
                "description": "Noise/speckle filter threshold in pixels (default 4, higher = smoother).",
            },
            "colorPrecision": {
                "type": "integer",
                "description": "Number of significant bits for color quantisation 1-8 (default 6).",
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
    Ensure the SVGVectorResults virtual drive exists inside output_path.
    Creates the folder + .drive_config.json if missing.
    Returns the full drive path.
    """
    drive_name = "SVGVectorResults"
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
            "created_by_tool": "image_to_svg",
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        subprocess.call(["attrib", "+h", config_path], shell=True)

    _register_tool_drive(drive_path, drive_name, "image_to_svg")
    return drive_path


# ── Single-image conversion ────────────────────────────────────────────────────

def _vectorize_image(
    src_path: str,
    dst_path: str,
    colormode: str = "color",
    hierarchical: str = "stacked",
    filter_speckle: int = 4,
    color_precision: int = 6,
) -> str:
    """
    Convert src_path raster to SVG at dst_path using vtracer.
    Returns the SVG content as a string.
    """
    try:
        import vtracer
    except ImportError:
        raise RuntimeError(
            "vtracer is not installed in the Python used by the backend. "
            "Open a terminal and run:  pip install vtracer"
        )

    # vtracer (Rust/PyO3) panics on Windows backslash paths — normalize to forward slashes
    vtracer.convert_image_to_svg_py(
        src_path.replace('\\', '/'),
        dst_path.replace('\\', '/'),
        colormode=colormode,
        hierarchical=hierarchical,
        filter_speckle=filter_speckle,
        color_precision=color_precision,
        layer_difference=16,
        corner_threshold=60,
        length_threshold=4.0,
        max_iterations=10,
        splice_threshold=45,
        path_precision=8,
    )

    # Read the generated SVG so we can return it
    with open(dst_path, "r", encoding="utf-8") as f:
        svg_str = f.read()

    return svg_str


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


# ── Shared item processor ──────────────────────────────────────────────────────

def _process_single_item(
    item: dict,
    output_mode: str,
    virtual_drive_path: str | None,
    colormode: str,
    hierarchical: str,
    filter_speckle: int,
    color_precision: int,
) -> dict:
    """Vectorize a single file and return its result dict."""
    src = item.get("path", "")

    if not src or not os.path.isfile(src):
        return {"path": src, "success": False, "error": "File not found"}

    ext_in = Path(src).suffix.lower()
    if ext_in not in SUPPORTED_INPUT_EXTENSIONS:
        return {"path": src, "success": False, "error": f"Unsupported input format: {ext_in}"}

    stem = Path(src).stem

    try:
        if output_mode == "replace":
            tmp = src + ".svg_tmp"
            svg_content = _vectorize_image(src, tmp, colormode, hierarchical, filter_speckle, color_precision)
            os.remove(src)
            final = os.path.join(os.path.dirname(src), f"{stem}.svg")
            final = _unique_path(final)
            os.rename(tmp, final)

        elif output_mode == "copy":
            candidate = os.path.join(os.path.dirname(src), f"{stem}.svg")
            final = _unique_path(candidate)
            svg_content = _vectorize_image(src, final, colormode, hierarchical, filter_speckle, color_precision)

        else:  # virtual_drive
            dest = os.path.join(virtual_drive_path, f"{stem}.svg")  # type: ignore[arg-type]
            dest = _unique_path(dest)
            svg_content = _vectorize_image(src, dest, colormode, hierarchical, filter_speckle, color_precision)
            final = dest

        # Encode SVG as base64 for inline preview in the UI
        svg_b64 = base64.b64encode(svg_content.encode("utf-8")).decode("ascii")

        return {
            "path": src,
            "outputPath": final,
            "success": True,
            "svgContent": svg_content,
            "svgBase64": svg_b64,
        }
    except Exception as exc:
        return {"path": src, "success": False, "error": str(exc)}


# ── Public executor ────────────────────────────────────────────────────────────

def execute(input: dict) -> str:
    """
    Batch-vectorize images.  Called by POST /api/tools/execute and
    POST /api/tools/image-to-svg/run.
    Returns a JSON string (for agent compatibility).
    """
    files: list = input.get("files", [])
    output_mode: str = input.get("outputMode", "copy")
    output_path: str = input.get("outputPath", "")
    colormode: str = input.get("colormode", "color")
    hierarchical: str = input.get("hierarchical", "stacked")
    filter_speckle: int = int(input.get("filterSpeckle", 4))
    color_precision: int = int(input.get("colorPrecision", 6))

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
        result = _process_single_item(
            item, output_mode, virtual_drive_path,
            colormode, hierarchical, filter_speckle, color_precision,
        )
        results.append(result)

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


def execute_parallel(input_data: dict, max_workers: int = 4) -> str:
    """
    Parallel batch-vectorize. Uses a thread pool for IO-bound work.
    Returns a JSON string with results in original order.
    """
    files: list = input_data.get("files", [])
    output_mode: str = input_data.get("outputMode", "copy")
    output_path: str = input_data.get("outputPath", "")
    colormode: str = input_data.get("colormode", "color")
    hierarchical: str = input_data.get("hierarchical", "stacked")
    filter_speckle: int = int(input_data.get("filterSpeckle", 4))
    color_precision: int = int(input_data.get("colorPrecision", 6))

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

    # replace mode: sequential to avoid race conditions
    workers = 1 if output_mode == "replace" else min(max_workers, len(files))

    results: list = [None] * len(files)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_idx = {
            pool.submit(
                _process_single_item,
                item, output_mode, virtual_drive_path,
                colormode, hierarchical, filter_speckle, color_precision,
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
