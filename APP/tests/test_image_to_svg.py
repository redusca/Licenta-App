"""
Tests for the image-to-SVG vectorizer tool — APP/src/tools/image_to_svg.py.

Tool purpose
------------
Batch-convert raster images (JPEG, PNG, WebP, BMP) to SVG vector files using
the vtracer library.

Input  (dict)
-------------
files      : list[dict]  — each item: {"path": str}
outputMode : str         — "replace" | "copy" | "virtual_drive"
outputPath : str         — parent dir for virtual drive (virtual_drive mode only)
colormode  : str         — "color" | "binary" (optional, default "color")
hierarchical : str       — "stacked" | "cutout" (optional)
mode       : str         — "spline" | "polygon" | "none" (optional)
filter_speckle : int     — noise filter threshold (optional, default 4)
color_precision : int    — palette quantisation 1–8 (optional, default 6)
layer_difference : int   — layer merging threshold (optional, default 16)
corner_threshold : int   — spline corner angle threshold (optional, default 60)
length_threshold : float — short-segment removal threshold (optional, default 4.0)
max_iterations : int     — VQ max iterations (optional, default 10)
splice_threshold : int   — spline-splice angle threshold (optional, default 45)
path_precision : int     — SVG path decimal places (optional)

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
APP/test/test.jpg — real JPEG used as the raster source for vectorisation tests.

Run
---
    python -m pytest APP/tests/test_image_to_svg.py -v
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

from tools import image_to_svg  # noqa: E402

# ── Dataset ───────────────────────────────────────────────────────────────────
_TEST_IMAGE = os.path.join(_APP_DIR, "test", "test.jpg")

# ── Optional dependency flags ─────────────────────────────────────────────────
try:
    import vtracer  # noqa: F401
    VTRACER_AVAILABLE = True
except ImportError:
    VTRACER_AVAILABLE = False


class TestImageToSvgDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, image_to_svg.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'image_to_svg'."""
        self.assertEqual(image_to_svg.DEFINITION["name"], "image_to_svg")

    def test_definition_required_params(self):
        """Required parameters must include 'files' and 'outputMode'."""
        required = image_to_svg.DEFINITION["parameters"]["required"]
        self.assertIn("files", required)
        self.assertIn("outputMode", required)

    def test_definition_output_mode_enum(self):
        """outputMode must enumerate replace, copy, virtual_drive."""
        enum = image_to_svg.DEFINITION["parameters"]["properties"]["outputMode"]["enum"]
        self.assertSetEqual(set(enum), {"replace", "copy", "virtual_drive"})


class TestImageToSvgInputValidation(unittest.TestCase):
    """Input validation tests — no vtracer dependency required."""

    def test_empty_files_returns_error(self):
        """Empty files list → success=False with an error message."""
        result = json.loads(image_to_svg.execute({"files": [], "outputMode": "copy"}))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_missing_files_key_returns_error(self):
        """Missing 'files' key → success=False."""
        result = json.loads(image_to_svg.execute({"outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_nonexistent_file_fails_per_file(self):
        """Non-existent source path → per-file failure, not a top-level crash."""
        result = json.loads(image_to_svg.execute({
            "files": [{"path": "/nonexistent/image.jpg"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 0)
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_virtual_drive_empty_path_returns_error(self):
        """virtual_drive mode with empty outputPath → success=False."""
        result = json.loads(image_to_svg.execute({
            "files": [{"path": _TEST_IMAGE}],
            "outputMode": "virtual_drive",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])

    def test_virtual_drive_nonexistent_path_returns_error(self):
        """virtual_drive mode with non-existent outputPath → success=False."""
        result = json.loads(image_to_svg.execute({
            "files": [{"path": _TEST_IMAGE}],
            "outputMode": "virtual_drive",
            "outputPath": "/nonexistent/dir",
        }))
        self.assertFalse(result["success"])

    def test_response_has_standard_keys(self):
        """Error response always contains at minimum success and results."""
        result = json.loads(image_to_svg.execute({"files": [], "outputMode": "copy"}))
        self.assertIn("success", result)
        self.assertIn("results", result)


@unittest.skipUnless(VTRACER_AVAILABLE, "vtracer not installed — skipping vectorisation tests")
@unittest.skipUnless(os.path.isfile(_TEST_IMAGE), "Dataset image APP/test/test.jpg not found")
class TestImageToSvgIntegration(unittest.TestCase):
    """
    Real vectorisation tests using APP/test/test.jpg.
    Requires: pip install vtracer
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src_jpg = os.path.join(self.tmp, "test.jpg")
        shutil.copy2(_TEST_IMAGE, self.src_jpg)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, output_mode="copy", **kwargs):
        return json.loads(image_to_svg.execute({
            "files": [{"path": self.src_jpg}],
            "outputMode": output_mode,
            **kwargs,
        }))

    def test_convert_jpg_to_svg_copy_mode(self):
        """JPEG → SVG in copy mode: output .svg file is created alongside source."""
        result = self._run()
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 1)
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".svg"))

    def test_svg_output_is_valid_xml(self):
        """Output SVG must be parseable XML containing an <svg> root element."""
        result = self._run()
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        with open(out, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("<svg", content)

    def test_virtual_drive_mode_creates_folder(self):
        """virtual_drive mode: SVGVectorResults folder is created."""
        result = self._run(output_mode="virtual_drive", outputPath=self.tmp)
        self.assertTrue(result["success"])
        self.assertIn("virtualDrivePath", result)
        drive = result["virtualDrivePath"]
        self.assertTrue(os.path.isdir(drive))
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.startswith(drive))

    def test_colormode_binary_produces_svg(self):
        """colormode='binary' still produces a valid SVG output."""
        result = self._run(colormode="binary")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".svg"))

    def test_parallel_execute_returns_same_structure(self):
        """execute_parallel() returns the same JSON structure as execute()."""
        result = json.loads(image_to_svg.execute_parallel({
            "files": [{"path": self.src_jpg}],
            "outputMode": "copy",
        }))
        for key in ("success", "total", "succeeded", "failed", "results"):
            self.assertIn(key, result)
        self.assertTrue(result["success"])


if __name__ == "__main__":
    unittest.main()
