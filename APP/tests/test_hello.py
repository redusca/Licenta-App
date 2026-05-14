"""
Tests for the hello tool — APP/src/tools/hello.py.

Tool purpose
------------
Connectivity / smoke-test tool that confirms the APP ↔ agent pipeline works.

Input  (dict)
-------------
name : str, optional
    If provided, the greeting uses this name; otherwise defaults to "world".

Output (str)
------------
A plain greeting string (not JSON) that:
  - contains the name (or "world" if none given)
  - mentions the pipeline being "working correctly"

Run
---
    python -m pytest APP/tests/test_hello.py -v
"""
import sys
import os
import unittest

# ── Path setup ────────────────────────────────────────────────────────────────
_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR   = os.path.dirname(_TESTS_DIR)
_SRC_DIR   = os.path.join(_APP_DIR, "src")
sys.path.insert(0, _SRC_DIR)

from tools import hello  # noqa: E402


class TestHelloDefinition(unittest.TestCase):
    """Validate the DEFINITION schema exposed to the agent."""

    def test_definition_has_required_keys(self):
        """DEFINITION must contain name, description, and parameters."""
        for key in ("name", "description", "parameters"):
            self.assertIn(key, hello.DEFINITION, f"Missing key: {key}")

    def test_definition_name(self):
        """Tool name must be 'hello'."""
        self.assertEqual(hello.DEFINITION["name"], "hello")

    def test_definition_parameters_type(self):
        """parameters.type must be 'object'."""
        self.assertEqual(hello.DEFINITION["parameters"]["type"], "object")

    def test_definition_no_required_params(self):
        """Hello tool has no required parameters (name is optional)."""
        required = hello.DEFINITION["parameters"].get("required", [])
        self.assertEqual(required, [])


class TestHelloExecute(unittest.TestCase):
    """Validate execute() behaviour across all input combinations."""

    def test_returns_string(self):
        """execute() always returns a str regardless of input."""
        self.assertIsInstance(hello.execute({}), str)
        self.assertIsInstance(hello.execute({"name": "Alice"}), str)
        self.assertIsInstance(hello.execute({"name": None}), str)

    def test_default_greeting_contains_world(self):
        """No name → greeting includes 'world'."""
        result = hello.execute({})
        self.assertIn("world", result.lower())

    def test_default_greeting_confirms_pipeline(self):
        """No name → greeting confirms the pipeline is working."""
        result = hello.execute({})
        self.assertIn("pipeline", result.lower())

    def test_named_greeting_uses_provided_name(self):
        """Provided name appears verbatim in the greeting."""
        result = hello.execute({"name": "Alice"})
        self.assertIn("Alice", result)

    def test_named_greeting_confirms_pipeline(self):
        """Named greeting still confirms the pipeline is working."""
        result = hello.execute({"name": "Bob"})
        self.assertIn("pipeline", result.lower())

    def test_none_name_falls_back_to_world(self):
        """name=None must fall back to 'world'."""
        result = hello.execute({"name": None})
        self.assertIn("world", result.lower())

    def test_empty_string_name_falls_back_to_world(self):
        """name='' must fall back to 'world'."""
        result = hello.execute({"name": ""})
        self.assertIn("world", result.lower())

    def test_whitespace_name_is_used_as_name(self):
        """name that is truthy (e.g. 'Test User') appears in output."""
        result = hello.execute({"name": "Test User"})
        self.assertIn("Test User", result)

    def test_extra_keys_are_ignored(self):
        """Unknown extra keys in the input dict must not raise."""
        try:
            result = hello.execute({"name": "World", "extra": "ignored"})
            self.assertIsInstance(result, str)
        except Exception as exc:
            self.fail(f"execute() raised with extra keys: {exc}")


if __name__ == "__main__":
    unittest.main()
