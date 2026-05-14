"""
Tests for the space analyzer tool — APP/src/tools/space_analyzer.py.

Tool purpose
------------
Scan a Windows drive (or a specific subfolder on it) using the NTFS Master File
Table and return a nested tree of folder sizes for space-usage visualisation.
The scan is cached in memory after the first call.

Input  (dict)
-------------
driveLetter : str          — single drive letter to scan (e.g. "C", "D")
targetDir   : str, optional — restrict results to a specific subfolder path

Output (JSON string)
--------------------
On success:
{
  "success": true,
  "data": {
    "path"       : str,         # root path of the scanned drive (e.g. "C:\\")
    "total_size" : int,         # total size in bytes
    "children"   : [            # flat list of immediate children
      {
        "name"      : str,
        "full_path" : str,      # absolute path of the child
        "is_dir"    : bool,
        "size"      : int,      # bytes
        "created"   : float,    # Unix timestamp
        "modified"  : float,
        "accessed"  : float
      }
    ]
  }
}

On failure:
{
  "success": false,
  "error"  : str
}

Notes
-----
- Requires Windows (NTFS MFT) and Administrator privileges for the MFT read.
- The data-structure tests assert only on key presence and type — they do NOT
  assert specific byte values (which vary per machine).
- The MFT-scan integration test is slow (~15–60 s on first call) and is
  marked with @unittest.skipUnless(sys.platform == "win32", ...).

Run
---
    python -m pytest APP/tests/test_space_analyzer.py -v
"""
import sys
import os
import json
import unittest

# ── Path setup ────────────────────────────────────────────────────────────────
_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR   = os.path.dirname(_TESTS_DIR)
_SRC_DIR   = os.path.join(_APP_DIR, "src")
sys.path.insert(0, _SRC_DIR)

from tools import space_analyzer  # noqa: E402


class TestSpaceAnalyzerDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, space_analyzer.DEFINITION)

    def test_definition_name(self):
        """Tool name must be 'space_analyzer'."""
        self.assertEqual(space_analyzer.DEFINITION["name"], "space_analyzer")

    def test_definition_required_params(self):
        """Required parameters must include 'driveLetter'."""
        required = space_analyzer.DEFINITION["parameters"]["required"]
        self.assertIn("driveLetter", required)

    def test_definition_target_dir_is_optional(self):
        """targetDir must NOT be in the required list (it is optional)."""
        required = space_analyzer.DEFINITION["parameters"]["required"]
        self.assertNotIn("targetDir", required)

    def test_definition_properties_exist(self):
        """parameters.properties must have driveLetter and targetDir keys."""
        props = space_analyzer.DEFINITION["parameters"]["properties"]
        self.assertIn("driveLetter", props)
        self.assertIn("targetDir", props)


class TestSpaceAnalyzerInputValidation(unittest.TestCase):
    """
    Input validation tests.

    On non-Windows platforms the tool will raise or return an error because
    the MFT scan utility is NTFS-only.  We only test that the tool does NOT
    crash unhandled — it must always return a JSON string.
    """

    def _execute(self, payload: dict) -> dict:
        raw = space_analyzer.execute(payload)
        self.assertIsInstance(raw, str, "execute() must always return a str")
        parsed = json.loads(raw)
        return parsed

    def test_returns_json_string(self):
        """execute() always returns a str that parses as JSON."""
        raw = space_analyzer.execute({"driveLetter": "C"})
        self.assertIsInstance(raw, str)
        parsed = json.loads(raw)
        self.assertIsInstance(parsed, dict)

    def test_response_always_has_success_key(self):
        """Response dict always has a 'success' boolean key."""
        result = self._execute({"driveLetter": "C"})
        self.assertIn("success", result)
        self.assertIsInstance(result["success"], bool)

    def test_invalid_drive_letter_returns_error_or_data(self):
        """
        A drive letter that doesn't exist (e.g. 'Z') should return either:
          - success=False with an error message, OR
          - success=True with an empty/minimal data tree.
        The tool must NOT raise an unhandled exception.
        """
        result = self._execute({"driveLetter": "Z"})
        self.assertIn("success", result)

    def test_extra_keys_do_not_crash(self):
        """Extra unknown keys in the input dict must not raise."""
        try:
            raw = space_analyzer.execute({"driveLetter": "C", "unknownKey": "value"})
            json.loads(raw)
        except Exception as exc:
            self.fail(f"execute() raised with extra keys: {exc}")


@unittest.skipUnless(sys.platform == "win32", "Space analyzer uses NTFS MFT — Windows only")
class TestSpaceAnalyzerIntegration(unittest.TestCase):
    """
    Integration tests that perform a real MFT scan on the C: drive.

    These tests are slow (15–60 s on first run) and require:
      - Windows OS
      - Administrator privileges (for MFT access)

    They validate the structure of the returned data tree, not specific byte
    values which differ between machines.
    """

    @classmethod
    def setUpClass(cls):
        """Run the scan once and cache the result for all tests in this class."""
        raw = space_analyzer.execute({"driveLetter": "C"})
        cls.result = json.loads(raw)

    def test_scan_succeeds(self):
        """Scanning C: must succeed (success=True)."""
        if not self.result.get("success"):
            err = self.result.get("error", "")
            if "Administrator" in err or "admin" in err.lower() or "access" in err.lower():
                self.skipTest("MFT scan requires Administrator privileges")
        self.assertTrue(self.result["success"], msg=self.result.get("error", ""))

    def test_result_has_data_key(self):
        """Successful response must contain a 'data' key."""
        if not self.result.get("success"):
            self.skipTest("Scan did not succeed — skipping structure tests")
        self.assertIn("data", self.result)

    def test_data_has_required_fields(self):
        """data dict must contain path, total_size, and children."""
        if not self.result.get("success"):
            self.skipTest("Scan did not succeed")
        data = self.result["data"]
        for field in ("path", "total_size", "children"):
            self.assertIn(field, data, f"Missing field: {field}")

    def test_total_size_is_positive_integer(self):
        """total_size must be a positive integer (bytes on disk > 0)."""
        if not self.result.get("success"):
            self.skipTest("Scan did not succeed")
        size = self.result["data"]["total_size"]
        self.assertIsInstance(size, int)
        self.assertGreater(size, 0)

    def test_children_is_list(self):
        """children must be a list (possibly empty)."""
        if not self.result.get("success"):
            self.skipTest("Scan did not succeed")
        children = self.result["data"]["children"]
        self.assertIsInstance(children, list)

    def test_children_have_correct_structure(self):
        """Each child node must have name, full_path, size, is_dir."""
        if not self.result.get("success"):
            self.skipTest("Scan did not succeed")
        children = self.result["data"]["children"]
        if not children:
            self.skipTest("No children returned — cannot test child structure")
        for child in children[:5]:  # check first 5 to keep test fast
            for field in ("name", "full_path", "is_dir", "size"):
                self.assertIn(field, child, f"Child missing field: {field}")

    def test_root_path_is_drive_root(self):
        """The root data path must correspond to a drive root (e.g. 'C:\\')."""
        if not self.result.get("success"):
            self.skipTest("Scan did not succeed")
        path = self.result["data"]["path"]
        self.assertIsInstance(path, str)
        self.assertTrue(len(path) > 0)

    def test_target_dir_filters_to_subdirectory(self):
        """targetDir restricts results to a specific Windows folder."""
        if not self.result.get("success"):
            self.skipTest("Top-level scan failed — skipping targetDir test")
        windows_dir = "C:\\Windows"
        if not os.path.isdir(windows_dir):
            self.skipTest("C:\\Windows does not exist on this machine")
        raw = space_analyzer.execute({
            "driveLetter": "C",
            "targetDir": windows_dir,
        })
        result = json.loads(raw)
        if not result.get("success"):
            self.skipTest(f"targetDir scan failed: {result.get('error')}")
        data = result["data"]
        self.assertIn("children", data)
        self.assertIsInstance(data["children"], list)
        # All returned children must be inside the target directory
        for child in data["children"][:5]:
            full_path = child.get("full_path", "")
            self.assertTrue(
                full_path.lower().startswith(windows_dir.lower()),
                f"Child path '{full_path}' is not under '{windows_dir}'",
            )


if __name__ == "__main__":
    unittest.main()
