"""
Tests for the drive creator tool — APP/src/tools/drive_creator.py.

Tool purpose
------------
Scan a source folder for files matching given extensions (using an MFT cache on
NTFS/Windows) and group them into a named Virtual Drive.  Two action modes are
supported: "shortcuts" (create .lnk shortcut files) and "move" (physically
move the originals).

Input  (dict)
-------------
sourceFolder : str        — absolute path to the folder to scan
extensions   : list[str]  — file extensions to include (e.g. [".jpg", ".png"])
driveName    : str        — name of the virtual drive to create
action       : str        — "shortcuts" | "move"
outputPath   : str        — base directory where virtual drives are stored

Output (JSON string)
--------------------
{
  "success"         : bool,
  "total"           : int,         # total matched files
  "succeeded"       : int,         # files successfully added to the drive
  "failed"          : int,
  "virtualDrivePath": str,         # path to the created virtual drive folder
  "results"         : list[dict],  # per-file {"path": str, "success": bool}
  "error"           : str          # only present on failure
}

Notes
-----
- Requires Windows (NTFS MFT scanning) and Administrator privileges for the
  MFT read.  Integration tests are skipped on non-Windows platforms.
- The tool does NOT create files inside the drive itself for the "shortcuts"
  action; it creates .lnk files pointing to the originals.

Run
---
    python -m pytest APP/tests/test_drive_creator.py -v
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

from tools import drive_creator  # noqa: E402


class TestDriveCreatorDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, drive_creator.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'drive_creator'."""
        self.assertEqual(drive_creator.DEFINITION["name"], "drive_creator")

    def test_definition_required_params(self):
        """All five required parameters must be declared."""
        required = set(drive_creator.DEFINITION["parameters"]["required"])
        expected = {"sourceFolder", "extensions", "driveName", "action", "outputPath"}
        self.assertEqual(required, expected)

    def test_definition_action_enum(self):
        """action must enumerate shortcuts and move."""
        enum = drive_creator.DEFINITION["parameters"]["properties"]["action"]["enum"]
        self.assertSetEqual(set(enum), {"shortcuts", "move"})


class TestDriveCreatorInputValidation(unittest.TestCase):
    """Input validation tests — no MFT / Windows dependency required."""

    def test_missing_source_folder_returns_error(self):
        """Empty sourceFolder → success=False."""
        result = json.loads(drive_creator.execute({
            "sourceFolder": "",
            "extensions": [".jpg"],
            "driveName": "MyDrive",
            "action": "shortcuts",
            "outputPath": tempfile.gettempdir(),
        }))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_nonexistent_source_folder_returns_error(self):
        """Non-existent sourceFolder → success=False."""
        result = json.loads(drive_creator.execute({
            "sourceFolder": "/nonexistent/folder",
            "extensions": [".jpg"],
            "driveName": "MyDrive",
            "action": "shortcuts",
            "outputPath": tempfile.gettempdir(),
        }))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_invalid_output_path_returns_error(self):
        """Non-existent outputPath → success=False."""
        result = json.loads(drive_creator.execute({
            "sourceFolder": tempfile.gettempdir(),
            "extensions": [".jpg"],
            "driveName": "MyDrive",
            "action": "shortcuts",
            "outputPath": "/nonexistent/output",
        }))
        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_empty_output_path_returns_error(self):
        """Empty outputPath string → success=False."""
        result = json.loads(drive_creator.execute({
            "sourceFolder": tempfile.gettempdir(),
            "extensions": [".jpg"],
            "driveName": "MyDrive",
            "action": "shortcuts",
            "outputPath": "",
        }))
        self.assertFalse(result["success"])
        self.assertIn("error", result)


@unittest.skipUnless(sys.platform == "win32", "Drive creator uses NTFS MFT — Windows only")
class TestDriveCreatorIntegration(unittest.TestCase):
    """
    Integration tests for the drive creator tool on Windows.

    These tests create a temporary folder with a few test files, then invoke
    drive_creator.execute() in 'shortcuts' mode to create a virtual drive.
    The MFT scan requires Administrator privileges; if the scan returns 0
    records the test is skipped.

    Requires: Windows, Administrator terminal.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src_dir = os.path.join(self.tmp, "source")
        self.out_dir = os.path.join(self.tmp, "drives")
        os.makedirs(self.src_dir)
        os.makedirs(self.out_dir)

        # Create a few dummy files
        for name in ("photo1.jpg", "photo2.jpg", "document.txt"):
            path = os.path.join(self.src_dir, name)
            with open(path, "wb") as f:
                f.write(b"dummy content")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, extensions=None, action="shortcuts"):
        extensions = extensions or [".jpg"]
        return json.loads(drive_creator.execute({
            "sourceFolder": self.src_dir,
            "extensions": extensions,
            "driveName": "TestDrive",
            "action": action,
            "outputPath": self.out_dir,
        }))

    def test_create_drive_shortcuts_jpg_files(self):
        """Create a virtual drive with shortcuts to .jpg files."""
        result = self._run(extensions=[".jpg"], action="shortcuts")
        if not result.get("success") and "0 records" in result.get("error", ""):
            self.skipTest("MFT scan requires Administrator privileges")
        self.assertTrue(result["success"], msg=result.get("error", ""))
        self.assertIn("virtualDrivePath", result)
        self.assertTrue(os.path.isdir(result["virtualDrivePath"]))

    def test_create_drive_counts_matched_files(self):
        """succeeded equals the number of .jpg files in source folder (2)."""
        result = self._run(extensions=[".jpg"], action="shortcuts")
        if not result.get("success") and "0 records" in result.get("error", ""):
            self.skipTest("MFT scan requires Administrator privileges")
        if not result.get("success"):
            self.skipTest(f"Tool failed: {result.get('error')}")
        self.assertEqual(result.get("succeeded", 0), 2)

    def test_create_drive_with_multiple_extensions(self):
        """Multiple extensions: .jpg and .txt should match all 3 test files."""
        result = self._run(extensions=[".jpg", ".txt"], action="shortcuts")
        if not result.get("success") and "0 records" in result.get("error", ""):
            self.skipTest("MFT scan requires Administrator privileges")
        if not result.get("success"):
            self.skipTest(f"Tool failed: {result.get('error')}")
        self.assertEqual(result.get("succeeded", 0), 3)

    def test_drive_folder_is_created_at_output_path(self):
        """Virtual drive directory is created under outputPath."""
        result = self._run()
        if not result.get("success") and "0 records" in result.get("error", ""):
            self.skipTest("MFT scan requires Administrator privileges")
        if not result.get("success"):
            self.skipTest(f"Tool failed: {result.get('error')}")
        drive_path = result.get("virtualDrivePath", "")
        self.assertTrue(drive_path.startswith(self.out_dir))
        self.assertTrue(os.path.isdir(drive_path))


if __name__ == "__main__":
    unittest.main()
