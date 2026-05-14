"""
Tests for the audio converter tool — APP/src/tools/audio_converter.py.

Tool purpose
------------
Batch-convert audio files between formats (MP3, WAV, M4A, AAC, FLAC, OGG)
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
test_modele_ai/dataset/dataset_audio/audio_files/wavs/LJ001-0011.wav
  — real WAV file from the LJSpeech dataset used for conversion tests.

Run
---
    python -m pytest APP/tests/test_audio_converter.py -v
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
_PROJ_ROOT = os.path.dirname(_APP_DIR)
_SRC_DIR   = os.path.join(_APP_DIR, "src")
sys.path.insert(0, _SRC_DIR)

from tools import audio_converter  # noqa: E402

# ── Dataset paths ─────────────────────────────────────────────────────────────
_WAVS_DIR   = os.path.join(_PROJ_ROOT, "test_modele_ai", "dataset",
                            "dataset_audio", "audio_files", "wavs")
_WAV_FILE   = os.path.join(_WAVS_DIR, "LJ001-0011.wav")
_WAV_FILE2  = os.path.join(_WAVS_DIR, "LJ001-0012.wav")

try:
    import imageio_ffmpeg
    imageio_ffmpeg.get_ffmpeg_exe()
    FFMPEG_AVAILABLE = True
except Exception:
    FFMPEG_AVAILABLE = False


class TestAudioConverterDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, audio_converter.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'audio_converter'."""
        self.assertEqual(audio_converter.DEFINITION["name"], "audio_converter")

    def test_definition_required_params(self):
        """Required parameters must include 'files' and 'outputMode'."""
        required = audio_converter.DEFINITION["parameters"]["required"]
        self.assertIn("files", required)
        self.assertIn("outputMode", required)

    def test_definition_output_mode_enum(self):
        """outputMode must enumerate replace, copy, virtual_drive."""
        enum = audio_converter.DEFINITION["parameters"]["properties"]["outputMode"]["enum"]
        self.assertSetEqual(set(enum), {"replace", "copy", "virtual_drive"})


class TestAudioConverterInputValidation(unittest.TestCase):
    """Input validation tests — no FFmpeg dependency required."""

    def test_empty_files_list_returns_error(self):
        """Empty files list → success=False with an error message."""
        result = json.loads(audio_converter.execute({"files": [], "outputMode": "copy"}))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_missing_files_key_returns_error(self):
        """Missing 'files' key defaults to empty → success=False."""
        result = json.loads(audio_converter.execute({"outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_nonexistent_file_path_fails_per_file(self):
        """Non-existent source path → per-file failure."""
        result = json.loads(audio_converter.execute({
            "files": [{"path": "/nonexistent/audio.wav", "outputFormat": "mp3"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 0)
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_unsupported_output_format_fails_per_file(self):
        """Unsupported output format → per-file failure."""
        result = json.loads(audio_converter.execute({
            "files": [{"path": _WAV_FILE, "outputFormat": "xyz"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_virtual_drive_empty_output_path_returns_error(self):
        """virtual_drive mode with empty outputPath → success=False."""
        result = json.loads(audio_converter.execute({
            "files": [{"path": _WAV_FILE, "outputFormat": "mp3"}],
            "outputMode": "virtual_drive",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])

    def test_virtual_drive_nonexistent_path_returns_error(self):
        """virtual_drive mode with non-existent outputPath → success=False."""
        result = json.loads(audio_converter.execute({
            "files": [{"path": _WAV_FILE, "outputFormat": "mp3"}],
            "outputMode": "virtual_drive",
            "outputPath": "/nonexistent/dir",
        }))
        self.assertFalse(result["success"])

    def test_response_has_standard_keys(self):
        """Error response always contains at minimum success and results."""
        result = json.loads(audio_converter.execute({"files": [], "outputMode": "copy"}))
        self.assertIn("success", result)
        self.assertIn("results", result)


@unittest.skipUnless(FFMPEG_AVAILABLE, "FFmpeg not available — skipping conversion tests")
@unittest.skipUnless(os.path.isfile(_WAV_FILE), "Dataset WAV file not found")
class TestAudioConverterIntegration(unittest.TestCase):
    """
    Real conversion tests using LJSpeech WAV files from the dataset.
    Requires FFmpeg to be installed (via imageio_ffmpeg).
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src_wav = os.path.join(self.tmp, "LJ001-0011.wav")
        shutil.copy2(_WAV_FILE, self.src_wav)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, output_format, output_mode="copy", **kwargs):
        return json.loads(audio_converter.execute({
            "files": [{"path": self.src_wav, "outputFormat": output_format}],
            "outputMode": output_mode,
            **kwargs,
        }))

    def test_convert_wav_to_mp3_copy_mode(self):
        """WAV → MP3 in copy mode: output file exists with .mp3 extension."""
        result = self._run("mp3")
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["succeeded"], 1)
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".mp3"))

    def test_convert_wav_to_flac_copy_mode(self):
        """WAV → FLAC in copy mode: output file exists with .flac extension."""
        result = self._run("flac")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".flac"))

    def test_convert_wav_to_ogg_copy_mode(self):
        """WAV → OGG in copy mode: output file exists with .ogg extension."""
        result = self._run("ogg")
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".ogg"))

    def test_virtual_drive_mode_creates_drive_folder(self):
        """virtual_drive mode: AudioConversionResults folder is created."""
        result = self._run("mp3", output_mode="virtual_drive", outputPath=self.tmp)
        self.assertTrue(result["success"])
        self.assertIn("virtualDrivePath", result)
        drive = result["virtualDrivePath"]
        self.assertTrue(os.path.isdir(drive))
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.startswith(drive))

    def test_batch_two_wav_files(self):
        """Batch convert two WAV files: total=2, succeeded=2, failed=0."""
        if not os.path.isfile(_WAV_FILE2):
            self.skipTest("Second dataset WAV file not found")
        src2 = os.path.join(self.tmp, "LJ001-0012.wav")
        shutil.copy2(_WAV_FILE2, src2)
        result = json.loads(audio_converter.execute({
            "files": [
                {"path": self.src_wav, "outputFormat": "mp3"},
                {"path": src2, "outputFormat": "flac"},
            ],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 0)

    def test_partial_batch_failure_counted_correctly(self):
        """One valid + one invalid file: succeeded=1, failed=1."""
        result = json.loads(audio_converter.execute({
            "files": [
                {"path": self.src_wav, "outputFormat": "mp3"},
                {"path": "/nonexistent/audio.wav", "outputFormat": "mp3"},
            ],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 1)

    def test_parallel_execute_returns_same_structure(self):
        """execute_parallel() returns the same JSON structure as execute()."""
        result = json.loads(audio_converter.execute_parallel({
            "files": [{"path": self.src_wav, "outputFormat": "mp3"}],
            "outputMode": "copy",
        }))
        for key in ("success", "total", "succeeded", "failed", "results"):
            self.assertIn(key, result)
        self.assertTrue(result["success"])


if __name__ == "__main__":
    unittest.main()
