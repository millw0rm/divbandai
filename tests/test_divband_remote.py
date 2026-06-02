#!/usr/bin/env python3
import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class DivbandRemoteTestCase(unittest.TestCase):
    def setUp(self):
        self.module = importlib.import_module("divband_remote")
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.env_file = self.root / "environments.json"
        self.inventory = self.root / "inventory.yml"
        self.playbook = self.root / "playbook.yml"
        self.inventory.write_text("all:\n  hosts:\n    localhost:\n")
        self.playbook.write_text("---\n- hosts: all\n  tasks: []\n")
        self._original_root = self.module.ROOT
        self._original_env_file = self.module.ENVIRONMENTS_FILE
        self.module.ROOT = self.root
        self.module.ENVIRONMENTS_FILE = self.env_file

    def tearDown(self):
        self.module.ROOT = self._original_root
        self.module.ENVIRONMENTS_FILE = self._original_env_file
        self.tempdir.cleanup()

    def test_load_environments_defaults(self):
        self.module.ROOT = self._original_root
        self.module.ENVIRONMENTS_FILE = self.root / "missing-environments.json"
        environments = self.module.load_environments()
        self.assertIn("production", environments)
        self.assertIn("staging", environments)
        self.assertTrue(environments["production"]["arvan"])

    def test_load_environments_from_file(self):
        self.env_file.write_text(
            json.dumps(
                {
                    "dev": {
                        "inventory": "inventory.yml",
                        "playbook": "playbook.yml",
                        "arvan": False,
                    }
                }
            )
        )
        environments = self.module.load_environments()
        self.assertEqual(list(environments.keys()), ["dev"])

    def test_resolve_unknown_environment(self):
        self.module.ROOT = self._original_root
        self.module.ENVIRONMENTS_FILE = self.root / "missing-environments.json"
        with self.assertRaises(self.module.RemoteError) as ctx:
            self.module.resolve_environment("missing")
        self.assertIn("missing", ctx.exception.message)

    def test_resolve_environment_paths(self):
        self.env_file.write_text(
            json.dumps(
                {
                    "dev": {
                        "inventory": "inventory.yml",
                        "playbook": "playbook.yml",
                        "arvan": False,
                    }
                }
            )
        )
        config = self.module.resolve_environment("dev")
        self.assertEqual(config["inventory"], str(self.inventory))
        self.assertEqual(config["playbook"], str(self.playbook))

    @patch("divband_remote.subprocess.run")
    def test_run_ansible_success(self, mock_run):
        self.env_file.write_text(
            json.dumps(
                {
                    "dev": {
                        "inventory": "inventory.yml",
                        "playbook": "playbook.yml",
                        "arvan": False,
                    }
                }
            )
        )
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "PLAY RECAP"
        mock_run.return_value.stderr = ""
        with patch.dict("os.environ", {"DIVBAND_ANSIBLE_PLAYBOOK": "/usr/bin/ansible-playbook"}):
            result = self.module.run_ansible("dev", extra_vars={"feature_flag": True})
        self.assertEqual(result["returncode"], 0)
        self.assertIn("-e", result["command"])
        self.assertIn("feature_flag=true", result["command"])

    @patch("divband_remote.subprocess.run")
    def test_run_ansible_failure(self, mock_run):
        self.env_file.write_text(
            json.dumps(
                {
                    "dev": {
                        "inventory": "inventory.yml",
                        "playbook": "playbook.yml",
                    }
                }
            )
        )
        mock_run.return_value.returncode = 2
        mock_run.return_value.stdout = ""
        mock_run.return_value.stderr = "failed"
        with patch.dict("os.environ", {"DIVBAND_ANSIBLE_PLAYBOOK": "/usr/bin/ansible-playbook"}):
            with self.assertRaises(self.module.RemoteError):
                self.module.run_ansible("dev")


if __name__ == "__main__":
    unittest.main()
