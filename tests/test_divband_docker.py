#!/usr/bin/env python3
import importlib
import json
import unittest
from unittest.mock import patch

from support import SCRIPTS, IsolatedProjectsMixin


class DivbandDockerTestCase(unittest.TestCase):
    def setUp(self):
        self.module = importlib.import_module("divband_docker")

    @patch("divband_docker.subprocess.run")
    def test_run_command_success(self, mock_run):
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "ok"
        mock_run.return_value.stderr = ""
        result = self.module.run_command(["echo", "ok"])
        self.assertEqual(result["returncode"], 0)
        self.assertEqual(result["stdout"], "ok")

    @patch("divband_docker.subprocess.run")
    def test_run_command_failure_raises(self, mock_run):
        mock_run.return_value.returncode = 1
        mock_run.return_value.stdout = ""
        mock_run.return_value.stderr = "fail"
        with self.assertRaises(self.module.DockerError) as ctx:
            self.module.run_command(["false"])
        self.assertIn("command failed", ctx.exception.message)

    @patch("divband_docker.subprocess.run")
    def test_docker_available(self, mock_run):
        mock_run.return_value.returncode = 0
        self.assertTrue(self.module.docker_available())
        mock_run.return_value.returncode = 1
        self.assertFalse(self.module.docker_available())

    @patch("divband_docker.run_command")
    @patch("divband_docker.require_docker")
    def test_deploy_routes_actions(self, _require, mock_run):
        mock_run.return_value = {"returncode": 0}
        self.module.deploy("up", project="demo")
        mock_run.assert_called_once()
        self.assertEqual(mock_run.call_args[0][0][:4], ["docker", "compose", "up", "-d"])

        mock_run.reset_mock()
        self.module.deploy("down", project="demo")
        self.assertEqual(mock_run.call_args[0][0], ["docker", "compose", "stop", "demo-web"])

        mock_run.reset_mock()
        self.module.deploy("pull")
        self.assertEqual(mock_run.call_args[0][0], ["docker", "compose", "pull"])

        with self.assertRaises(self.module.DockerError):
            self.module.deploy("invalid")

    @patch("divband_docker.compose_ps")
    def test_project_status_running(self, mock_ps):
        mock_ps.return_value = [
            {"Service": "demo-web", "State": "running", "Health": "healthy", "Image": "divband-demo:local"}
        ]
        status = self.module.project_status("demo")
        self.assertTrue(status["running"])
        self.assertEqual(status["state"], "running")
        self.assertEqual(status["health"], "healthy")

    @patch("divband_docker.compose_ps")
    def test_project_status_missing(self, mock_ps):
        mock_ps.return_value = [{"Service": "other-web", "State": "running"}]
        status = self.module.project_status("demo")
        self.assertFalse(status["running"])
        self.assertEqual(status["state"], "missing")

    @patch("divband_docker.compose_ps")
    def test_stack_status_on_error(self, mock_ps):
        mock_ps.side_effect = self.module.DockerError("compose failed")
        with patch("divband_docker.docker_available", return_value=False):
            payload = self.module.stack_status()
        self.assertFalse(payload["docker_available"])
        self.assertEqual(payload["services"], [])
        self.assertIn("error", payload)

    @patch("divband_docker.compose_up")
    @patch("divband_docker.remove_project_image")
    @patch("divband_docker.remove_project_container")
    def test_finalize_delete_static_skips_image(self, mock_remove_container, mock_remove_image, mock_up):
        mock_remove_container.return_value = [{"ok": True}]
        mock_up.return_value = {"returncode": 0}
        steps = self.module.finalize_delete("demo", kind="static", reload_stack=True, prune_image=True)
        mock_remove_image.assert_not_called()
        self.assertTrue(any(step.get("step") == "reload_stack" for step in steps))


class FinalizeDeleteBuildableTestCase(IsolatedProjectsMixin, unittest.TestCase):
    def setUp(self):
        self.setUpProjectsModule()

    def tearDown(self):
        self.tearDownProjectsModule()

    @patch("divband_docker.compose_up")
    @patch("divband_docker.remove_project_image")
    @patch("divband_docker.remove_project_container")
    def test_finalize_delete_node_prunes_image(self, mock_remove_container, mock_remove_image, mock_up):
        mock_remove_container.return_value = [{"ok": True}]
        mock_remove_image.return_value = {"ok": True}
        mock_up.return_value = {"returncode": 0}
        steps = importlib.import_module("divband_docker").finalize_delete(
            "nodeapp",
            kind="node",
            reload_stack=False,
            prune_image=True,
        )
        mock_remove_image.assert_called_once()
        self.assertFalse(any(step.get("step") == "reload_stack" for step in steps))


if __name__ == "__main__":
    unittest.main()
