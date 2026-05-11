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

from flask import Blueprint, jsonify, request, Response, stream_with_context

from tools import hello as hello_tool
from tools import image_converter as image_converter_tool
from tools import remove_background as remove_background_tool
from tools import image_to_svg as image_to_svg_tool
from tools import video_converter as video_converter_tool
from tools import video_compressor as video_compressor_tool
from tools import audio_converter as audio_converter_tool
from tools import drive_creator as drive_creator_tool
from tools import space_analyzer as space_analyzer_tool
from tools import pdf_merger as pdf_merger_tool
from tools import model_converter as model_converter_tool
from tools import document_converter as document_converter_tool
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
    "video_compressor": video_compressor_tool,
    "audio_converter": audio_converter_tool,
    "drive_creator": drive_creator_tool,
    "space_analyzer": space_analyzer_tool,
    "pdf_merger": pdf_merger_tool,
    "model_converter": model_converter_tool,
    "document_converter": document_converter_tool,
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


@tools_bp.post("/video-compressor/run")
def video_compressor_run():
    """
    Direct frontend endpoint for the Video Compressor tool.
    Uses parallel execution when more than 1 file is provided.

    Body: {
        "files": [{"path": "...", "codec": "h264", "crf": 28, "maxResolution": "original", "stripAudio": false}, ...],
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
            raw = video_compressor_tool.execute_parallel(data)
        else:
            raw = video_compressor_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Video compressor failed")
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

@tools_bp.post("/pdf-merger/run")
def pdf_merger_run():
    """
    Direct frontend endpoint for the PDF Toolkit tool.

    Body: {
        "action": "merge" | "split" | "convert" | "reorder" | "page_info",
        "files": [{"path": "..."}, ...],
        "outputMode": "replace" | "copy" | "virtual_drive",
        "outputPath": "C:/...",
        "outputFilename": "merged",
        "pageRanges": "1-3,5",
        "convertTo": "docx" | "pdf",
        "addBookmarks": true,
        "pageOrder": [3, 1, 2]
    }
    Response: JSON with success, total, succeeded, failed, results, virtualDrivePath?
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    logger.info("PDF merger request: action=%s, files=%s, outputMode=%s",
                data.get("action"), data.get("files"), data.get("outputMode"))

    try:
        raw = pdf_merger_tool.execute(data)
        result = json.loads(raw)
        logger.info("PDF merger result: success=%s, error=%s", result.get("success"), result.get("error"))
        return jsonify(result)
    except Exception as exc:
        logger.exception("PDF merger failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/model-converter/run")
def model_converter_run():
    """
    Direct frontend endpoint for the 3D Model Converter tool.

    Body: {
        "files": [{"path": "...", "outputFormat": "glb"}, ...],
        "outputMode": "replace" | "copy" | "virtual_drive",
        "outputPath": "C:/..."
    }
    Response: JSON with success, total, succeeded, failed, results, virtualDrivePath?
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        raw = model_converter_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Model converter failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/document-converter/run")
def document_converter_run():
    """
    Direct frontend endpoint for the Document Converter tool.
    Uses parallel execution when more than 1 file is provided.

    Body: {
        "files": [{"path": "...", "outputFormat": "pdf"}, ...],
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
            raw = document_converter_tool.execute_parallel(data)
        else:
            raw = document_converter_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Document converter failed")
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


_AI_GATEWAY_BASE = "http://127.0.0.1:8000"


@tools_bp.get("/ai-gateway/status")
def ai_gateway_status():
    """Proxy to the AI Gateway status endpoint."""
    import requests as _req
    try:
        r = _req.get(f"{_AI_GATEWAY_BASE}/api/ai/status", timeout=5)
        return jsonify(r.json()), r.status_code
    except _req.exceptions.ConnectionError:
        return jsonify({"status": "offline", "error": "AI Gateway is not running"}), 503


@tools_bp.get("/preview")
def file_preview():
    """Serve a local file for in-app preview."""
    from flask import send_file
    path = request.args.get("path", "")
    if not path or not os.path.isfile(path):
        return jsonify({"error": "File not found"}), 404
    try:
        return send_file(path)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/image-enhancer/run")
def image_enhancer_run():
    """
    Proxy to AI Gateway: Swin2SR ×2 super-resolution.

    Body: {
        "filePath": "C:/...",
        "outputMode": "copy" | "virtual_drive",
        "outputPath": "C:/..."
    }
    Response: { success, outputPath, previewBase64, metrics }
    """
    import base64
    import requests as _req

    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    file_path: str = data.get("filePath", "")
    output_mode: str = data.get("outputMode", "copy")
    output_path: str = data.get("outputPath", "")

    if not file_path or not os.path.isfile(file_path):
        return jsonify({"error": "File not found or invalid path"}), 400

    ext = os.path.splitext(file_path)[1].lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
    mime = mime_map.get(ext, "image/png")

    try:
        with open(file_path, "rb") as fh:
            raw = fh.read()
        resp = _req.post(
            f"{_AI_GATEWAY_BASE}/api/ai/upscale/swin2sr",
            files={"file": (os.path.basename(file_path), raw, mime)},
            timeout=(10, 900),
        )
        resp.raise_for_status()
        result = resp.json()
    except _req.exceptions.ConnectionError:
        return jsonify({"error": "AI Gateway is not running. Start the Server (port 8000) first."}), 503
    except _req.exceptions.Timeout:
        return jsonify({"error": "Request timed out — the model may still be loading. Try again in a moment."}), 504
    except _req.exceptions.HTTPError as exc:
        detail = ""
        try:
            detail = exc.response.json().get("detail", "")
        except Exception:
            pass
        return jsonify({"error": f"AI Gateway error: {detail or str(exc)}"}), 500
    except Exception as exc:
        logger.exception("Image enhancer proxy failed")
        return jsonify({"error": str(exc)}), 500

    try:
        img_bytes = base64.b64decode(result["image_base64"])
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        out_filename = f"{base_name}_upscaled.png"

        if output_mode == "virtual_drive" and output_path:
            out_dir = os.path.join(output_path, "ImageEnhancerResults")
            os.makedirs(out_dir, exist_ok=True)
        else:
            out_dir = os.path.dirname(file_path)

        out_file = os.path.join(out_dir, out_filename)
        with open(out_file, "wb") as fh:
            fh.write(img_bytes)

        return jsonify({
            "success": True,
            "outputPath": out_file,
            "previewBase64": result["image_base64"],
            "metrics": result.get("metrics", {}),
        })
    except Exception as exc:
        logger.exception("Image enhancer save failed")
        return jsonify({"error": f"Failed to save output: {exc}"}), 500


@tools_bp.post("/audio-transcriber/run")
def audio_transcriber_run():
    """
    Proxy to AI Gateway: Whisper Large V3 speech-to-text.

    Body: {
        "filePath": "C:/...",
        "language": "en" | "ro" | ... | "auto",
        "maxNewTokens": 256,
        "expectedText": "",
        "outputMode": "copy" | "virtual_drive" | "",
        "outputPath": "C:/..."
    }
    Response: { success, transcription, outputPath?, metrics }
    """
    import requests as _req

    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    file_path: str = data.get("filePath", "")
    language: str | None = data.get("language") or None
    if language == "auto":
        language = None
    max_new_tokens: int = int(data.get("maxNewTokens", 256))
    expected_text: str | None = data.get("expectedText") or None
    output_mode: str = data.get("outputMode", "")
    output_path: str = data.get("outputPath", "")

    if not file_path or not os.path.isfile(file_path):
        return jsonify({"error": "File not found or invalid path"}), 400

    try:
        with open(file_path, "rb") as fh:
            raw = fh.read()

        form_data: dict = {"max_new_tokens": str(max_new_tokens)}
        if language:
            form_data["language"] = language
        if expected_text:
            form_data["expected_text"] = expected_text

        resp = _req.post(
            f"{_AI_GATEWAY_BASE}/api/ai/transcribe/whisper",
            files={"file": (os.path.basename(file_path), raw)},
            data=form_data,
            timeout=(10, 1200),
        )
        resp.raise_for_status()
        result = resp.json()
    except _req.exceptions.ConnectionError:
        return jsonify({"error": "AI Gateway is not running. Start the Server (port 8000) first."}), 503
    except _req.exceptions.Timeout:
        return jsonify({"error": "Request timed out — the model may still be loading. Try again in a moment."}), 504
    except _req.exceptions.HTTPError as exc:
        detail = ""
        try:
            detail = exc.response.json().get("detail", "")
        except Exception:
            pass
        return jsonify({"error": f"AI Gateway error: {detail or str(exc)}"}), 500
    except Exception as exc:
        logger.exception("Audio transcriber proxy failed")
        return jsonify({"error": str(exc)}), 500

    out_file: str | None = None
    if output_mode in ("copy", "virtual_drive"):
        try:
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            out_filename = f"{base_name}_transcript.txt"
            if output_mode == "virtual_drive" and output_path:
                out_dir = os.path.join(output_path, "TranscriptResults")
                os.makedirs(out_dir, exist_ok=True)
            else:
                out_dir = os.path.dirname(file_path)
            out_file = os.path.join(out_dir, out_filename)
            with open(out_file, "w", encoding="utf-8") as fh:
                fh.write(result["transcription"])
        except Exception as exc:
            logger.warning("Transcriber: failed to save transcript: %s", exc)
            out_file = None

    return jsonify({
        "success": True,
        "transcription": result["transcription"],
        "outputPath": out_file,
        "metrics": result.get("metrics", {}),
    })


@tools_bp.post("/image-enhancer/stream")
def image_enhancer_stream():
    """
    SSE proxy: streams Swin2SR progress events from the AI Gateway to the frontend.

    Body: same as /image-enhancer/run
    Stream: SSE events with stage/message/progress, final event adds outputPath.
    """
    import requests as _req
    import base64

    data = request.get_json(force=True) or {}
    file_path: str = data.get("filePath", "")
    output_mode: str = data.get("outputMode", "copy")
    output_path: str = data.get("outputPath", "")

    def _err_event(msg: str) -> str:
        return f'data: {json.dumps({"stage": "error", "message": msg})}\n\n'

    if not file_path or not os.path.isfile(file_path):
        def _err():
            yield _err_event("File not found or invalid path")
        return Response(stream_with_context(_err()), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    ext = os.path.splitext(file_path)[1].lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
    mime = mime_map.get(ext, "image/png")
    filename = os.path.basename(file_path)
    dir_path = os.path.dirname(file_path)

    try:
        with open(file_path, "rb") as fh:
            file_bytes = fh.read()
    except Exception as exc:
        def _err():
            yield _err_event(f"Cannot read file: {exc}")
        return Response(stream_with_context(_err()), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    def _generate():
        try:
            resp = _req.post(
                f"{_AI_GATEWAY_BASE}/api/ai/upscale/swin2sr/stream",
                files={"file": (filename, file_bytes, mime)},
                stream=True,
                timeout=(10, 900),
            )
        except _req.exceptions.ConnectionError:
            yield _err_event("AI Gateway is not running. Start the Server (port 8000) first.")
            return
        except _req.exceptions.Timeout:
            yield _err_event("Connection to AI Gateway timed out.")
            return
        except Exception as exc:
            yield _err_event(str(exc))
            return

        buf = b""
        for chunk in resp.iter_content(chunk_size=None):
            if not chunk:
                continue
            buf += chunk
            while b"\n\n" in buf:
                evt_raw, buf = buf.split(b"\n\n", 1)
                evt_text = evt_raw.decode("utf-8", errors="replace")
                for line in evt_text.split("\n"):
                    if not line.startswith("data: "):
                        continue
                    json_str = line[6:]
                    try:
                        evt = json.loads(json_str)
                    except Exception:
                        continue

                    if evt.get("stage") == "done" and "image_base64" in evt:
                        try:
                            img_bytes = base64.b64decode(evt["image_base64"])
                            base_name = os.path.splitext(filename)[0]
                            out_fname = f"{base_name}_upscaled.png"
                            if output_mode == "virtual_drive" and output_path:
                                out_dir = os.path.join(output_path, "ImageEnhancerResults")
                                os.makedirs(out_dir, exist_ok=True)
                            else:
                                out_dir = dir_path
                            out_file = os.path.join(out_dir, out_fname)
                            with open(out_file, "wb") as fh:
                                fh.write(img_bytes)
                            evt["outputPath"] = out_file
                        except Exception as save_exc:
                            evt["saveError"] = str(save_exc)
                        yield f"data: {json.dumps(evt)}\n\n"
                    else:
                        yield f"data: {json_str}\n\n"

    return Response(
        stream_with_context(_generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@tools_bp.post("/audio-transcriber/stream")
def audio_transcriber_stream():
    """
    SSE proxy: streams Whisper progress events from the AI Gateway to the frontend.

    Body: same as /audio-transcriber/run
    Stream: SSE events with stage/message/progress, final event adds outputPath.
    """
    import requests as _req

    data = request.get_json(force=True) or {}
    file_path: str = data.get("filePath", "")
    language: str | None = data.get("language") or None
    if language == "auto":
        language = None
    max_new_tokens: int = int(data.get("maxNewTokens", 256))
    expected_text: str | None = data.get("expectedText") or None
    output_mode: str = data.get("outputMode", "")
    output_path: str = data.get("outputPath", "")

    def _err_event(msg: str) -> str:
        return f'data: {json.dumps({"stage": "error", "message": msg})}\n\n'

    if not file_path or not os.path.isfile(file_path):
        def _err():
            yield _err_event("File not found or invalid path")
        return Response(stream_with_context(_err()), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    filename = os.path.basename(file_path)
    dir_path = os.path.dirname(file_path)

    try:
        with open(file_path, "rb") as fh:
            file_bytes = fh.read()
    except Exception as exc:
        def _err():
            yield _err_event(f"Cannot read file: {exc}")
        return Response(stream_with_context(_err()), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    form_data: dict = {"max_new_tokens": str(max_new_tokens)}
    if language:
        form_data["language"] = language
    if expected_text:
        form_data["expected_text"] = expected_text

    def _generate():
        try:
            resp = _req.post(
                f"{_AI_GATEWAY_BASE}/api/ai/transcribe/whisper/stream",
                files={"file": (filename, file_bytes)},
                data=form_data,
                stream=True,
                timeout=(10, 1200),
            )
        except _req.exceptions.ConnectionError:
            yield _err_event("AI Gateway is not running. Start the Server (port 8000) first.")
            return
        except _req.exceptions.Timeout:
            yield _err_event("Connection to AI Gateway timed out.")
            return
        except Exception as exc:
            yield _err_event(str(exc))
            return

        buf = b""
        for chunk in resp.iter_content(chunk_size=None):
            if not chunk:
                continue
            buf += chunk
            while b"\n\n" in buf:
                evt_raw, buf = buf.split(b"\n\n", 1)
                evt_text = evt_raw.decode("utf-8", errors="replace")
                for line in evt_text.split("\n"):
                    if not line.startswith("data: "):
                        continue
                    json_str = line[6:]
                    try:
                        evt = json.loads(json_str)
                    except Exception:
                        continue

                    if evt.get("stage") == "done":
                        if output_mode in ("copy", "virtual_drive"):
                            try:
                                base_name = os.path.splitext(filename)[0]
                                out_fname = f"{base_name}_transcript.txt"
                                if output_mode == "virtual_drive" and output_path:
                                    out_dir = os.path.join(output_path, "TranscriptResults")
                                    os.makedirs(out_dir, exist_ok=True)
                                else:
                                    out_dir = dir_path
                                out_file = os.path.join(out_dir, out_fname)
                                with open(out_file, "w", encoding="utf-8") as fh:
                                    fh.write(evt.get("transcription", ""))
                                evt["outputPath"] = out_file
                            except Exception as save_exc:
                                logger.warning("Transcriber stream: save failed: %s", save_exc)
                        yield f"data: {json.dumps(evt)}\n\n"
                    else:
                        yield f"data: {json_str}\n\n"

    return Response(
        stream_with_context(_generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
