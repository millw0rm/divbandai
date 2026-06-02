#!/usr/bin/env python3
import importlib.util
import io
import json
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from support import IsolatedProjectsMixin

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def load_script_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CreateProjectCliTestCase(IsolatedProjectsMixin, unittest.TestCase):
    def setUp(self):
        self.setUpProjectsModule()
        self.cli = load_script_module("create_project_cli", "create-project.py")

    def tearDown(self):
        self.tearDownProjectsModule()

    def test_create_project_success(self):
        with patch.object(sys, "argv", ["create-project.py", "demo", "--kind", "static"]):
            code = self.cli.main()
        self.assertEqual(code, 0)
        self.assertTrue(self.projects_dir.joinpath("demo/html/index.html").exists())

    def test_create_project_validation_error(self):
        stderr = io.StringIO()
        with patch.object(sys, "argv", ["create-project.py", "INVALID"]):
            with redirect_stderr(stderr):
                code = self.cli.main()
        self.assertEqual(code, 2)
        self.assertIn("error:", stderr.getvalue())


class DeleteProjectCliTestCase(IsolatedProjectsMixin, unittest.TestCase):
    def setUp(self):
        self.setUpProjectsModule()
        self.cli = load_script_module("delete_project_cli", "delete-project.py")

    def tearDown(self):
        self.tearDownProjectsModule()

    @patch("divband_docker.finalize_delete", return_value=[])
    def test_delete_project_success(self, _finalize):
        self.projects_module.create_or_refresh_project("demo", kind="static", arvan=False)
        stdout = io.StringIO()
        with patch.object(sys, "argv", ["delete-project.py", "demo", "--no-docker"]):
            with redirect_stdout(stdout):
                code = self.cli.main()
        self.assertEqual(code, 0)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["action"], "deleted")

    def test_delete_protected_project(self):
        self.projects_module.create_or_refresh_project("test", kind="static", arvan=False)
        stderr = io.StringIO()
        with patch.object(sys, "argv", ["delete-project.py", "test", "--no-docker"]):
            with redirect_stderr(stderr):
                code = self.cli.main()
        self.assertEqual(code, 3)
        self.assertIn("protected", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
