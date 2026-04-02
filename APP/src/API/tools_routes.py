"""
Tool executor API — called by the agent container to execute tools locally.

The agent container never runs tool code itself.  When the LLM decides to
call a tool, the container POSTs to this endpoint.  The APP executes the
tool and returns the result; the container feeds it back to the LLM.

Endpoints
---------
POST /api/tools/execute
    Body: { "tool": "<name>", "input": { ...args } }
    Response: { "result": "<string>" }

GET /api/tools
    Returns the list of available tool definitions to register with the agent.
    Each definition includes a `callback_url` pointing back to this endpoint.

GET /api/tools/catalog
    Returns the full UI-facing tool catalog (tools + categories).
    The frontend fetches this once on startup to build the Tools page.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from flask import Blueprint, jsonify, request

from tools import hello as hello_tool
from tools import image_converter as image_converter_tool
from tools import remove_background as remove_background_tool
from tools import image_to_svg as image_to_svg_tool
from tools import video_converter as video_converter_tool
from tools import audio_converter as audio_converter_tool
from tools import drive_creator as drive_creator_tool
from tools import space_analyzer as space_analyzer_tool
from tools.catalog import TOOLS as CATALOG_TOOLS, CATEGORIES as CATALOG_CATEGORIES

logger = logging.getLogger(__name__)

tools_bp = Blueprint("tools", __name__)

# Path to the tool-drives registry written by image_converter
_TOOL_DRIVES_PATH = Path(__file__).parent.parent.parent / "data" / "tool_drives.json"

# ── Tool registry ─────────────────────────────────────────────────────────────
# Maps tool name → executor module.  Add new tools here.

_TOOLS: dict[str, object] = {
    "hello": hello_tool,
    "image_converter": image_converter_tool,
    "remove_background": remove_background_tool,
    "image_to_svg": image_to_svg_tool,
    "video_converter": video_converter_tool,
    "audio_converter": audio_converter_tool,
    "drive_creator": drive_creator_tool,
    "space_analyzer": space_analyzer_tool,
}


# ── Routes ────────────────────────────────────────────────────────────────────

@tools_bp.post("/execute")
def execute():
    """
    Execute a tool on behalf of the agent container.

    The container calls this when the LLM decides to invoke a tool.
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    tool_name: str = data.get("tool", "")
    tool_input: dict = data.get("input", {})

    tool = _TOOLS.get(tool_name)
    if tool is None:
        logger.warning("Unknown tool requested: %s", tool_name)
        return jsonify({"error": f"Unknown tool: '{tool_name}'"}), 404

    try:
        result: str = tool.execute(tool_input)
        logger.info("Tool '%s' executed successfully", tool_name)
        return jsonify({"result": result})
    except Exception as exc:
        logger.exception("Tool '%s' raised an error", tool_name)
        return jsonify({"error": f"Tool '{tool_name}' failed: {exc}"}), 500


@tools_bp.get("")
def list_tools():
    """
    Return tool definitions to register with the agent at session init.

    The caller should append `callback_url` pointing to this APP's
    /api/tools/execute endpoint before sending the list to the agent.
    """
    definitions = []
    for name, mod in _TOOLS.items():
        defn = dict(mod.DEFINITION)          # shallow copy so we don't mutate
        defn.setdefault("callback_url", "")  # caller fills this in
        definitions.append(defn)
    return jsonify(definitions)


@tools_bp.get("/catalog")
def get_catalog():
    """
    Return the full UI-facing tool catalog.

    Called by the frontend on startup to populate the Tools page.
    The catalog is built from tools/catalog.py which is loaded once
    when the backend starts.
    """
    return jsonify({
        "tools": CATALOG_TOOLS,
        "categories": CATALOG_CATEGORIES,
    })


@tools_bp.post("/image-converter/run")
def image_converter_run():
    """
    Direct frontend endpoint for the Image Converter tool.
    Uses parallel execution when more than 1 file is provided.

    Body: {
        "files": [{"path": "...", "outputFormat": "png"}, ...],
        "outputMode": "replace" | "copy" | "virtual_drive",
        "outputPath": "C:/...",   # required for virtual_drive mode
        "quality": 85,
        "preserveMetadata": true
    }
    Response: JSON with success, total, succeeded, failed, results, virtualDrivePath?
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        files = data.get("files", [])
        if len(files) > 1:
            raw = image_converter_tool.execute_parallel(data)
        else:
            raw = image_converter_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Image converter failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/remove-background/run")
def remove_background_run():
    """
    Direct frontend endpoint for the Remove Background tool.
    Uses parallel execution when more than 1 file is provided.

    Body: {
        "files": [{"path": "..."}, ...],
        "outputMode": "replace" | "copy" | "virtual_drive",
        "outputPath": "C:/...",   # required for virtual_drive mode
        "preserveMetadata": true
    }
    Response: JSON with success, total, succeeded, failed, results, virtualDrivePath?
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        files = data.get("files", [])
        if len(files) > 1:
            raw = remove_background_tool.execute_parallel(data)
        else:
            raw = remove_background_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Remove background failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/image-to-svg/run")
def image_to_svg_run():
    """
    Direct frontend endpoint for the Image to SVG Vectorizer tool.
    Uses parallel execution when more than 1 file is provided.

    Body: {
        "files": [{"path": "..."}, ...],
        "outputMode": "replace" | "copy" | "virtual_drive",
        "outputPath": "C:/...",   # required for virtual_drive mode
        "colormode": "color" | "binary",
        "hierarchical": "stacked" | "cutout",
        "filterSpeckle": 4,
        "colorPrecision": 6
    }
    Response: JSON with success, total, succeeded, failed, results, virtualDrivePath?
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        files = data.get("files", [])
        if len(files) > 1:
            raw = image_to_svg_tool.execute_parallel(data)
        else:
            raw = image_to_svg_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Image to SVG vectorizer failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/video-converter/run")
def video_converter_run():
    """
    Direct frontend endpoint for the Video Converter tool.
    Uses parallel execution when more than 1 file is provided.

    Body: {
        "files": [{"path": "...", "outputFormat": "mp4"}, ...],
        "outputMode": "replace" | "copy" | "virtual_drive",
        "outputPath": "C:/..."
    }
    Response: JSON with success, total, succeeded, failed, results, virtualDrivePath?
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        files = data.get("files", [])
        if len(files) > 1:
            raw = video_converter_tool.execute_parallel(data)
        else:
            raw = video_converter_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Video converter failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/audio-converter/run")
def audio_converter_run():
    """
    Direct frontend endpoint for the Audio Converter tool.
    Uses parallel execution when more than 1 file is provided.

    Body: {
        "files": [{"path": "...", "outputFormat": "mp3"}, ...],
        "outputMode": "replace" | "copy" | "virtual_drive",
        "outputPath": "C:/..."
    }
    Response: JSON with success, total, succeeded, failed, results, virtualDrivePath?
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        files = data.get("files", [])
        if len(files) > 1:
            raw = audio_converter_tool.execute_parallel(data)
        else:
            raw = audio_converter_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Audio converter failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/drive-creator/run")
def drive_creator_run():
    """
    Direct frontend endpoint for the Drive Creator tool.

    Body: {
        "sourceFolder": "C:/...",
        "extensions": [".jpg", ".png"],
        "driveName": "Image Drive",
        "action": "shortcuts" | "move",
        "outputPath": "C:/..."
    }
    Response: JSON with success, total, succeeded, failed, virtualDrivePath?
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        raw = drive_creator_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Drive creator failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/space-analyzer/run")
def space_analyzer_run():
    """
    Direct frontend endpoint for the Space Analyzer tool.

    Body: {
        "driveLetter": "C",
        "targetDir": "C:/Optional/Subfolder"
    }
    Response: JSON with success, data
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        raw = space_analyzer_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Space analyzer failed")
        return jsonify({"error": str(exc)}), 500

@tools_bp.get("/space-analyzer/drives")
def space_analyzer_drives():
    """
    Returns a list of available physical drive letters on Windows.
    Response: { "drives": ["C", "D"] }
    """
    try:
        import os
        import string
        drives = []
        for d in string.ascii_uppercase:
            path = f"{d}:\\"
            if os.path.exists(path):
                drives.append(d)
        return jsonify({"drives": drives})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500





@tools_bp.post("/blend-to-glb")
def blend_to_glb():
    """
    Convert a .blend file to .glb using Blender CLI (headless).
    Body: { "path": "C:/path/to/file.blend" }
    Response: { "glbPath": "C:/path/to/file.glb" }
    """
    import subprocess
    import shutil

    data = request.get_json(force=True)
    blend_path = data.get("path", "")
    if not blend_path or not os.path.isfile(blend_path):
        return jsonify({"error": "Invalid .blend file path"}), 400

    # Find Blender executable
    blender_exe = shutil.which("blender")
    if not blender_exe:
        # Check common Windows install locations
        for candidate in [
            r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 3.6\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 3.5\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender\blender.exe",
        ]:
            if os.path.isfile(candidate):
                blender_exe = candidate
                break

    if not blender_exe:
        return jsonify({"error": "Blender is not installed or not found in PATH. Install Blender to open .blend files."}), 400

    # Output path: same directory, same name but .glb
    base, _ = os.path.splitext(blend_path)
    glb_path = base + ".glb"

    # Blender Python script to export as GLB
    export_script = (
        "import bpy\n"
        f"bpy.ops.export_scene.gltf(filepath=r'{glb_path}', export_format='GLB')\n"
    )

    try:
        result = subprocess.run(
            [blender_exe, "--background", blend_path, "--python-expr", export_script],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if not os.path.isfile(glb_path):
            stderr_tail = (result.stderr or "")[-500:]
            return jsonify({"error": f"Blender conversion failed. {stderr_tail}"}), 500

        return jsonify({"glbPath": glb_path})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Blender conversion timed out (120s)"}), 500
    except Exception as exc:
        return jsonify({"error": f"Blender conversion error: {exc}"}), 500


@tools_bp.get("/created-drives")
def get_created_drives():
    """
    Return the list of virtual drives created by tools (from tool_drives.json).
    Used by the Tool Drives page in the frontend.
    """
    if not _TOOL_DRIVES_PATH.exists():
        return jsonify({"drives": []})
    try:
        drives = json.loads(_TOOL_DRIVES_PATH.read_text(encoding="utf-8"))
        if not isinstance(drives, list):
            drives = []
        return jsonify({"drives": drives})
    except Exception as exc:
        logger.error("Failed to load tool drives: %s", exc)
        return jsonify({"drives": [], "error": str(exc)})
