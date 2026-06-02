#!/usr/bin/env python3
import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from support import IsolatedProjectsMixin


class DivbandApiSupportTestCase(IsolatedProjectsMixin, unittest.TestCase):
    def setUp(self):
        self.temp_state = tempfile.TemporaryDirectory()
        state_dir = Path(self.temp_state.name)
        self.module = importlib.import_module("divband_api_support")
        self._original_state = {
            "STATE_DIR": self.module.STATE_DIR,
            "AUDIT_LOG": self.module.AUDIT_LOG,
            "JOBS_FILE": self.module.JOBS_FILE,
            "DEPLOY_STATE_FILE": self.module.DEPLOY_STATE_FILE,
            "JOBS": dict(self.module.JOBS),
            "METRICS": dict(self.module.METRICS),
        }
        self.module.STATE_DIR = state_dir
        self.module.AUDIT_LOG = state_dir / "audit.log"
        self.module.JOBS_FILE = state_dir / "jobs.json"
        self.module.DEPLOY_STATE_FILE = state_dir / "deploy-state.json"
        self.module.JOBS.clear()
        for key in self.module.METRICS:
            self.module.METRICS[key] = 0

    def tearDown(self):
        for key, value in self._original_state.items():
            if key == "JOBS":
                self.module.JOBS.clear()
                self.module.JOBS.update(value)
            elif key == "METRICS":
                self.module.METRICS.clear()
                self.module.METRICS.update(value)
            else:
                setattr(self.module, key, value)
        self.temp_state.cleanup()

    def test_authorize_open_when_no_tokens(self):
        with patch.dict(os.environ, {}, clear=True):
            auth = self.module.authorize(None)
        self.assertEqual(auth["scope"], "admin")

    @patch.dict(os.environ, {"DIVBAND_API_TOKEN": "master"}, clear=False)
    def test_authorize_master_token(self):
        self.assertIsNone(self.module.authorize(None))
        auth = self.module.authorize("Bearer master")
        self.assertEqual(auth["scope"], "admin")

    @patch.dict(
        os.environ,
        {"DIVBAND_API_SCOPED_TOKENS": json.dumps({"reader": "read", "editor": {"scope": "write", "projects": ["demo"]}})},
        clear=False,
    )
    def test_authorize_scoped_tokens(self):
        auth = self.module.authorize("Bearer reader")
        self.assertEqual(auth["scope"], "read")
        auth = self.module.authorize("Bearer editor")
        self.assertEqual(auth["projects"], ["demo"])
        self.assertIsNone(self.module.authorize("Bearer unknown"))

    def test_require_scope(self):
        admin = {"scope": "admin", "projects": None}
        reader = {"scope": "read", "projects": None}
        scoped = {"scope": "write", "projects": ["demo"]}
        self.assertTrue(self.module.require_scope(admin, write=True))
        self.assertFalse(self.module.require_scope(reader, write=True))
        self.assertTrue(self.module.require_scope(scoped, write=True, project="demo"))
        self.assertFalse(self.module.require_scope(scoped, write=True, project="other"))

    def test_rate_limiter_blocks_after_limit(self):
        limiter = self.module.RateLimiter(limit=2, window_seconds=60)
        self.assertTrue(limiter.allow("client"))
        self.assertTrue(limiter.allow("client"))
        self.assertFalse(limiter.allow("client"))

    def test_audit_and_deploy_state(self):
        self.module.audit("project.create", request_id="req-1", details={"name": "demo"})
        lines = self.module.AUDIT_LOG.read_text().strip().splitlines()
        self.assertEqual(len(lines), 1)
        entry = json.loads(lines[0])
        self.assertEqual(entry["action"], "project.create")

        self.module.record_deploy("up", returncode=0, project="demo", request_id="req-2")
        state = self.module.last_deploy_state()
        self.assertEqual(state["action"], "up")
        self.assertEqual(self.module.METRICS["deploy_total"], 1)

    def test_job_lifecycle(self):
        job = self.module.create_job("deploy", payload={"action": "up"})
        fetched = self.module.get_job(job["id"])
        self.assertEqual(fetched["status"], "queued")
        updated = self.module.update_job(job["id"], status="completed", result={"ok": True})
        self.assertEqual(updated["status"], "completed")
        self.assertTrue(self.module.JOBS_FILE.exists())

    def test_prometheus_metrics(self):
        self.module.METRICS["request_total"] = 3
        body = self.module.prometheus_metrics()
        self.assertIn("divband_request_total 3", body)
        self.assertIn("divband_projects_total", body)

    @patch("divband_api_support.subprocess.run")
    def test_git_dirty_paths(self, mock_run):
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = " M docs/foo.md\n?? new.txt\n"
        payload = self.module.git_dirty_paths()
        self.assertTrue(payload["available"])
        self.assertTrue(payload["dirty"])
        self.assertEqual(payload["paths"], ["docs/foo.md", "new.txt"])

    @patch("divband_api_support.urllib.request.urlopen")
    def test_deliver_webhook(self, mock_urlopen):
        response = mock_urlopen.return_value.__enter__.return_value
        response.status = 204
        result = self.module.deliver_webhook("https://example.com/hook", {"ok": True})
        self.assertTrue(result["delivered"])
        self.assertEqual(result["status"], 204)
        skipped = self.module.deliver_webhook("", {"ok": True})
        self.assertTrue(skipped["skipped"])


if __name__ == "__main__":
    unittest.main()
