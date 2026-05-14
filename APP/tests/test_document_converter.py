"""
Tests for the document converter tool — APP/src/tools/document_converter.py.

Tool purpose
------------
Convert documents between formats:
  PDF  → DOCX, TXT, HTML, PNG
  DOCX → PDF, TXT, HTML
  TXT  → PDF, DOCX
  HTML → PDF, DOCX
  MD   → PDF, HTML, DOCX

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
Plain-text files (TXT, HTML, MD) created programmatically in setUp() — no
external libraries needed for creation.  Conversion tests that require
optional libraries (reportlab, python-docx, markdown, weasyprint) are guarded
with @unittest.skipUnless.

Run
---
    python -m pytest APP/tests/test_document_converter.py -v
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

from tools import document_converter  # noqa: E402

# ── Optional dependency flags ─────────────────────────────────────────────────
try:
    from reportlab.pdfgen import canvas
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False

try:
    from docx import Document
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False

try:
    import markdown
    MARKDOWN_AVAILABLE = True
except ImportError:
    MARKDOWN_AVAILABLE = False


class TestDocumentConverterDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, document_converter.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'document_converter'."""
        self.assertEqual(document_converter.DEFINITION["name"], "document_converter")

    def test_definition_required_params(self):
        """Required parameters must include 'files' and 'outputMode'."""
        required = document_converter.DEFINITION["parameters"]["required"]
        self.assertIn("files", required)
        self.assertIn("outputMode", required)

    def test_definition_output_mode_enum(self):
        """outputMode must enumerate replace, copy, virtual_drive."""
        enum = document_converter.DEFINITION["parameters"]["properties"]["outputMode"]["enum"]
        self.assertSetEqual(set(enum), {"replace", "copy", "virtual_drive"})


class TestDocumentConverterInputValidation(unittest.TestCase):
    """Input validation tests — no external library dependency required."""

    def test_empty_files_returns_error(self):
        """Empty files list → success=False."""
        result = json.loads(document_converter.execute({"files": [], "outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_missing_files_key_returns_error(self):
        """Missing 'files' key → success=False."""
        result = json.loads(document_converter.execute({"outputMode": "copy"}))
        self.assertFalse(result["success"])

    def test_nonexistent_file_fails_per_file(self):
        """Non-existent source path → per-file failure."""
        result = json.loads(document_converter.execute({
            "files": [{"path": "/nonexistent/doc.txt", "outputFormat": "pdf"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_unsupported_input_format_fails_per_file(self):
        """Unsupported input extension → per-file failure."""
        result = json.loads(document_converter.execute({
            "files": [{"path": "/some/file.xyz", "outputFormat": "pdf"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_unsupported_conversion_pair_fails_per_file(self):
        """TXT → PNG is not supported: per-file failure with descriptive error."""
        result = json.loads(document_converter.execute({
            "files": [{"path": "/some/file.txt", "outputFormat": "png"}],
            "outputMode": "copy",
        }))
        self.assertEqual(result["failed"], 1)
        self.assertFalse(result["results"][0]["success"])

    def test_virtual_drive_empty_path_returns_error(self):
        """virtual_drive mode with empty outputPath → success=False."""
        result = json.loads(document_converter.execute({
            "files": [{"path": "/some/doc.txt", "outputFormat": "pdf"}],
            "outputMode": "virtual_drive",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])

    def test_response_has_standard_keys(self):
        """Error response always contains at minimum success and results."""
        result = json.loads(document_converter.execute({"files": [], "outputMode": "copy"}))
        self.assertIn("success", result)
        self.assertIn("results", result)


class TestDocumentConverterTxtConversions(unittest.TestCase):
    """TXT → other formats.  PDF requires reportlab; DOCX requires python-docx."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.txt_file = os.path.join(self.tmp, "sample.txt")
        with open(self.txt_file, "w", encoding="utf-8") as f:
            f.write("Line one\nLine two\nLine three\n")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @unittest.skipUnless(REPORTLAB_AVAILABLE, "reportlab not installed")
    def test_txt_to_pdf_copy_mode(self):
        """TXT → PDF in copy mode: output .pdf file is created."""
        result = json.loads(document_converter.execute({
            "files": [{"path": self.txt_file, "outputFormat": "pdf"}],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".pdf"))

    @unittest.skipUnless(DOCX_AVAILABLE, "python-docx not installed")
    def test_txt_to_docx_copy_mode(self):
        """TXT → DOCX in copy mode: output .docx file is created."""
        result = json.loads(document_converter.execute({
            "files": [{"path": self.txt_file, "outputFormat": "docx"}],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".docx"))


class TestDocumentConverterHtmlConversions(unittest.TestCase):
    """HTML → other formats."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.html_file = os.path.join(self.tmp, "sample.html")
        with open(self.html_file, "w", encoding="utf-8") as f:
            f.write(
                "<!DOCTYPE html><html><head><title>Test</title></head>"
                "<body><h1>Hello</h1><p>World</p></body></html>"
            )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @unittest.skipUnless(DOCX_AVAILABLE, "python-docx not installed")
    def test_html_to_docx_copy_mode(self):
        """HTML → DOCX in copy mode: output .docx file is created."""
        result = json.loads(document_converter.execute({
            "files": [{"path": self.html_file, "outputFormat": "docx"}],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".docx"))

    @unittest.skipUnless(REPORTLAB_AVAILABLE, "reportlab not installed")
    def test_html_to_pdf_copy_mode(self):
        """HTML → PDF (fallback via reportlab text strip): output .pdf created."""
        result = json.loads(document_converter.execute({
            "files": [{"path": self.html_file, "outputFormat": "pdf"}],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".pdf"))


class TestDocumentConverterMarkdownConversions(unittest.TestCase):
    """MD → HTML, PDF, DOCX."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.md_file = os.path.join(self.tmp, "README.md")
        with open(self.md_file, "w", encoding="utf-8") as f:
            f.write(
                "# Hello World\n\nThis is a **test** document.\n\n"
                "- Item 1\n- Item 2\n\n```python\nprint('hello')\n```\n"
            )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @unittest.skipUnless(MARKDOWN_AVAILABLE, "markdown package not installed")
    def test_md_to_html_copy_mode(self):
        """MD → HTML in copy mode: output .html file is created."""
        result = json.loads(document_converter.execute({
            "files": [{"path": self.md_file, "outputFormat": "html"}],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".html"))

    @unittest.skipUnless(MARKDOWN_AVAILABLE and DOCX_AVAILABLE,
                         "markdown or python-docx not installed")
    def test_md_to_docx_copy_mode(self):
        """MD → DOCX in copy mode: output .docx file is created."""
        result = json.loads(document_converter.execute({
            "files": [{"path": self.md_file, "outputFormat": "docx"}],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".docx"))

    @unittest.skipUnless(MARKDOWN_AVAILABLE and REPORTLAB_AVAILABLE,
                         "markdown or reportlab not installed")
    def test_md_to_pdf_copy_mode(self):
        """MD → PDF in copy mode: output .pdf file is created."""
        result = json.loads(document_converter.execute({
            "files": [{"path": self.md_file, "outputFormat": "pdf"}],
            "outputMode": "copy",
        }))
        self.assertTrue(result["success"])
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.lower().endswith(".pdf"))


class TestDocumentConverterVirtualDrive(unittest.TestCase):
    """virtual_drive mode creates DocConvertResults folder."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.txt_file = os.path.join(self.tmp, "note.txt")
        with open(self.txt_file, "w", encoding="utf-8") as f:
            f.write("Hello virtual drive test.\n")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    @unittest.skipUnless(DOCX_AVAILABLE, "python-docx not installed")
    def test_virtual_drive_mode_creates_folder(self):
        """virtual_drive mode: DocConvertResults folder is created."""
        result = json.loads(document_converter.execute({
            "files": [{"path": self.txt_file, "outputFormat": "docx"}],
            "outputMode": "virtual_drive",
            "outputPath": self.tmp,
        }))
        self.assertTrue(result["success"])
        self.assertIn("virtualDrivePath", result)
        drive = result["virtualDrivePath"]
        self.assertTrue(os.path.isdir(drive))
        out = result["results"][0]["outputPath"]
        self.assertTrue(os.path.isfile(out))
        self.assertTrue(out.startswith(drive))


if __name__ == "__main__":
    unittest.main()
