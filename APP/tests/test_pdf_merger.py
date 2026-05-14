"""
Tests for the PDF merger / splitter tool — APP/src/tools/pdf_merger.py.

Tool purpose
------------
Merge multiple PDFs into one, split a PDF by page ranges, reorder pages, and
convert between PDF and DOCX.

Input  (dict)
-------------
action         : str        — "merge" | "split" | "reorder" | "convert" | "page_info"
files          : list[dict] — each item: {"path": str}
outputMode     : str        — "replace" | "copy" | "virtual_drive"
outputPath     : str        — parent dir for virtual drive
outputFilename : str        — base name for merged/split outputs (no extension)
pageRanges     : str        — comma-separated ranges for split, e.g. "1-2,4"
convertTo      : str        — "pdf" | "docx" (for convert action)
pageOrder      : list[int]  — 1-indexed page order for reorder

Output (JSON string)
--------------------
{
  "success"         : bool,
  "total"           : int,
  "succeeded"       : int,
  "failed"          : int,
  "results"         : [{"path": str, "outputPath": str, "success": bool}, ...],
  "virtualDrivePath": str   # only for virtual_drive mode
}

Dataset
-------
Two minimal PDFs are created programmatically with pypdf in setUp().
The integration tests are skipped when pypdf is not installed.

Run
---
    python -m pytest APP/tests/test_pdf_merger.py -v
"""
import sys
import os
import json
import io
import shutil
import tempfile
import unittest

# ── Path setup ────────────────────────────────────────────────────────────────
_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR   = os.path.dirname(_TESTS_DIR)
_SRC_DIR   = os.path.join(_APP_DIR, "src")
sys.path.insert(0, _SRC_DIR)

from tools import pdf_merger  # noqa: E402

# ── Optional dependency flags ─────────────────────────────────────────────────
try:
    from pypdf import PdfWriter
    PYPDF_AVAILABLE = True
except ImportError:
    PYPDF_AVAILABLE = False


def _make_pdf(path: str, num_pages: int = 2) -> None:
    """Create a minimal valid PDF with `num_pages` blank pages using pypdf."""
    from pypdf import PdfWriter
    writer = PdfWriter()
    for _ in range(num_pages):
        writer.add_blank_page(width=595, height=842)  # A4
    with open(path, "wb") as f:
        writer.write(f)


class TestPdfMergerDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, pdf_merger.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'pdf_merger'."""
        self.assertEqual(pdf_merger.DEFINITION["name"], "pdf_merger")

    def test_definition_required_params(self):
        """Required parameters must include 'action' and 'files'."""
        required = pdf_merger.DEFINITION["parameters"]["required"]
        self.assertIn("action", required)
        self.assertIn("files", required)

    def test_definition_action_enum(self):
        """action must enumerate merge, split, convert."""
        enum = pdf_merger.DEFINITION["parameters"]["properties"]["action"]["enum"]
        for action in ("merge", "split", "convert"):
            self.assertIn(action, enum)

    def test_definition_output_mode_enum(self):
        """outputMode must enumerate replace, copy, virtual_drive."""
        enum = pdf_merger.DEFINITION["parameters"]["properties"]["outputMode"]["enum"]
        self.assertSetEqual(set(enum), {"replace", "copy", "virtual_drive"})


class TestPdfMergerInputValidation(unittest.TestCase):
    """Input validation tests — no pypdf dependency required."""

    def test_empty_files_returns_error(self):
        """Empty files list → success=False."""
        result = json.loads(pdf_merger.execute({
            "action": "merge", "files": [], "outputMode": "copy",
        }))
        self.assertFalse(result["success"])

    def test_missing_files_returns_error(self):
        """Missing 'files' key → success=False."""
        result = json.loads(pdf_merger.execute({"action": "merge", "outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_unknown_action_returns_error(self):
        """Unknown action value → success=False."""
        result = json.loads(pdf_merger.execute({
            "action": "unknown_action",
            "files": [{"path": "/some/file.pdf"}],
            "outputMode": "copy",
        }))
        self.assertFalse(result["success"])

    def test_virtual_drive_empty_path_returns_error(self):
        """virtual_drive mode with empty outputPath → success=False."""
        result = json.loads(pdf_merger.execute({
            "action": "merge",
            "files": [{"path": "/some/file.pdf"}],
            "outputMode": "virtual_drive",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])

    def test_response_has_standard_keys(self):
        """Error response always contains at minimum success and results."""
        result = json.loads(pdf_merger.execute({"action": "merge", "files": [], "outputMode": "copy"}))
        self.assertIn("success", result)
        self.assertIn("results", result)


@unittest.skipUnless(PYPDF_AVAILABLE, "pypdf not installed — skipping integration tests")
class TestPdfMergerIntegration(unittest.TestCase):
    """
    Real merge / split / page_info tests using minimal programmatic PDFs.
    Requires pypdf.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.pdf1 = os.path.join(self.tmp, "doc1.pdf")
        self.pdf2 = os.path.join(self.tmp, "doc2.pdf")
        _make_pdf(self.pdf1, num_pages=3)
        _make_pdf(self.pdf2, num_pages=2)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ── merge ──────────────────────────────────────────────────────────────

    def test_merge_two_pdfs_copy_mode(self):
        """Merging two PDFs produces a single output file."""
        result = json.loads(pdf_merger.execute({
            "action": "merge",
            "files": [{"path": self.pdf1}, {"path": self.pdf2}],
            "outputMode": "copy",
            "outputFilename": "merged_output",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".pdf"))

    def test_merge_output_contains_all_pages(self):
        """Merged PDF has page count equal to sum of source PDFs (3 + 2 = 5)."""
        from pypdf import PdfReader
        result = json.loads(pdf_merger.execute({
            "action": "merge",
            "files": [{"path": self.pdf1}, {"path": self.pdf2}],
            "outputMode": "copy",
            "outputFilename": "merged",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        reader = PdfReader(out)
        self.assertEqual(len(reader.pages), 5)

    def test_merge_virtual_drive_mode(self):
        """Merge in virtual_drive mode: PdfToolResults folder is created."""
        result = json.loads(pdf_merger.execute({
            "action": "merge",
            "files": [{"path": self.pdf1}, {"path": self.pdf2}],
            "outputMode": "virtual_drive",
            "outputPath": self.tmp,
            "outputFilename": "merged",
        }))
        self.assertTrue(result["success"])
        self.assertIn("virtualDrivePath", result)
        drive = result["virtualDrivePath"]
        self.assertTrue(os.path.isdir(drive))

    def test_merge_nonexistent_pdf_is_ignored(self):
        """Non-existent path in file list is silently skipped; valid ones still merge."""
        result = json.loads(pdf_merger.execute({
            "action": "merge",
            "files": [
                {"path": self.pdf1},
                {"path": "/nonexistent/missing.pdf"},
            ],
            "outputMode": "copy",
            "outputFilename": "partial_merge",
        }))
        self.assertTrue(result["success"])

    # ── split ──────────────────────────────────────────────────────────────

    def test_split_single_page_range(self):
        """Split pages 1-2 from a 3-page PDF: output file with those pages."""
        result = json.loads(pdf_merger.execute({
            "action": "split",
            "files": [{"path": self.pdf1}],
            "outputMode": "copy",
            "pageRanges": "1-2",
            "outputFilename": "split_out",
        }))
        self.assertTrue(result["success"])
        self.assertGreater(len(result["results"]), 0)
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".pdf"))

    def test_split_multiple_ranges(self):
        """Split pages 1 and 3 separately from a 3-page PDF → two output files."""
        result = json.loads(pdf_merger.execute({
            "action": "split",
            "files": [{"path": self.pdf1}],
            "outputMode": "copy",
            "pageRanges": "1,3",
        }))
        self.assertTrue(result["success"])
        self.assertEqual(len(result["results"]), 2)

    # ── page_info ──────────────────────────────────────────────────────────

    def test_page_info_returns_correct_count(self):
        """page_info action reports the correct page count for each PDF."""
        result = json.loads(pdf_merger.execute({
            "action": "page_info",
            "files": [{"path": self.pdf1}, {"path": self.pdf2}],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        pages_by_path = {r["path"]: r["pages"] for r in result["results"]}
        self.assertEqual(pages_by_path[self.pdf1], 3)
        self.assertEqual(pages_by_path[self.pdf2], 2)

    def test_page_info_nonexistent_file_reports_failure(self):
        """page_info on a non-existent file: that entry has success=False."""
        result = json.loads(pdf_merger.execute({
            "action": "page_info",
            "files": [{"path": "/nonexistent/doc.pdf"}],
            "outputMode": "copy",
        }))
        self.assertFalse(result["results"][0]["success"])


if __name__ == "__main__":
    unittest.main()
