"""
3D Model Converter — convert between OBJ, FBX, GLB, GLTF, STL, PLY, DAE formats.

Uses *trimesh* for geometry I/O.  Trimesh can import all common 3D formats and
export to OBJ, STL, PLY, GLB, and GLTF.  For FBX and DAE import it relies on
the optional `pyassimp` backend (falls back gracefully if not installed).

Execution modes
---------------
replace        : overwrite the original file with the converted version.
copy           : place the converted file alongside the original (same folder).
virtual_drive  : copy converted files into the ModelConversionResults virtual drive
                 located at <output_path>/ModelConversionResults.
"""
from __future__ import annotations

import json
import os
import subprocess
import uuid
from pathlib import Path

from config import APP_VERSION
from migrations import get_latest_schema_version

# ── Paths ──────────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent.parent / "data"
_TOOL_DRIVES_PATH = _DATA_DIR / "tool_drives.json"
_CONFIG_FILENAME = ".drive_config.json"

SUPPORTED_INPUT_EXTENSIONS = {".obj", ".fbx", ".glb", ".gltf", ".stl", ".ply", ".dae"}
OUTPUT_FORMATS = {"obj", "stl", "ply", "glb", "gltf"}

# Formats that require Blender CLI for export (not natively supported by trimesh)
BLENDER_EXPORT_FORMATS = {"fbx", "dae"}

# ── Agent tool definition ──────────────────────────────────────────────────────

DEFINITION = {
    "name": "model_converter",
    "description": (
        "Convert 3D model files between formats (OBJ, FBX, GLB, GLTF, STL, PLY, DAE). "
        "Supports three output modes: replace originals, copy alongside, or virtual drive."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "description": 'List of objects: [{"path": "...", "outputFormat": "glb"}, ...]',
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
            return
    drives.append({"path": drive_path, "name": name, "tool": tool})
    _save_tool_drives(drives)

# ── Virtual drive creation ─────────────────────────────────────────────────────

def _ensure_virtual_drive(output_path: str) -> str:
    drive_name = "ModelConversionResults"
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
            "created_by_tool": "model_converter",
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        subprocess.call(["attrib", "+h", config_path], shell=True)

    _register_tool_drive(drive_path, drive_name, "model_converter")
    return drive_path

# ── Blender helpers ────────────────────────────────────────────────────────────

def _find_blender() -> str | None:
    """Locate the Blender executable."""
    import shutil
    blender_exe = shutil.which("blender")
    if blender_exe:
        return blender_exe
    for candidate in [
        r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 3.6\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender\blender.exe",
    ]:
        if os.path.isfile(candidate):
            return candidate
    return None

def _blender_convert(src_path: str, dst_path: str, out_format: str) -> None:
    """Use Blender CLI (headless) to convert to FBX or DAE."""
    blender_exe = _find_blender()
    if not blender_exe:
        raise RuntimeError(
            "Blender is required for FBX/DAE export but was not found. "
            "Install Blender or choose a format like GLB, OBJ, STL, or PLY."
        )

    # Build Blender python export script based on format
    if out_format == "fbx":
        export_line = f"bpy.ops.export_scene.fbx(filepath=r'{dst_path}')"
    elif out_format == "dae":
        export_line = f"bpy.ops.wm.collada_export(filepath=r'{dst_path}')"
    else:
        raise RuntimeError(f"Unsupported Blender export format: {out_format}")

    # Build import script based on input extension
    src_ext = Path(src_path).suffix.lower()
    if src_ext == ".fbx":
        import_line = f"bpy.ops.import_scene.fbx(filepath=r'{src_path}')"
    elif src_ext == ".obj":
        import_line = f"bpy.ops.wm.obj_import(filepath=r'{src_path}')"
    elif src_ext in (".glb", ".gltf"):
        import_line = f"bpy.ops.import_scene.gltf(filepath=r'{src_path}')"
    elif src_ext == ".stl":
        import_line = f"bpy.ops.wm.stl_import(filepath=r'{src_path}')"
    elif src_ext == ".ply":
        import_line = f"bpy.ops.wm.ply_import(filepath=r'{src_path}')"
    elif src_ext == ".dae":
        import_line = f"bpy.ops.wm.collada_import(filepath=r'{src_path}')"
    else:
        raise RuntimeError(f"Unsupported source format for Blender import: {src_ext}")

    script = (
        "import bpy\n"
        "# Delete default cube/objects\n"
        "bpy.ops.object.select_all(action='SELECT')\n"
        "bpy.ops.object.delete(use_global=False)\n"
        f"{import_line}\n"
        f"{export_line}\n"
    )

    result = subprocess.run(
        [blender_exe, "--background", "--python-expr", script],
        capture_output=True,
        text=True,
        timeout=180,
    )

    if not os.path.isfile(dst_path):
        stderr_tail = (result.stderr or "")[-800:]
        raise RuntimeError(f"Blender conversion failed.\n{stderr_tail}")

# ── Single-model conversion ───────────────────────────────────────────────────

def _convert_model(src_path: str, out_format: str, dst_path: str) -> None:
    """Convert a 3D model file to the specified format."""
    import trimesh

    src_ext = Path(src_path).suffix.lower()

    # If target format needs Blender, use Blender pipeline
    if out_format in BLENDER_EXPORT_FORMATS:
        _blender_convert(src_path, dst_path, out_format)
        return

    # Load the scene/mesh with trimesh
    try:
        scene = trimesh.load(src_path, force=None)
    except Exception as exc:
        raise RuntimeError(f"Failed to load model: {exc}")

    # Export based on format
    try:
        if out_format in ("glb", "gltf"):
            if isinstance(scene, trimesh.Scene):
                scene.export(dst_path, file_type=out_format)
            else:
                # Wrap single mesh in scene for GLTF export
                s = trimesh.Scene(geometry={"mesh": scene})
                s.export(dst_path, file_type=out_format)
        elif out_format == "obj":
            if isinstance(scene, trimesh.Scene):
                # Concatenate all meshes for OBJ
                combined = scene.to_geometry()
                if isinstance(combined, trimesh.Scene):
                    combined = trimesh.util.concatenate(
                        [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
                    )
                combined.export(dst_path, file_type="obj")
            else:
                scene.export(dst_path, file_type="obj")
        elif out_format == "stl":
            if isinstance(scene, trimesh.Scene):
                combined = trimesh.util.concatenate(
                    [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
                )
                combined.export(dst_path, file_type="stl")
            else:
                scene.export(dst_path, file_type="stl")
        elif out_format == "ply":
            if isinstance(scene, trimesh.Scene):
                combined = trimesh.util.concatenate(
                    [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
                )
                combined.export(dst_path, file_type="ply")
            else:
                scene.export(dst_path, file_type="ply")
        else:
            raise RuntimeError(f"Unsupported output format: {out_format}")
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Export failed: {exc}")


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

def execute(input_data: dict) -> str:
    """
    Batch-convert 3D models.
    Returns a JSON string (for agent compatibility).
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

    results = []
    for item in files:
        src = item.get("path", "")
        raw_fmt = item.get("outputFormat", "").lower().lstrip(".")

        if not src or not os.path.isfile(src):
            results.append({"path": src, "success": False, "error": "File not found"})
            continue

        all_supported = OUTPUT_FORMATS | BLENDER_EXPORT_FORMATS
        if raw_fmt not in all_supported:
            results.append({"path": src, "success": False, "error": f"Unsupported format: {raw_fmt}"})
            continue

        ext = raw_fmt
        stem = Path(src).stem

        try:
            if output_mode == "replace":
                tmp = src + f".model_conv_tmp.{ext}"
                _convert_model(src, raw_fmt, tmp)
                os.remove(src)
                final = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
                final = _unique_path(final)
                os.rename(tmp, final)

            elif output_mode == "copy":
                candidate = os.path.join(os.path.dirname(src), f"{stem}.{ext}")
                if os.path.normcase(candidate) == os.path.normcase(src):
                    candidate = f"{os.path.join(os.path.dirname(src), stem)}_copy.{ext}"
                final = _unique_path(candidate)
                _convert_model(src, raw_fmt, final)

            else:  # virtual_drive
                dest = os.path.join(virtual_drive_path, f"{stem}.{ext}")  # type: ignore[arg-type]
                dest = _unique_path(dest)
                _convert_model(src, raw_fmt, dest)
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
