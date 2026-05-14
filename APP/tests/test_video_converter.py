"""
Tests for the video converter tool — APP/src/tools/video_converter.py.

Tool purpose
------------
Batch-convert video files between formats (MP4, AVI, MKV, MOV, WMV, FLV, WebM)
using FFmpeg via imageio_ffmpeg.

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
A minimal synthetic MP4 is created in setUp() using FFmpeg's lavfi source
(color=blue, 64×64, 2 seconds).  The test is skipped if FFmpeg is unavailable.

Run
---
    python -m pytest APP/tests/test_video_converter.py -v
"""
import sys
import os
import json
import shutil
import subprocess
import tempfile
import unittest

# ── Path setup ────────────────────────────────────────────────────────────────
_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR   = os.path.dirname(_TESTS_DIR)
_SRC_DIR   = os.path.join(_APP_DIR, "src")
sys.path.insert(0, _SRC_DIR)

from tools import video_converter  # noqa: E402

# ── FFmpeg availability ────────────────────────────────────────────────────────
try:
    import imageio_ffmpeg
    _FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
    FFMPEG_AVAILABLE = True
except Exception:
    _FFMPEG_EXE = None
    FFMPEG_AVAILABLE = False


def _make_test_video(path: str, duration: int = 2) -> bool:
    """Create a minimal synthetic MP4 using FFmpeg's color source. Returns True on success."""
    if not FFMPEG_AVAILABLE:
        return False
    try:
        result = subprocess.run(
            [
                _FFMPEG_EXE, "-y",
                "-f", "lavfi",
                "-i", f"color=c=blue:size=64x64:duration={duration}",
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-t", str(duration),
                path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return result.returncode == 0 and os.path.isfile(path)
    except Exception:
        return False


class TestVideoConverterDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, video_converter.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'video_converter'."""
        self.assertEqual(video_converter.DEFINITION["name"], "video_converter")

    def test_definition_required_params(self):
        """Required parameters must include 'files' and 'outputMode'."""
        required = video_converter.DEFINITION["parameters"]["required"]
        self.assertIn("files", required)
        self.assertIn("outputMode", required)

    def test_definition_output_mode_enum(self):
        """outputMode must enumerate replace, copy, virtual_drive."""
        enum = video_converter.DEFINITION["parameters"]["properties"]["outputMode"]["enum"]
        self.assertSetEqual(set(enum), {"replace", "copy", "virtual_drive"})


class TestVideoConverterInputValidation(unittest.TestCase):
    """Input validation tests — no FFmpeg dependency required."""

    def test_empty_files_list_returns_error(self):
        """Empty files list → success=False with an error message."""
        result = json.loads(video_converter.execute({"files": [], "outputMode": "copy"}))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_missing_files_key_returns_error(self):
        """Missing 'files' key defaults to empty → success=False."""
        result = json.loads(video_converter.execute({"outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_nonexistent_file_path_fails_per_file(self):
        """Non-existent source path → per-file failure."""
        result = json.loads(video_converter.execute({
            "files": [{"path": "/nonexistent/video.mp4", "outputFormat": "avi"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 0)
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_unsupported_output_format_fails_per_file(self):
        """Unsupported output format → per-file failure (not a crash)."""
        result = json.loads(video_converter.execute({
            "files": [{"path": "/nonexistent/video.mp4", "outputFormat": "xyz"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_virtual_drive_empty_output_path_returns_error(self):
        """virtual_drive mode with empty outputPath → success=False."""
        result = json.loads(video_converter.execute({
            "files": [{"path": "/some/video.mp4", "outputFormat": "avi"}],
            "outputMode": "virtual_drive",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])

    def test_response_has_standard_keys(self):
        """Error response always contains at minimum success and results."""
        result = json.loads(video_converter.execute({"files": [], "outputMode": "copy"}))
        self.assertIn("success", result)
        self.assertIn("results", result)


@unittest.skipUnless(FFMPEG_AVAILABLE, "FFmpeg not available — skipping conversion tests")
class TestVideoConverterIntegration(unittest.TestCase):
    """
    Real conversion tests using a synthetic MP4 created via FFmpeg lavfi.
    Skipped entirely if FFmpeg is unavailable or if the synthetic video cannot
    be created (e.g. libx264 codec missing from the FFmpeg build).
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src_mp4 = os.path.join(self.tmp, "test_video.mp4")
        if not _make_test_video(self.src_mp4):
            self.skipTest("Could not create synthetic test video (libx264 may be missing)")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, output_format, output_mode="copy", **kwargs):
        return json.loads(video_converter.execute({
            "files": [{"path": self.src_mp4, "outputFormat": output_format}],
            "outputMode": output_mode,
            **kwargs,
        }))

    def test_convert_mp4_to_avi_copy_mode(self):
        """MP4 → AVI in copy mode: output file exists with .avi extension."""
        result = self._run("avi")
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 1)
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".avi"))

    def test_convert_mp4_to_mkv_copy_mode(self):
        """MP4 → MKV in copy mode: output file exists with .mkv extension."""
        result = self._run("mkv")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".mkv"))

    def test_convert_mp4_to_webm_copy_mode(self):
        """MP4 → WebM in copy mode: output file exists with .webm extension."""
        result = self._run("webm")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".webm"))

    def test_virtual_drive_mode_creates_drive_folder(self):
        """virtual_drive mode: VideoConversionResults folder is created."""
        result = self._run("avi", output_mode="virtual_drive", outputPath=self.tmp)
        self.assertTrue(result["success"])
        self.assertIn("virtualDrivePath", result)
        drive = result["virtualDrivePath"]
        self.assertTrue(os.path.isdir(drive))
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))

    def test_batch_two_videos(self):
        """Batch of two videos: total=2, succeeded=2, failed=0."""
        src2 = os.path.join(self.tmp, "test_video2.mp4")
        if not _make_test_video(src2, duration=1):
            self.skipTest("Could not create second synthetic video")
        result = json.loads(video_converter.execute({
            "files": [
                {"path": self.src_mp4, "outputFormat": "avi"},
                {"path": src2, "outputFormat": "mkv"},
            ],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 0)


if __name__ == "__main__":
    unittest.main()
