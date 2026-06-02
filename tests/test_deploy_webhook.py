#!/usr/bin/env python3
import importlib.util
import os
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


class DeployWebhookTestCase(unittest.TestCase):
    def setUp(self):
        os.environ["DIVBAND_DEPLOY_WEBHOOK_SECRET"] = "test-secret"
        spec = importlib.util.spec_from_file_location(
            "deploy_webhook",
            SCRIPTS / "deploy_webhook.py",
        )
        self.module = importlib.util.module_from_spec(spec)
        sys.modules["deploy_webhook"] = self.module
        spec.loader.exec_module(self.module)

    def test_authorized_requires_exact_bearer(self):
        self.assertTrue(self.module.authorized("Bearer test-secret"))
        self.assertFalse(self.module.authorized("Bearer wrong"))
        self.assertFalse(self.module.authorized(""))

    def test_run_deploy_rejects_invalid_sha(self):
        code, message = self.module.run_deploy("not-a-sha")
        self.assertEqual(code, 1)
        self.assertIn("invalid sha", message)


if __name__ == "__main__":
    unittest.main()
