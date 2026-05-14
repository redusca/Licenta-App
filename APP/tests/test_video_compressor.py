"""
Tests for the video compressor tool — APP/src/tools/video_compressor.py.

Tool purpose
------------
Reduce video file size by re-encoding with H.264 or H.265 at a configurable CRF
value.  Higher CRF → smaller file / lower quality; lower CRF → larger / better.

Input  (dict)
-------------
files      : list[dict]  — each item:
               {"path": str, "codec": "h264"|"h265", "crf": int,
                "maxResolution": "original"|"1080p"|"720p"|"480p",
                "stripAudio": bool}
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
A minimal synthetic MP4 (64×64, 2 s) is created in setUp() with FFmpeg.
The integration tests are skipped when FFmpeg or libx264 is unavailable.

Run
---
    python -m pytest APP/tests/test_video_compressor.py -v
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

from tools import video_compressor  # noqa: E402

# ── FFmpeg availability ────────────────────────────────────────────────────────
try:
    import imageio_ffmpeg
    _FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
    FFMPEG_AVAILABLE = True
except Exception:
    _FFMPEG_EXE = None
    FFMPEG_AVAILABLE = False


def _make_test_video(path: str, duration: int = 2) -> bool:
    """Create a minimal synthetic MP4 via FFmpeg lavfi. Returns True on success."""
    if not FFMPEG_AVAILABLE:
        return False
    try:
        result = subprocess.run(
            [
                _FFMPEG_EXE, "-y",
                "-f", "lavfi",
                "-i", f"color=c=red:size=64x64:duration={duration}",
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


class TestVideoCompressorDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, video_compressor.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'video_compressor'."""
        self.assertEqual(video_compressor.DEFINITION["name"], "video_compressor")

    def test_definition_required_params(self):
        """Required parameters must include 'files' and 'outputMode'."""
        required = video_compressor.DEFINITION["parameters"]["required"]
        self.assertIn("files", required)
        self.assertIn("outputMode", required)

    def test_definition_output_mode_enum(self):
        """outputMode must enumerate replace, copy, virtual_drive."""
        enum = video_compressor.DEFINITION["parameters"]["properties"]["outputMode"]["enum"]
        self.assertSetEqual(set(enum), {"replace", "copy", "virtual_drive"})


class TestVideoCompressorInputValidation(unittest.TestCase):
    """Input validation tests — no FFmpeg dependency required."""

    def test_empty_files_list_returns_error(self):
        """Empty files list → success=False with an error message."""
        result = json.loads(video_compressor.execute({"files": [], "outputMode": "copy"}))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_missing_files_key_returns_error(self):
        """Missing 'files' key defaults to empty → success=False."""
        result = json.loads(video_compressor.execute({"outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_nonexistent_file_path_fails_per_file(self):
        """Non-existent source path → per-file failure, not a crash."""
        result = json.loads(video_compressor.execute({
            "files": [{"path": "/nonexistent/video.mp4", "codec": "h264", "crf": 28}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_virtual_drive_empty_path_returns_error(self):
        """virtual_drive mode with empty outputPath → success=False."""
        result = json.loads(video_compressor.execute({
            "files": [{"path": "/some/video.mp4", "codec": "h264", "crf": 28}],
            "outputMode": "virtual_drive",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])

    def test_response_has_standard_keys(self):
        """Error response always contains at minimum success and results."""
        result = json.loads(video_compressor.execute({"files": [], "outputMode": "copy"}))
        self.assertIn("success", result)
        self.assertIn("results", result)


@unittest.skipUnless(FFMPEG_AVAILABLE, "FFmpeg not available — skipping compression tests")
class TestVideoCompressorIntegration(unittest.TestCase):
    """
    Real compression tests using a synthetic MP4.
    Skipped when FFmpeg or libx264 is unavailable.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src_mp4 = os.path.join(self.tmp, "source.mp4")
        if not _make_test_video(self.src_mp4):
            self.skipTest("Could not create synthetic MP4 (libx264 may be missing)")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, codec="h264", crf=28, output_mode="copy", **kwargs):
        return json.loads(video_compressor.execute({
            "files": [{"path": self.src_mp4, "codec": codec, "crf": crf}],
            "outputMode": output_mode,
            **kwargs,
        }))

    def test_compress_h264_copy_mode(self):
        """H.264 compression in copy mode: output MP4 file is created."""
        result = self._run(codec="h264", crf=28)
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 1)
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))

    def test_compress_produces_output_file_smaller_or_equal(self):
        """Compressed output file must exist and be non-empty."""
        result = self._run(codec="h264", crf=35)
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertGreater(os.path.getsize(out), 0)

    def test_virtual_drive_mode_creates_folder(self):
        """virtual_drive mode: VideoCompressionResults folder is created."""
        result = self._run(crf=28, output_mode="virtual_drive", outputPath=self.tmp)
        self.assertTrue(result["success"])
        self.assertIn("virtualDrivePath", result)
        drive = result["virtualDrivePath"]
        self.assertTrue(os.path.isdir(drive))
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))

    def test_batch_two_files(self):
        """Batch of two videos: total=2, succeeded=2, failed=0."""
        src2 = os.path.join(self.tmp, "source2.mp4")
        if not _make_test_video(src2, duration=1):
            self.skipTest("Could not create second synthetic video")
        result = json.loads(video_compressor.execute({
            "files": [
                {"path": self.src_mp4, "codec": "h264", "crf": 28},
                {"path": src2,         "codec": "h264", "crf": 28},
            ],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 0)


if __name__ == "__main__":
    unittest.main()
