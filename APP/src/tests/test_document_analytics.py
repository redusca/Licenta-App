"""
PyUnit tests for the Document Analytics tool.

Tests cover:
  - compute_stats()      — local statistics from plain text
  - _count_syllables()   — syllable counter helper
  - _flesch_grade()      — Flesch score → readable grade label
  - extract_text()       — text extraction from TXT, MD, HTML (no external deps)
  - execute()            — full pipeline with mock LLM (includeLLM=False)
  - get_llm_insights()   — LLM gateway call (tested with mocked HTTP)
"""
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tools.document_analytics import (
    compute_stats,
    extract_text,
    get_llm_insights,
    execute,
    _count_syllables,
    _flesch_grade,
    _STOPWORDS,
)


# ── _count_syllables ─────────────────────────────────────────────────────────

class TestCountSyllables(unittest.TestCase):

    def test_single_vowel_word(self):
        self.assertGreaterEqual(_count_syllables("a"), 1)

    def test_simple_words(self):
        # "cat" → 1, "water" → 2, "beautiful" → 4
        self.assertEqual(_count_syllables("cat"), 1)
        self.assertEqual(_count_syllables("water"), 2)

    def test_empty_string(self):
        self.assertEqual(_count_syllables(""), 0)

    def test_silent_e(self):
        # "make" should count 1 (silent e rule)
        self.assertEqual(_count_syllables("make"), 1)

    def test_minimum_one(self):
        # Every non-empty word has at least 1 syllable
        for word in ["strength", "rhythm", "gym", "lynch"]:
            self.assertGreaterEqual(_count_syllables(word), 1)

    def test_returns_int(self):
        self.assertIsInstance(_count_syllables("hello"), int)


# ── _flesch_grade ─────────────────────────────────────────────────────────────

class TestFleschGrade(unittest.TestCase):

    def test_very_easy(self):
        label = _flesch_grade(95)
        self.assertIn("Very Easy", label)

    def test_easy(self):
        label = _flesch_grade(85)
        self.assertIn("Easy", label)

    def test_standard(self):
        label = _flesch_grade(65)
        self.assertIn("Standard", label)

    def test_difficult(self):
        label = _flesch_grade(35)
        self.assertIn("Difficult", label)

    def test_very_difficult(self):
        label = _flesch_grade(10)
        self.assertIn("Very Difficult", label)

    def test_returns_string(self):
        self.assertIsInstance(_flesch_grade(50), str)

    def test_boundary_90(self):
        self.assertIn("Very Easy", _flesch_grade(90))

    def test_boundary_60(self):
        self.assertIn("Standard", _flesch_grade(60))


# ── compute_stats ─────────────────────────────────────────────────────────────

class TestComputeStats(unittest.TestCase):

    _SIMPLE = "The quick brown fox jumps over the lazy dog."

    def test_word_count(self):
        stats = compute_stats(self._SIMPLE)
        self.assertEqual(stats["word_count"], 9)

    def test_sentence_count(self):
        text = "Hello world. How are you? Fine thanks!"
        stats = compute_stats(text)
        self.assertEqual(stats["sentence_count"], 3)

    def test_character_counts(self):
        stats = compute_stats(self._SIMPLE)
        self.assertEqual(stats["character_count"], len(self._SIMPLE))
        no_sp = self._SIMPLE.replace(" ", "").replace("\n", "")
        self.assertEqual(stats["character_count_no_spaces"], len(no_sp))

    def test_unique_words(self):
        text = "cat cat dog dog bird"
        stats = compute_stats(text)
        self.assertEqual(stats["unique_words"], 3)

    def test_paragraph_count(self):
        text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
        stats = compute_stats(text)
        self.assertEqual(stats["paragraph_count"], 3)

    def test_reading_time_positive(self):
        stats = compute_stats(self._SIMPLE)
        self.assertGreater(stats["reading_time_min"], 0)

    def test_estimated_pages_positive(self):
        stats = compute_stats(self._SIMPLE)
        self.assertGreater(stats["estimated_pages"], 0)

    def test_avg_word_length_positive(self):
        stats = compute_stats(self._SIMPLE)
        self.assertGreater(stats["avg_word_length"], 0)

    def test_avg_words_per_sentence_positive(self):
        stats = compute_stats(self._SIMPLE)
        self.assertGreater(stats["avg_words_per_sentence"], 0)

    def test_top_keywords_is_list(self):
        stats = compute_stats(self._SIMPLE)
        self.assertIsInstance(stats["top_keywords"], list)

    def test_stopwords_excluded_from_keywords(self):
        # If stopwords are in keywords, fail
        stats = compute_stats("the the the the the cat sat on the mat the the")
        for kw in stats["top_keywords"]:
            self.assertNotIn(kw, _STOPWORDS)

    def test_flesch_reading_ease_range(self):
        stats = compute_stats(self._SIMPLE)
        self.assertGreaterEqual(stats["flesch_reading_ease"], 0)
        self.assertLessEqual(stats["flesch_reading_ease"], 100)

    def test_flesch_grade_is_string(self):
        stats = compute_stats(self._SIMPLE)
        self.assertIsInstance(stats["flesch_grade"], str)

    def test_long_document(self):
        # 5000 words of repeated text — should not crash
        text = ("The quick brown fox jumps over the lazy dog. " * 250).strip()
        stats = compute_stats(text)
        self.assertEqual(stats["word_count"], 9 * 250)
        self.assertGreater(stats["reading_time_min"], 1)

    def test_single_word(self):
        stats = compute_stats("Hello")
        self.assertEqual(stats["word_count"], 1)
        self.assertEqual(stats["sentence_count"], 1)

    def test_returns_all_required_keys(self):
        required = {
            "word_count", "character_count", "character_count_no_spaces",
            "sentence_count", "paragraph_count", "unique_words",
            "avg_words_per_sentence", "avg_word_length",
            "reading_time_min", "estimated_pages",
            "top_keywords", "flesch_reading_ease", "flesch_grade",
        }
        stats = compute_stats(self._SIMPLE)
        self.assertTrue(required.issubset(stats.keys()))


# ── extract_text ──────────────────────────────────────────────────────────────

class TestExtractText(unittest.TestCase):

    def _write_tmp(self, content: str, suffix: str) -> str:
        f = tempfile.NamedTemporaryFile(mode="w", suffix=suffix,
                                        delete=False, encoding="utf-8")
        f.write(content)
        f.close()
        return f.name

    def tearDown(self):
        # Clean up temp files created in each test
        for attr in ("_tmp",):
            path = getattr(self, attr, None)
            if path and os.path.isfile(path):
                os.unlink(path)

    def test_txt_extraction(self):
        self._tmp = self._write_tmp("Hello plain text world!", ".txt")
        result = extract_text(self._tmp)
        self.assertIn("Hello plain text world!", result)

    def test_md_extraction(self):
        self._tmp = self._write_tmp("# Title\n\nSome **markdown** content.", ".md")
        result = extract_text(self._tmp)
        self.assertIn("Title", result)
        self.assertIn("markdown", result)

    def test_html_extraction_strips_tags(self):
        html = "<html><body><h1>Heading</h1><p>Paragraph text here.</p></body></html>"
        self._tmp = self._write_tmp(html, ".html")
        result = extract_text(self._tmp)
        self.assertIn("Heading", result)
        self.assertIn("Paragraph text here", result)
        self.assertNotIn("<h1>", result)

    def test_htm_extension(self):
        html = "<p>Simple HTML content.</p>"
        self._tmp = self._write_tmp(html, ".htm")
        result = extract_text(self._tmp)
        self.assertIn("Simple HTML content", result)

    def test_unsupported_extension_raises(self):
        self._tmp = self._write_tmp("data", ".xyz")
        with self.assertRaises(ValueError):
            extract_text(self._tmp)

    def test_unicode_preserved(self):
        self._tmp = self._write_tmp("Bună ziua! Как дела? 日本語", ".txt")
        result = extract_text(self._tmp)
        self.assertIn("Bună ziua", result)
        self.assertIn("日本語", result)

    def test_large_text_file(self):
        content = "Word " * 10_000
        self._tmp = self._write_tmp(content, ".txt")
        result = extract_text(self._tmp)
        self.assertGreater(len(result), 1000)


# ── execute() ────────────────────────────────────────────────────────────────

class TestExecute(unittest.TestCase):

    def _write_txt(self, content: str) -> str:
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".txt",
                                        delete=False, encoding="utf-8")
        f.write(content)
        f.close()
        return f.name

    def tearDown(self):
        path = getattr(self, "_tmp", None)
        if path and os.path.isfile(path):
            os.unlink(path)

    def test_missing_file_returns_error(self):
        result = json.loads(execute({"filePath": "/nonexistent/path/file.txt"}))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_empty_path_returns_error(self):
        result = json.loads(execute({"filePath": ""}))
        self.assertFalse(result["success"])

    def test_success_without_llm(self):
        self._tmp = self._write_txt("The quick brown fox jumps over the lazy dog. " * 10)
        result = json.loads(execute({"filePath": self._tmp, "includeLLM": False}))
        self.assertTrue(result["success"])
        self.assertIn("stats", result)
        self.assertIn("text_preview", result)
        self.assertIn("file_name", result)

    def test_stats_populated(self):
        self._tmp = self._write_txt("Hello world! This is a test document.")
        result = json.loads(execute({"filePath": self._tmp, "includeLLM": False}))
        self.assertTrue(result["success"])
        stats = result["stats"]
        self.assertGreater(stats["word_count"], 0)
        self.assertIsInstance(stats["top_keywords"], list)

    def test_text_preview_limited(self):
        self._tmp = self._write_txt("A" * 2000)
        result = json.loads(execute({"filePath": self._tmp, "includeLLM": False}))
        self.assertTrue(result["success"])
        # Preview should be capped at ~500 chars + ellipsis
        self.assertLessEqual(len(result["text_preview"]), 510)

    def test_file_metadata_in_result(self):
        self._tmp = self._write_txt("Some content here.")
        result = json.loads(execute({"filePath": self._tmp, "includeLLM": False}))
        self.assertTrue(result["success"])
        self.assertEqual(result["file_ext"], ".txt")
        self.assertGreater(result["file_size"], 0)

    def test_returns_valid_json(self):
        self._tmp = self._write_txt("Test.")
        raw = execute({"filePath": self._tmp, "includeLLM": False})
        parsed = json.loads(raw)
        self.assertIsInstance(parsed, dict)

    def test_empty_file_returns_error(self):
        self._tmp = self._write_txt("   \n  \n  ")
        result = json.loads(execute({"filePath": self._tmp, "includeLLM": False}))
        self.assertFalse(result["success"])
        self.assertIn("error", result)


# ── get_llm_insights (mocked HTTP) ───────────────────────────────────────────

class TestGetLlmInsights(unittest.TestCase):

    _TEXT = "The quick brown fox jumps over the lazy dog. " * 50

    def _mock_post(self, json_text: str):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"text": json_text}
        mock_resp.raise_for_status = MagicMock()
        return mock_resp

    @patch("tools.document_analytics.requests")
    def test_successful_response(self, mock_requests):
        payload = json.dumps({
            "summary": "A simple test document.",
            "topics": ["nature", "animals"],
            "tone": "informal",
            "entities": ["fox", "dog"],
        })
        mock_requests.post.return_value = self._mock_post(payload)
        import requests as _r
        mock_requests.exceptions = _r.exceptions
        result = get_llm_insights(self._TEXT, 450)
        self.assertIsNone(result["error"])
        self.assertEqual(result["summary"], "A simple test document.")
        self.assertIn("nature", result["topics"])
        self.assertEqual(result["tone"], "informal")

    @patch("tools.document_analytics.requests")
    def test_connection_error(self, mock_requests):
        import requests as _r
        mock_requests.post.side_effect = _r.exceptions.ConnectionError("refused")
        mock_requests.exceptions = _r.exceptions
        result = get_llm_insights(self._TEXT, 100)
        self.assertIsNotNone(result["error"])
        self.assertIn("not running", result["error"])

    @patch("tools.document_analytics.requests")
    def test_invalid_json_response(self, mock_requests):
        import requests as _r
        mock_requests.post.return_value = self._mock_post("not valid json at all {{{{")
        mock_requests.exceptions = _r.exceptions
        result = get_llm_insights(self._TEXT, 100)
        self.assertIsNotNone(result["error"])
        self.assertTrue(
            "JSON" in result["error"] or "unparseable" in result["error"],
            f"Unexpected error: {result['error']}"
        )

    @patch("tools.document_analytics.requests")
    def test_markdown_fence_stripped(self, mock_requests):
        import requests as _r
        payload = "```json\n" + json.dumps({
            "summary": "Stripped.",
            "topics": [], "tone": "formal", "entities": [],
        }) + "\n```"
        mock_requests.post.return_value = self._mock_post(payload)
        mock_requests.exceptions = _r.exceptions
        result = get_llm_insights(self._TEXT, 50)
        self.assertIsNone(result["error"])
        self.assertEqual(result["summary"], "Stripped.")

    @patch("tools.document_analytics.requests")
    def test_truncated_flag_long_document(self, mock_requests):
        import requests as _r
        payload = json.dumps({"summary": "S", "topics": [], "tone": "formal", "entities": []})
        mock_requests.post.return_value = self._mock_post(payload)
        mock_requests.exceptions = _r.exceptions
        result = get_llm_insights(self._TEXT, 5000)
        self.assertTrue(result["truncated"])

    @patch("tools.document_analytics.requests")
    def test_not_truncated_short_document(self, mock_requests):
        import requests as _r
        payload = json.dumps({"summary": "S", "topics": [], "tone": "formal", "entities": []})
        mock_requests.post.return_value = self._mock_post(payload)
        mock_requests.exceptions = _r.exceptions
        result = get_llm_insights("Hello world.", 2)
        self.assertFalse(result["truncated"])


if __name__ == "__main__":
    unittest.main()
