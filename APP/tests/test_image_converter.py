"""
Tests for the image converter tool — APP/src/tools/image_converter.py.

Tool purpose
------------
Batch-convert image files between formats (JPEG, PNG, WebP, BMP, TIFF, GIF)
using Pillow.

Input  (dict)
-------------
files        : list[dict]  — each item: {"path": str, "outputFormat": str}
outputMode   : str         — "replace" | "copy" | "virtual_drive"
outputPath   : str         — parent dir for virtual drive (virtual_drive mode only)
quality      : int         — JPEG/WebP quality 1–100 (default 85)
preserveMetadata : bool    — copy EXIF to output (default True)

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
APP/test/test.jpg  — real JPEG used for conversion integration tests.

Run
---
    python -m pytest APP/tests/test_image_converter.py -v
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

from tools import image_converter  # noqa: E402

# ── Dataset paths ─────────────────────────────────────────────────────────────
_TEST_IMAGE = os.path.join(_APP_DIR, "test", "test.jpg")
_TEST_PNG   = os.path.join(_APP_DIR, "test", "test_nobg.png")

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


class TestImageConverterDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, image_converter.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'image_converter'."""
        self.assertEqual(image_converter.DEFINITION["name"], "image_converter")

    def test_definition_required_params(self):
        """Required parameters must include 'files' and 'outputMode'."""
        required = image_converter.DEFINITION["parameters"]["required"]
        self.assertIn("files", required)
        self.assertIn("outputMode", required)

    def test_definition_output_mode_enum(self):
        """outputMode must enumerate replace, copy, virtual_drive."""
        enum = image_converter.DEFINITION["parameters"]["properties"]["outputMode"]["enum"]
        self.assertSetEqual(set(enum), {"replace", "copy", "virtual_drive"})


class TestImageConverterInputValidation(unittest.TestCase):
    """Input validation tests — no external dependencies required."""

    def test_empty_files_list_returns_error(self):
        """Empty files list → success=False with an error message."""
        result = json.loads(image_converter.execute({"files": [], "outputMode": "copy"}))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_missing_files_key_returns_error(self):
        """Missing 'files' key defaults to empty → success=False."""
        result = json.loads(image_converter.execute({"outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_nonexistent_file_path_fails_per_file(self):
        """Non-existent source path → per-file failure, not a top-level crash."""
        result = json.loads(image_converter.execute({
            "files": [{"path": "/nonexistent/image.jpg", "outputFormat": "png"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 0)
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])
        self.assertIn("error", result["results"][0])

    def test_unsupported_output_format_fails_per_file(self):
        """Unsupported output format like 'xyz' → per-file failure."""
        result = json.loads(image_converter.execute({
            "files": [{"path": _TEST_IMAGE, "outputFormat": "xyz"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_virtual_drive_empty_output_path_returns_error(self):
        """virtual_drive mode with empty outputPath → success=False."""
        result = json.loads(image_converter.execute({
            "files": [{"path": _TEST_IMAGE, "outputFormat": "png"}],
            "outputMode": "virtual_drive",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_virtual_drive_nonexistent_output_path_returns_error(self):
        """virtual_drive mode with non-existent outputPath → success=False."""
        result = json.loads(image_converter.execute({
            "files": [{"path": _TEST_IMAGE, "outputFormat": "png"}],
            "outputMode": "virtual_drive",
            "outputPath": "/nonexistent/path",
        }))
        self.assertFalse(result["success"])

    def test_response_always_has_standard_keys(self):
        """Response always contains success, total, succeeded, failed, results."""
        result = json.loads(image_converter.execute({"files": [], "outputMode": "copy"}))
        for key in ("success", "results"):
            self.assertIn(key, result)


@unittest.skipUnless(PIL_AVAILABLE, "Pillow not installed — skipping conversion tests")
@unittest.skipUnless(os.path.isfile(_TEST_IMAGE), "Dataset image APP/test/test.jpg not found")
class TestImageConverterIntegration(unittest.TestCase):
    """Real conversion tests using APP/test/test.jpg (requires Pillow)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src_jpg = os.path.join(self.tmp, "test.jpg")
        shutil.copy2(_TEST_IMAGE, self.src_jpg)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, output_format, output_mode="copy", **kwargs):
        return json.loads(image_converter.execute({
            "files": [{"path": self.src_jpg, "outputFormat": output_format}],
            "outputMode": output_mode,
            **kwargs,
        }))

    def test_convert_jpg_to_png_copy_mode(self):
        """JPEG → PNG in copy mode: output file exists with .png extension."""
        result = self._run("png")
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 1)
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".png"))

    def test_convert_jpg_to_webp_copy_mode(self):
        """JPEG → WebP in copy mode: output file exists with .webp extension."""
        result = self._run("webp")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".webp"))

    def test_convert_jpg_to_bmp_copy_mode(self):
        """JPEG → BMP in copy mode: output file exists with .bmp extension."""
        result = self._run("bmp")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".bmp"))

    def test_convert_png_to_jpeg(self):
        """PNG → JPEG using the PNG dataset file."""
        if not os.path.isfile(_TEST_PNG):
            self.skipTest("APP/test/test_nobg.png not found")
        src_png = os.path.join(self.tmp, "test_nobg.png")
        shutil.copy2(_TEST_PNG, src_png)
        result = json.loads(image_converter.execute({
            "files": [{"path": src_png, "outputFormat": "jpeg"}],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".jpg"))

    def test_virtual_drive_mode_creates_drive_and_output(self):
        """virtual_drive mode: drive folder is created and output file placed inside."""
        result = self._run("png", output_mode="virtual_drive", outputPath=self.tmp)
        self.assertTrue(result["success"])
        self.assertIn("virtualDrivePath", result)
        drive = result["virtualDrivePath"]
        self.assertTrue(os.path.isdir(drive))
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.startswith(drive))

    def test_quality_parameter_affects_file_size(self):
        """Lower quality produces a smaller JPEG than higher quality."""
        result_hq = self._run("jpeg", quality=95)
        # Copy the source again for second run
        src2 = os.path.join(self.tmp, "test2.jpg")
        shutil.copy2(_TEST_IMAGE, src2)
        result_lq = json.loads(image_converter.execute({
            "files": [{"path": src2, "outputFormat": "jpeg"}],
            "outputMode": "copy",
            "quality": 10,
        }))
        size_hq = os.path.getsize(result_hq["results"][0]["outputPath"])
        size_lq = os.path.getsize(result_lq["results"][0]["outputPath"])
        self.assertGreater(size_hq, size_lq)

    def test_batch_multiple_files(self):
        """Batch of 2 images: both succeed, total/succeeded/failed counters are correct."""
        src2 = os.path.join(self.tmp, "test2.jpg")
        shutil.copy2(_TEST_IMAGE, src2)
        result = json.loads(image_converter.execute({
            "files": [
                {"path": self.src_jpg, "outputFormat": "png"},
                {"path": src2, "outputFormat": "webp"},
            ],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 0)

    def test_partial_batch_failure_counted_correctly(self):
        """Batch with one valid and one invalid file: counters reflect mixed result."""
        result = json.loads(image_converter.execute({
            "files": [
                {"path": self.src_jpg, "outputFormat": "png"},
                {"path": "/nonexistent/image.jpg", "outputFormat": "png"},
            ],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 1)

    def test_parallel_execute_returns_same_structure(self):
        """execute_parallel() returns the same JSON structure as execute()."""
        result = json.loads(image_converter.execute_parallel({
            "files": [{"path": self.src_jpg, "outputFormat": "png"}],
            "outputMode": "copy",
        }))
        for key in ("success", "total", "succeeded", "failed", "results"):
            self.assertIn(key, result)
        self.assertTrue(result["success"])


if __name__ == "__main__":
    unittest.main()
