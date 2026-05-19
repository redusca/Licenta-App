"""
PyUnit tests for the Subtitle Generator tool.

Tests cover:
  - srt_time()      — seconds → SRT timestamp string
  - build_srt()     — chunk list → SRT file content
  - _normalize_sfx() — Whisper sound-effect normalisation
"""
import sys
import os
import unittest

# Allow importing from APP/src without an installed package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tools.subtitle_generator import srt_time, build_srt

# Import the private normaliser from tools_routes (we test it separately)
try:
    import importlib, re, types

    # Build a minimal module stub so tools_routes imports don't fail
    # when heavy dependencies (Flask, etc.) are not present in the test env.
    _tools_routes = None
    from API.tools_routes import _normalize_sfx, _SFX_MAP, _LAUGH_NOISE_RE  # type: ignore
    _HAS_ROUTES = True
except Exception:
    _HAS_ROUTES = False


# ── srt_time ──────────────────────────────────────────────────────────────────

class TestSrtTime(unittest.TestCase):

    def test_zero(self):
        self.assertEqual(srt_time(0.0), "00:00:00,000")

    def test_seconds_only(self):
        self.assertEqual(srt_time(5.0), "00:00:05,000")

    def test_milliseconds(self):
        self.assertEqual(srt_time(1.5), "00:00:01,500")

    def test_minutes(self):
        self.assertEqual(srt_time(90.0), "00:01:30,000")

    def test_hours(self):
        self.assertEqual(srt_time(3661.0), "01:01:01,000")

    def test_negative_clamped_to_zero(self):
        self.assertEqual(srt_time(-1.0), "00:00:00,000")

    def test_millisecond_rounding(self):
        result = srt_time(1.9999)
        # Should not produce ,1000 — milliseconds must be < 1000
        self.assertNotIn(",1000", result)

    def test_fractional_millis(self):
        # 0.001 s → 1 ms
        self.assertEqual(srt_time(0.001), "00:00:00,001")

    def test_high_value(self):
        # 2h 30m 15.25s
        result = srt_time(9015.25)
        self.assertEqual(result, "02:30:15,250")

    def test_returns_string(self):
        self.assertIsInstance(srt_time(10.0), str)


# ── build_srt ─────────────────────────────────────────────────────────────────

class TestBuildSrt(unittest.TestCase):

    def _make_chunk(self, text, start, end):
        return {"text": text, "start": start, "end": end}

    def test_single_chunk(self):
        chunks = [self._make_chunk("Hello world.", 0.0, 2.5)]
        srt = build_srt(chunks)
        self.assertIn("1\n", srt)
        self.assertIn("00:00:00,000 --> 00:00:02,500", srt)
        self.assertIn("Hello world.", srt)

    def test_multiple_chunks_numbered_sequentially(self):
        chunks = [
            self._make_chunk("First line.", 0.0, 2.0),
            self._make_chunk("Second line.", 3.0, 5.5),
            self._make_chunk("Third line.", 6.0, 9.0),
        ]
        srt = build_srt(chunks)
        lines = srt.strip().split("\n\n")
        self.assertEqual(len(lines), 3)
        self.assertTrue(lines[0].startswith("1\n"))
        self.assertTrue(lines[1].startswith("2\n"))
        self.assertTrue(lines[2].startswith("3\n"))

    def test_empty_text_chunks_skipped(self):
        chunks = [
            self._make_chunk("Good text.", 0.0, 2.0),
            self._make_chunk("   ", 2.5, 3.0),   # whitespace-only
            self._make_chunk("", 3.0, 4.0),        # empty
            self._make_chunk("More text.", 4.5, 6.0),
        ]
        srt = build_srt(chunks)
        lines = srt.strip().split("\n\n")
        self.assertEqual(len(lines), 2)

    def test_empty_chunk_list(self):
        srt = build_srt([])
        self.assertEqual(srt, "")

    def test_all_empty_chunks(self):
        chunks = [self._make_chunk("", 0.0, 1.0), self._make_chunk("  ", 1.0, 2.0)]
        srt = build_srt(chunks)
        self.assertEqual(srt.strip(), "")

    def test_ends_with_newline(self):
        chunks = [self._make_chunk("Text.", 0.0, 1.0)]
        srt = build_srt(chunks)
        self.assertTrue(srt.endswith("\n"))

    def test_srt_format_structure(self):
        chunks = [self._make_chunk("Test.", 10.0, 12.0)]
        srt = build_srt(chunks)
        block_lines = srt.strip().split("\n")
        # block: index, timestamp, text
        self.assertEqual(block_lines[0].strip(), "1")
        self.assertIn("-->", block_lines[1])
        self.assertEqual(block_lines[2].strip(), "Test.")

    def test_timestamps_match_chunks(self):
        chunks = [self._make_chunk("Alpha.", 61.5, 63.75)]
        srt = build_srt(chunks)
        self.assertIn("00:01:01,500 --> 00:01:03,750", srt)

    def test_missing_start_defaults_zero(self):
        chunk = {"text": "Hello.", "end": 2.0}  # no 'start' key
        srt = build_srt([chunk])
        self.assertIn("00:00:00,000 -->", srt)

    def test_missing_end_defaults_zero(self):
        chunk = {"text": "Hello.", "start": 1.0}  # no 'end' key
        srt = build_srt([chunk])
        self.assertIn("--> 00:00:00,000", srt)

    def test_unicode_text(self):
        chunks = [self._make_chunk("Bună ziua. Cum ești?", 0.0, 3.0)]
        srt = build_srt(chunks)
        self.assertIn("Bună ziua. Cum ești?", srt)


# ── _normalize_sfx ────────────────────────────────────────────────────────────

@unittest.skipUnless(_HAS_ROUTES, "tools_routes not importable in this environment")
class TestNormalizeSfx(unittest.TestCase):

    def _chunk(self, text, start=0.0, end=1.0):
        return {"text": text, "start": start, "end": end}

    def test_laugh_bracket_replaced(self):
        chunks = [self._chunk("[laughing]")]
        result = _normalize_sfx(chunks)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["text"], "*laughs*")

    def test_laughter_variant_replaced(self):
        result = _normalize_sfx([self._chunk("[laughter]")])
        self.assertEqual(result[0]["text"], "*laughs*")

    def test_applause_replaced(self):
        result = _normalize_sfx([self._chunk("[applause]")])
        self.assertEqual(result[0]["text"], "*applause*")

    def test_music_replaced(self):
        result = _normalize_sfx([self._chunk("[music]")])
        self.assertEqual(result[0]["text"], "*music*")

    def test_noise_dropped(self):
        result = _normalize_sfx([self._chunk("[noise]")])
        self.assertEqual(len(result), 0)

    def test_silence_dropped(self):
        result = _normalize_sfx([self._chunk("[silence]")])
        self.assertEqual(len(result), 0)

    def test_inaudible_dropped(self):
        result = _normalize_sfx([self._chunk("[inaudible]")])
        self.assertEqual(len(result), 0)

    def test_laugh_noise_sequence_replaced(self):
        result = _normalize_sfx([self._chunk("ha ha ha ha ha")])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["text"], "*laughs*")

    def test_normal_text_unchanged(self):
        result = _normalize_sfx([self._chunk("Hello, how are you?")])
        self.assertEqual(result[0]["text"], "Hello, how are you?")

    def test_timestamps_preserved(self):
        result = _normalize_sfx([self._chunk("[music]", start=5.0, end=7.5)])
        # [music] → *music*, timestamps unchanged
        self.assertEqual(result[0]["start"], 5.0)
        self.assertEqual(result[0]["end"], 7.5)

    def test_empty_chunk_dropped(self):
        result = _normalize_sfx([self._chunk("")])
        self.assertEqual(len(result), 0)

    def test_mixed_batch(self):
        chunks = [
            self._chunk("Good morning."),
            self._chunk("[laughing]"),
            self._chunk("[noise]"),
            self._chunk("See you later."),
        ]
        result = _normalize_sfx(chunks)
        texts = [r["text"] for r in result]
        self.assertIn("Good morning.", texts)
        self.assertIn("*laughs*", texts)
        self.assertNotIn("[noise]", texts)
        self.assertIn("See you later.", texts)
        self.assertEqual(len(result), 3)

    def test_case_insensitive(self):
        result = _normalize_sfx([self._chunk("[LAUGHING]")])
        self.assertEqual(result[0]["text"], "*laughs*")

    def test_sound_marker_passthrough(self):
        result = _normalize_sfx([self._chunk("*laughs*")])
        self.assertEqual(result[0]["text"], "*laughs*")


if __name__ == "__main__":
    unittest.main()
