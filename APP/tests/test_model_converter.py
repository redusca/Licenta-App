"""
Tests for the 3D model converter tool — APP/src/tools/model_converter.py.

Tool purpose
------------
Convert 3D model files between formats (OBJ, FBX, GLB, GLTF, STL, PLY, DAE)
using the trimesh library (with optional pyassimp for FBX/DAE import).

Input  (dict)
-------------
files      : list[dict]  — each item: {"path": str, "outputFormat": str}
outputMode : str         — "replace" | "copy" | "virtual_drive"
outputPath : str         — parent dir for virtual drive (virtual_drive mode only)

Output (JSON string)
--------------------
{
  "success"         : bool,
  "total"           : int,
  "succeeded"       : int,
  "failed"          : int,
  "results"         : [{"path": str, "outputPath": str, "success": bool}, ...],
  "virtualDrivePath": str   # only present for virtual_drive mode
}

Dataset
-------
A minimal OBJ (unit cube, 8 vertices, 6 quads) is created as a plain-text file
in setUp() — no external libraries are needed to write it.  Conversion tests
require trimesh to be installed.

Run
---
    python -m pytest APP/tests/test_model_converter.py -v
"""
import sys
import os
import json
import shutil
import tempfile
import unittest

# ── Path setup ────────────────────────────────────────────────────────────────
_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR   = os.path.dirname(_TESTS_DIR)
_SRC_DIR   = os.path.join(_APP_DIR, "src")
sys.path.insert(0, _SRC_DIR)

from tools import model_converter  # noqa: E402

# ── Optional dependency flags ─────────────────────────────────────────────────
try:
    import trimesh  # noqa: F401
    TRIMESH_AVAILABLE = True
except ImportError:
    TRIMESH_AVAILABLE = False

# ── Minimal OBJ content (unit cube) ──────────────────────────────────────────
_CUBE_OBJ = """\
# Minimal unit cube — 8 vertices, 12 triangles
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
"""


class TestModelConverterDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, model_converter.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'model_converter'."""
        self.assertEqual(model_converter.DEFINITION["name"], "model_converter")

    def test_definition_required_params(self):
        """Required parameters must include 'files' and 'outputMode'."""
        required = model_converter.DEFINITION["parameters"]["required"]
        self.assertIn("files", required)
        self.assertIn("outputMode", required)

    def test_definition_output_mode_enum(self):
        """outputMode must enumerate replace, copy, virtual_drive."""
        enum = model_converter.DEFINITION["parameters"]["properties"]["outputMode"]["enum"]
        self.assertSetEqual(set(enum), {"replace", "copy", "virtual_drive"})


class TestModelConverterInputValidation(unittest.TestCase):
    """Input validation tests — no trimesh dependency required."""

    def test_empty_files_returns_error(self):
        """Empty files list → success=False with an error message."""
        result = json.loads(model_converter.execute({"files": [], "outputMode": "copy"}))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_missing_files_key_returns_error(self):
        """Missing 'files' key → success=False."""
        result = json.loads(model_converter.execute({"outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_nonexistent_file_fails_per_file(self):
        """Non-existent source path → per-file failure."""
        result = json.loads(model_converter.execute({
            "files": [{"path": "/nonexistent/model.obj", "outputFormat": "stl"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_unsupported_output_format_fails_per_file(self):
        """Unsupported output format (e.g. 'xyz') → per-file failure."""
        result = json.loads(model_converter.execute({
            "files": [{"path": "/some/model.obj", "outputFormat": "xyz"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_virtual_drive_empty_path_returns_error(self):
        """virtual_drive mode with empty outputPath → success=False."""
        result = json.loads(model_converter.execute({
            "files": [{"path": "/some/model.obj", "outputFormat": "stl"}],
            "outputMode": "virtual_drive",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])

    def test_response_has_standard_keys(self):
        """Error response always contains at minimum success and results."""
        result = json.loads(model_converter.execute({"files": [], "outputMode": "copy"}))
        self.assertIn("success", result)
        self.assertIn("results", result)


@unittest.skipUnless(TRIMESH_AVAILABLE, "trimesh not installed — skipping conversion tests")
class TestModelConverterIntegration(unittest.TestCase):
    """
    Real 3D conversion tests using a minimal OBJ cube created in setUp().
    Requires: pip install trimesh
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src_obj = os.path.join(self.tmp, "cube.obj")
        with open(self.src_obj, "w", encoding="utf-8") as f:
            f.write(_CUBE_OBJ)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, output_format, output_mode="copy", **kwargs):
        return json.loads(model_converter.execute({
            "files": [{"path": self.src_obj, "outputFormat": output_format}],
            "outputMode": output_mode,
            **kwargs,
        }))

    def test_convert_obj_to_stl_copy_mode(self):
        """OBJ → STL in copy mode: output .stl file is created."""
        result = self._run("stl")
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 1)
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".stl"))

    def test_convert_obj_to_ply_copy_mode(self):
        """OBJ → PLY in copy mode: output .ply file is created."""
        result = self._run("ply")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".ply"))

    def test_convert_obj_to_glb_copy_mode(self):
        """OBJ → GLB in copy mode: output .glb file is created."""
        result = self._run("glb")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".glb"))

    def test_stl_output_is_non_empty(self):
        """Output STL file must be non-empty (contains geometry data)."""
        result = self._run("stl")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertGreater(os.path.getsize(out), 0)

    def test_virtual_drive_mode_creates_folder(self):
        """virtual_drive mode: ModelConversionResults folder is created."""
        result = self._run("stl", output_mode="virtual_drive", outputPath=self.tmp)
        self.assertTrue(result["success"])
        self.assertIn("virtualDrivePath", result)
        drive = result["virtualDrivePath"]
        self.assertTrue(os.path.isdir(drive))
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.startswith(drive))

    def test_batch_two_models(self):
        """Batch of two OBJ models: total=2, succeeded=2, failed=0."""
        src2 = os.path.join(self.tmp, "cube2.obj")
        with open(src2, "w", encoding="utf-8") as f:
            f.write(_CUBE_OBJ)
        result = json.loads(model_converter.execute({
            "files": [
                {"path": self.src_obj, "outputFormat": "stl"},
                {"path": src2,         "outputFormat": "ply"},
            ],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 0)


if __name__ == "__main__":
    unittest.main()
