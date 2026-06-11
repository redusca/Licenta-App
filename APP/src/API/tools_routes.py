from __future__ import annotations

import json
import logging
import os
import re
import threading
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, Response, stream_with_context
from utils.paths import get_data_dir
import utils.ai_gateway as ai_gateway

from tools import ask_user as ask_user_tool
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
from tools import subtitle_generator as subtitle_generator_tool
from tools.subtitle_generator import build_srt as _build_srt
from tools import document_analytics as document_analytics_tool
from tools import smart_drive_scanner as smart_drive_scanner_tool
from tools import smart_drive_builder as smart_drive_builder_tool
from tools.catalog import TOOLS as CATALOG_TOOLS, CATEGORIES as CATALOG_CATEGORIES

logger = logging.getLogger(__name__)

_SFX_MAP: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\[(?:laughing|laughter|laugh|laughs?|giggling|giggles?)\]', re.I), '*laughs*'),
    (re.compile(r'\[(?:applause|clapping|claps?)\]', re.I), '*applause*'),
    (re.compile(r'\[(?:cheering|cheers?|crowd cheering)\]', re.I), '*cheering*'),
    (re.compile(r'\[(?:music|musical?|background music)\]', re.I), '*music*'),
    (re.compile(r'\[(?:sighs?|sighing)\]', re.I), '*sighs*'),
    (re.compile(r'\[(?:gasps?|gasping)\]', re.I), '*gasps*'),
    (re.compile(r'\[(?:crying|cries|sobs?|sobbing|weeping)\]', re.I), '*cries*'),
    (re.compile(r'\[(?:whistling?|whistle)\]', re.I), '*whistles*'),
    (re.compile(r'\[(?:coughing?|coughs?)\]', re.I), '*coughs*'),
    (re.compile(r'\[(?:noise|background noise|ambient|silence|inaudible|unintelligible|(?:speaking )?foreign (?:language|speech))\]', re.I), ''),
]

_LAUGH_NOISE_RE = re.compile(
    r'^[\s,!\.\-]*((?:ha|hah|haha|heh|hee|ah|aha|lol)[\s,!\.\-]*){3,}[\s,!\.\-]*$',
    re.I,
)


def _normalize_sfx(chunks: list[dict]) -> list[dict]:
    out: list[dict] = []
    for seg in chunks:
        text = seg.get("text", "").strip()
        if not text:
            continue
        for pattern, replacement in _SFX_MAP:
            text = pattern.sub(replacement, text).strip()
        if not text:
            continue
        if _LAUGH_NOISE_RE.match(text):
            text = "*laughs*"
        out.append({**seg, "text": text})
    return out


tools_bp = Blueprint("tools", __name__)

_TOOL_DRIVES_PATH = get_data_dir() / "tool_drives.json"

_PENDING: dict[str, dict] = {}
_PENDING_LOCK = threading.Lock()

_LAST_OUTPUT_PATHS: list[str] = []
_LAST_OUTPUT_LOCK = threading.Lock()

# Stores the full files list from the most recent smart_drive_scan result
_LAST_SCAN_FILES: list[dict] = []
_LAST_SCAN_LOCK = threading.Lock()


def _looks_like_real_path(p: str) -> bool:
    if not p or len(p) < 3:
        return False
    if re.match(r'^[A-Za-z]:[/\\]', p):  # Windows: C:\ or C:/
        return True
    if p.startswith('\\\\') or p.startswith('//'):  # UNC
        return True
    if p.startswith('/') and len(p) > 1:  # Linux/Mac
        return True
    return False


def _substitute_placeholders(tool_input: dict, real_paths: list[str]) -> dict:
    if not real_paths:
        return tool_input
    files = tool_input.get("files")
    if not isinstance(files, list) or not files:
        return tool_input

    path_iter = iter(real_paths)
    new_files: list[dict] = []
    for item in files:
        if not isinstance(item, dict):
            new_files.append(item)
            continue
        path = item.get("path", "")
        if _looks_like_real_path(path):
            new_files.append(item)
        else:
            try:
                new_files.append({**item, "path": next(path_iter)})
            except StopIteration:
                new_files.append(item)
    return {**tool_input, "files": new_files}


def _record_outputs(result_json: str, tool_name: str = "") -> None:
    try:
        parsed = json.loads(result_json)
    except Exception:
        return
    if not isinstance(parsed, dict):
        return

    # Track outputPaths for file-chaining tools
    paths: list[str] = []
    if isinstance(parsed.get("results"), list):
        paths = [
            r["outputPath"] for r in parsed["results"]
            if isinstance(r, dict) and r.get("success") and r.get("outputPath")
        ]
    elif parsed.get("outputPath"):
        paths = [parsed["outputPath"]]
    if paths:
        with _LAST_OUTPUT_LOCK:
            _LAST_OUTPUT_PATHS.clear()
            _LAST_OUTPUT_PATHS.extend(paths)

    # Track full file list from smart_drive_scan so build can inject it if needed
    if tool_name == "smart_drive_scan" and isinstance(parsed.get("files"), list):
        with _LAST_SCAN_LOCK:
            _LAST_SCAN_FILES.clear()
            _LAST_SCAN_FILES.extend(parsed["files"])

_APPROVAL_REQUIRED = frozenset({
    "image_converter", "remove_background", "image_to_svg",
    "video_converter", "video_compressor", "audio_converter",
    "drive_creator", "pdf_merger", "model_converter", "document_converter",
    "smart_drive_build",
})

_TOOLS: dict[str, object] = {
    "ask_user": ask_user_tool,
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
    "subtitle_generator": subtitle_generator_tool,
    "document_analytics": document_analytics_tool,
    "smart_drive_scan": smart_drive_scanner_tool,
    "smart_drive_build": smart_drive_builder_tool,
}


@tools_bp.post("/execute")
def execute():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    tool_name: str = data.get("tool", "")
    tool_input: dict = data.get("input", {})

    tool = _TOOLS.get(tool_name)
    if tool is None:
        logger.warning("Unknown tool requested: %s", tool_name)
        return jsonify({"error": f"Unknown tool: '{tool_name}'"}), 404

    definition: dict = getattr(tool, "DEFINITION", {})
    needs_approval = (
        tool_name in _APPROVAL_REQUIRED
        or definition.get("requires_approval", False)
    )

    if needs_approval:
        # Replace LLM-generated placeholder paths with the real paths from the
        # previous tool's output before surfacing the approval card to the user.
        with _LAST_OUTPUT_LOCK:
            current_outputs = list(_LAST_OUTPUT_PATHS)
        tool_input = _substitute_placeholders(tool_input, current_outputs)

        # If smart_drive_build received no files (agent failed to chain), inject
        # the full scan result so the user can review/deselect in the approval card.
        if tool_name == "smart_drive_build":
            files = tool_input.get("files")
            if not isinstance(files, list) or len(files) == 0:
                with _LAST_SCAN_LOCK:
                    scan_files = list(_LAST_SCAN_FILES)
                if scan_files:
                    logger.warning(
                        "smart_drive_build received 0 files — injecting %d files from last scan",
                        len(scan_files),
                    )
                    injected = [
                        {"path": f["path"], "ai_description": f.get("ai_description"), "folder": ""}
                        for f in scan_files if f.get("path")
                    ]
                    tool_input = {**tool_input, "files": injected}

        req_id = str(uuid.uuid4())
        event = threading.Event()
        safe_defn = {k: v for k, v in definition.items() if k != "callback_url"}
        with _PENDING_LOCK:
            _PENDING[req_id] = {
                "id": req_id,
                "tool": tool_name,
                "input": tool_input,
                "definition": safe_defn,
                "event": event,
                "approved": None,
                "modified_input": None,
            }
        logger.info("Tool '%s' waiting for approval (req %s)", tool_name, req_id)
        approved = event.wait(timeout=870)
        with _PENDING_LOCK:
            pending = _PENDING.pop(req_id, None)

        if not approved or pending is None or pending.get("approved") is not True:
            logger.info("Tool '%s' rejected or timed out", tool_name)
            return jsonify({"result": f"[Rejected] User declined to run '{tool_name}'."}), 200

        tool_input = pending.get("modified_input") or tool_input
        logger.info("Tool '%s' approved, running", tool_name)

    try:
        result: str = tool.execute(tool_input)
        _record_outputs(result, tool_name)
        logger.info("Tool '%s' executed successfully", tool_name)
        return jsonify({"result": result})
    except Exception as exc:
        logger.exception("Tool '%s' raised an error", tool_name)
        return jsonify({"error": f"Tool '{tool_name}' failed: {exc}"}), 500


@tools_bp.get("")
def list_tools():
    definitions = []
    for name, mod in _TOOLS.items():
        defn = dict(mod.DEFINITION)
        defn.setdefault("callback_url", "")
        definitions.append(defn)
    return jsonify(definitions)


@tools_bp.get("/catalog")
def get_catalog():
    return jsonify({
        "tools": CATALOG_TOOLS,
        "categories": CATALOG_CATEGORIES,
    })


@tools_bp.get("/pending")
def get_pending_approvals():
    with _PENDING_LOCK:
        result = [
            {
                "id": v["id"],
                "tool": v["tool"],
                "input": v["input"],
                "definition": v["definition"],
            }
            for v in _PENDING.values()
        ]
    return jsonify(result)


@tools_bp.post("/approve/<request_id>")
def approve_tool(request_id: str):
    with _PENDING_LOCK:
        pending = _PENDING.get(request_id)
    if not pending:
        return jsonify({"error": "Request not found or already resolved"}), 404
    body = request.get_json(force=True) or {}
    pending["approved"] = True
    pending["modified_input"] = body.get("input") or pending["input"]
    pending["event"].set()
    logger.info("Tool '%s' approved (req %s)", pending["tool"], request_id)
    return jsonify({"ok": True})


@tools_bp.post("/reject/<request_id>")
def reject_tool(request_id: str):
    with _PENDING_LOCK:
        pending = _PENDING.get(request_id)
    if not pending:
        return jsonify({"error": "Request not found or already resolved"}), 404
    pending["approved"] = False
    pending["event"].set()
    logger.info("Tool '%s' rejected (req %s)", pending["tool"], request_id)
    return jsonify({"ok": True})


@tools_bp.post("/image-converter/run")
def image_converter_run():
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
    import subprocess
    import shutil

    data = request.get_json(force=True)
    blend_path = data.get("path", "")
    if not blend_path or not os.path.isfile(blend_path):
        return jsonify({"error": "Invalid .blend file path"}), 400

    blender_exe = shutil.which("blender")
    if not blender_exe:
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

    base, _ = os.path.splitext(blend_path)
    glb_path = base + ".glb"

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


@tools_bp.get("/ai-gateway/status")
def ai_gateway_status():
    ok, err = ai_gateway.health_check()
    if ok:
        return jsonify({"status": "ok"})
    return jsonify({"status": "offline", "error": err}), 503



@tools_bp.post("/open-file")
def open_file():
    import subprocess
    import sys
    data = request.get_json(force=True) or {}
    path = data.get("path", "").strip()
    if not path or not os.path.exists(path):
        return jsonify({"error": "Path not found"}), 404
    try:
        if sys.platform == "win32":
            os.startfile(path)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return jsonify({"ok": True})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@tools_bp.post("/show-in-folder")
def show_in_folder():
    import subprocess
    import sys
    data = request.get_json(force=True) or {}
    path = data.get("path", "").strip()
    if not path or not os.path.exists(path):
        # Try opening parent directory even if the file doesn't exist
        parent = os.path.dirname(path)
        if not parent or not os.path.isdir(parent):
            return jsonify({"error": "Path not found"}), 404
        path = parent

    try:
        if sys.platform == "win32":
            if os.path.isfile(path):
                subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])  # /select highlights the file
            else:
                subprocess.Popen(["explorer", os.path.normpath(path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", path])
        else:
            folder = path if os.path.isdir(path) else os.path.dirname(path)
            subprocess.Popen(["xdg-open", folder])
        return jsonify({"ok": True})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@tools_bp.get("/user-folders")
def user_folders():
    home = Path(__file__).home()
    candidates = [
        ("Desktop",   home / "Desktop"),
        ("Documents", home / "Documents"),
        ("Downloads", home / "Downloads"),
        ("Pictures",  home / "Pictures"),
        ("Videos",    home / "Videos"),
        ("Music",     home / "Music"),
    ]
    return jsonify({name: str(p) for name, p in candidates if p.is_dir()})


@tools_bp.get("/pick-folder")
def pick_folder():
    import subprocess
    ps_script = (
        "Add-Type -AssemblyName System.Windows.Forms; "
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog; "
        "$d.Description = 'Select a folder'; "
        "$d.ShowNewFolderButton = $true; "
        "[System.Windows.Forms.Application]::EnableVisualStyles() | Out-Null; "
        "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"
    )
    try:
        result = subprocess.run(
            ["powershell", "-WindowStyle", "Hidden", "-Command", ps_script],
            capture_output=True, text=True, timeout=120,
        )
        path = result.stdout.strip()
        if path:
            return jsonify({"path": path})
        return jsonify({"path": None, "cancelled": True})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@tools_bp.get("/preview")
def file_preview():
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

    gw_ok, gw_err = ai_gateway.health_check()
    if not gw_ok:
        return jsonify({"error": gw_err}), 503

    try:
        with open(file_path, "rb") as fh:
            raw = fh.read()
        resp = _req.post(
            f"{ai_gateway.get_url()}/api/ai/upscale/swin2sr",
            files={"file": (os.path.basename(file_path), raw, mime)},
            headers=ai_gateway.auth_headers(),
            timeout=(10, 900),
        )
        resp.raise_for_status()
        result = resp.json()
    except _req.exceptions.ConnectionError:
        return jsonify({"error": f"Lost connection to AI Gateway at {ai_gateway.get_url()}"}), 503
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

    gw_ok, gw_err = ai_gateway.health_check()
    if not gw_ok:
        return jsonify({"error": gw_err}), 503

    try:
        with open(file_path, "rb") as fh:
            raw = fh.read()

        form_data: dict = {"max_new_tokens": str(max_new_tokens)}
        if language:
            form_data["language"] = language
        if expected_text:
            form_data["expected_text"] = expected_text

        resp = _req.post(
            f"{ai_gateway.get_url()}/api/ai/transcribe/whisper",
            files={"file": (os.path.basename(file_path), raw)},
            data=form_data,
            headers=ai_gateway.auth_headers(),
            timeout=(10, 1200),
        )
        resp.raise_for_status()
        result = resp.json()
    except _req.exceptions.ConnectionError:
        return jsonify({"error": f"Lost connection to AI Gateway at {ai_gateway.get_url()}"}), 503
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
        ok, err = ai_gateway.health_check()
        if not ok:
            yield _err_event(err)
            return
        try:
            resp = _req.post(
                f"{ai_gateway.get_url()}/api/ai/upscale/swin2sr/stream",
                files={"file": (filename, file_bytes, mime)},
                headers=ai_gateway.auth_headers(),
                stream=True,
                timeout=(10, 900),
            )
        except _req.exceptions.RequestException as exc:
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
        ok, err = ai_gateway.health_check()
        if not ok:
            yield _err_event(err)
            return
        try:
            resp = _req.post(
                f"{ai_gateway.get_url()}/api/ai/transcribe/whisper/stream",
                files={"file": (filename, file_bytes)},
                data=form_data,
                headers=ai_gateway.auth_headers(),
                stream=True,
                timeout=(10, 1200),
            )
        except _req.exceptions.RequestException as exc:
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


@tools_bp.post("/subtitle-generator/stream")
def subtitle_generator_stream():
    import subprocess
    import tempfile
    import requests as _req

    try:
        import imageio_ffmpeg
        _ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        _ffmpeg_exe = "ffmpeg"

    data = request.get_json(force=True) or {}
    video_path: str = data.get("videoPath", "")
    source_language: str | None = data.get("sourceLanguage") or None
    if source_language == "auto":
        source_language = None
    translate_to: str = data.get("translateTo", "").strip()
    output_mode: str = data.get("outputMode", "copy")
    output_path: str = data.get("outputPath", "")

    def _err_event(msg: str) -> str:
        return f'data: {json.dumps({"stage": "error", "message": msg})}\n\n'

    def _evt(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    if not video_path or not os.path.isfile(video_path):
        def _e():
            yield _err_event("Video file not found or invalid path")
        return Response(stream_with_context(_e()), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    video_extensions = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v", ".mpeg", ".mpg"}
    ext = os.path.splitext(video_path)[1].lower()
    if ext not in video_extensions:
        def _e():
            yield _err_event(f"Unsupported video format: {ext}")
        return Response(stream_with_context(_e()), mimetype="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    filename = os.path.basename(video_path)
    dir_path = os.path.dirname(video_path)
    base_name = os.path.splitext(filename)[0]

    def _generate():
        ok, err = ai_gateway.health_check()
        if not ok:
            yield _err_event(err)
            return
        tmp_audio = None
        try:
            yield _evt({"stage": "extracting_audio", "message": "Extracting audio from video...", "progress": 0.05})
            tmp_audio = tempfile.mktemp(suffix=".wav")
            try:
                result = subprocess.run(
                    [_ffmpeg_exe, "-y", "-i", video_path,
                     "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
                     tmp_audio],
                    capture_output=True, text=True, timeout=300,
                )
                if result.returncode != 0 or not os.path.isfile(tmp_audio):
                    yield _err_event(f"FFmpeg audio extraction failed: {result.stderr[-400:]}")
                    return
            except subprocess.TimeoutExpired:
                yield _err_event("Audio extraction timed out (5 min limit).")
                return
            except FileNotFoundError:
                yield _err_event("FFmpeg not found. Install FFmpeg and make sure it is in PATH.")
                return

            try:
                with open(tmp_audio, "rb") as fh:
                    audio_bytes = fh.read()
            except Exception as exc:
                yield _err_event(f"Cannot read extracted audio: {exc}")
                return

            yield _evt({"stage": "loading_model", "message": "Connecting to AI Gateway...", "progress": 0.1})

            form_data: dict = {}
            if source_language:
                form_data["language"] = source_language

            try:
                resp = _req.post(
                    f"{ai_gateway.get_url()}/api/ai/subtitle/whisper/stream",
                    files={"file": ("audio.wav", audio_bytes, "audio/wav")},
                    data=form_data,
                    headers=ai_gateway.auth_headers(),
                    stream=True,
                    timeout=(10, 1800),
                )
            except _req.exceptions.RequestException as exc:
                yield _err_event(str(exc))
                return

            chunks_result: list[dict] | None = None
            gw_metrics: dict = {}

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
                            chunks_result = evt.get("chunks", [])
                            gw_metrics = evt.get("metrics", {})
                        elif evt.get("stage") == "error":
                            yield _err_event(evt.get("message", "AI Gateway error"))
                            return
                        else:
                            raw_pct = evt.get("progress", 0)
                            scaled_pct = 0.1 + raw_pct * 0.7  # 0.1 → 0.8
                            yield _evt({**evt, "progress": round(scaled_pct, 3)})

            if chunks_result is None:
                yield _err_event("No response from AI Gateway.")
                return

            chunks_result = _normalize_sfx(chunks_result)

            final_chunks = chunks_result
            if translate_to and chunks_result:
                yield _evt({
                    "stage": "translating",
                    "message": f"Translating {len(chunks_result)} segments to {translate_to}...",
                    "progress": 0.82,
                })
                try:
                    from deep_translator import GoogleTranslator
                    translator = GoogleTranslator(source="auto", target=translate_to)
                    translated: list[dict] = []
                    for seg in chunks_result:
                        text = seg.get("text", "").strip()
                        if re.match(r'^\*[^*]+\*$', text):  # keep SFX markers (*laughs*, etc.) as-is
                            translated.append({**seg, "text": text})
                            continue
                        try:
                            t = translator.translate(text) if text else text
                        except Exception:
                            t = text
                        translated.append({**seg, "text": t or text})
                    final_chunks = translated
                except ImportError:
                    yield _evt({
                        "stage": "translating",
                        "message": "deep-translator not installed — skipping translation.",
                        "progress": 0.83,
                    })
                except Exception as exc:
                    yield _evt({
                        "stage": "translating",
                        "message": f"Translation failed ({exc}) — keeping original language.",
                        "progress": 0.83,
                    })

            yield _evt({"stage": "generating_srt", "message": "Building SRT file...", "progress": 0.92})

            srt_content = _build_srt(final_chunks)

            if output_mode == "virtual_drive" and output_path:
                out_dir = os.path.join(output_path, "SubtitleResults")
                os.makedirs(out_dir, exist_ok=True)
            else:
                out_dir = dir_path

            srt_filename = f"{base_name}.srt"
            srt_path = os.path.join(out_dir, srt_filename)
            with open(srt_path, "w", encoding="utf-8") as fh:
                fh.write(srt_content)

            yield _evt({
                "stage": "done",
                "progress": 1.0,
                "srtPath": srt_path,
                "srtContent": srt_content,
                "numSegments": len(final_chunks),
                "metrics": gw_metrics,
            })

        except Exception as exc:
            logger.exception("Subtitle generator stream error")
            yield _err_event(str(exc))
        finally:
            if tmp_audio and os.path.isfile(tmp_audio):
                try:
                    os.remove(tmp_audio)
                except Exception:
                    pass

    return Response(
        stream_with_context(_generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@tools_bp.post("/document-analytics/run")
def document_analytics_run():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        raw = document_analytics_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Document analytics failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.get("/created-drives")
def get_created_drives():
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
