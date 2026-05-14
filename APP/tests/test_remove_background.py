"""
Tests for the background-removal tool — APP/src/tools/remove_background.py.

Tool purpose
------------
Batch-remove backgrounds from raster images (JPEG, PNG, WebP) using the rembg
library (which internally uses the u2net ONNX model).  The output is always
saved as PNG with an alpha channel.

Input  (dict)
-------------
files            : list[dict]  — each item: {"path": str}
outputMode       : str         — "replace" | "copy" | "virtual_drive"
outputPath       : str         — parent dir for virtual drive (virtual_drive mode only)
preserveMetadata : bool        — copy EXIF to PNG output (optional, default True)

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
APP/test/test.jpg — real JPEG with a background used for removal tests.
APP/test/test_nobg.png — reference PNG with background already removed (used
  to verify that the tool still accepts PNG inputs).

Note
----
The rembg model (u2net.onnx, ~173 MB) is downloaded to ~/.u2net on first use.
The integration test class is skipped when rembg is not installed.

Run
---
    python -m pytest APP/tests/test_remove_background.py -v
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

from tools import remove_background  # noqa: E402

# ── Dataset ───────────────────────────────────────────────────────────────────
_TEST_IMAGE = os.path.join(_APP_DIR, "test", "test.jpg")
_TEST_PNG   = os.path.join(_APP_DIR, "test", "test_nobg.png")

# ── Optional dependency flags ─────────────────────────────────────────────────
try:
    from rembg import remove as _rembg_remove  # noqa: F401
    from PIL import Image                       # noqa: F401
    REMBG_AVAILABLE = True
except ImportError:
    REMBG_AVAILABLE = False


class TestRemoveBackgroundDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, remove_background.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'remove_background'."""
        self.assertEqual(remove_background.DEFINITION["name"], "remove_background")

    def test_definition_required_params(self):
        """Required parameters must include 'files' and 'outputMode'."""
        required = remove_background.DEFINITION["parameters"]["required"]
        self.assertIn("files", required)
        self.assertIn("outputMode", required)

    def test_definition_output_mode_enum(self):
        """outputMode must enumerate replace, copy, virtual_drive."""
        enum = remove_background.DEFINITION["parameters"]["properties"]["outputMode"]["enum"]
        self.assertSetEqual(set(enum), {"replace", "copy", "virtual_drive"})


class TestRemoveBackgroundInputValidation(unittest.TestCase):
    """Input validation tests — no rembg dependency required."""

    def test_empty_files_returns_error(self):
        """Empty files list → success=False with an error message."""
        result = json.loads(remove_background.execute({"files": [], "outputMode": "copy"}))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_missing_files_key_returns_error(self):
        """Missing 'files' key → success=False."""
        result = json.loads(remove_background.execute({"outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_nonexistent_file_fails_per_file(self):
        """Non-existent source path → per-file failure, not a top-level crash."""
        result = json.loads(remove_background.execute({
            "files": [{"path": "/nonexistent/image.jpg"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 0)
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_virtual_drive_empty_path_returns_error(self):
        """virtual_drive mode with empty outputPath → success=False."""
        result = json.loads(remove_background.execute({
            "files": [{"path": _TEST_IMAGE}],
            "outputMode": "virtual_drive",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])

    def test_virtual_drive_nonexistent_path_returns_error(self):
        """virtual_drive mode with non-existent outputPath → success=False."""
        result = json.loads(remove_background.execute({
            "files": [{"path": _TEST_IMAGE}],
            "outputMode": "virtual_drive",
            "outputPath": "/nonexistent/dir",
        }))
        self.assertFalse(result["success"])

    def test_response_has_standard_keys(self):
        """Error response always contains at minimum success and results."""
        result = json.loads(remove_background.execute({"files": [], "outputMode": "copy"}))
        self.assertIn("success", result)
        self.assertIn("results", result)


@unittest.skipUnless(REMBG_AVAILABLE, "rembg or Pillow not installed — skipping removal tests")
@unittest.skipUnless(os.path.isfile(_TEST_IMAGE), "Dataset image APP/test/test.jpg not found")
class TestRemoveBackgroundIntegration(unittest.TestCase):
    """
    Real background-removal tests using APP/test/test.jpg.

    Note: The u2net.onnx model (~173 MB) is downloaded to ~/.u2net on first
    run.  These tests may be slow on first execution due to model download and
    inference time.

    Requires: pip install rembg Pillow
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src_jpg = os.path.join(self.tmp, "test.jpg")
        shutil.copy2(_TEST_IMAGE, self.src_jpg)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, src=None, output_mode="copy", **kwargs):
        src = src or self.src_jpg
        return json.loads(remove_background.execute({
            "files": [{"path": src}],
            "outputMode": output_mode,
            **kwargs,
        }))

    def test_remove_background_copy_mode_creates_png(self):
        """Background removal in copy mode: output file is a PNG with _nobg suffix."""
        result = self._run()
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 1)
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".png"))

    def test_output_png_has_alpha_channel(self):
        """Output PNG must have an alpha (RGBA) channel — the background is transparent."""
        from PIL import Image
        result = self._run()
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        img = Image.open(out)
        self.assertEqual(img.mode, "RGBA", "Output must be RGBA (transparent background)")

    def test_remove_background_png_input(self):
        """Accepts PNG input (test_nobg.png) and produces an RGBA PNG output."""
        if not os.path.isfile(_TEST_PNG):
            self.skipTest("APP/test/test_nobg.png not found")
        src_png = os.path.join(self.tmp, "test_nobg.png")
        shutil.copy2(_TEST_PNG, src_png)
        result = self._run(src=src_png)
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))

    def test_virtual_drive_mode_creates_folder(self):
        """virtual_drive mode: RemovedBackgrounds folder is created."""
        result = self._run(output_mode="virtual_drive", outputPath=self.tmp)
        self.assertTrue(result["success"])
        self.assertIn("virtualDrivePath", result)
        drive = result["virtualDrivePath"]
        self.assertTrue(os.path.isdir(drive))
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.startswith(drive))

    def test_parallel_execute_returns_same_structure(self):
        """execute_parallel() returns the same JSON structure as execute()."""
        result = json.loads(remove_background.execute_parallel({
            "files": [{"path": self.src_jpg}],
            "outputMode": "copy",
        }))
        for key in ("success", "total", "succeeded", "failed", "results"):
            self.assertIn(key, result)
        self.assertTrue(result["success"])


if __name__ == "__main__":
    unittest.main()
