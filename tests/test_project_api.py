#!/usr/bin/env python3
import importlib
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener, urlopen

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))


def load_project_api():
    spec = importlib.util.spec_from_file_location("project_api", SCRIPTS / "project-api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DivbandProjectsTestCase(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.projects_vars = self.root / "infra/ansible/vars/projects.yml"
        self.projects_dir = self.root / "projects"
        self.haproxy_cfg = self.root / "config/haproxy/haproxy.cfg"
        self.compose_file = self.root / "docker-compose.yml"
        self.projects_vars.parent.mkdir(parents=True, exist_ok=True)
        self.projects_vars.write_text("---\ndivband_projects: []\n")

        self.module = importlib.import_module("divband_projects")
        self._original_paths = {
            "ROOT": self.module.ROOT,
            "PROJECTS_VARS": self.module.PROJECTS_VARS,
            "PROJECTS_DIR": self.module.PROJECTS_DIR,
            "HAPROXY_CFG": self.module.HAPROXY_CFG,
            "COMPOSE_FILE": self.module.COMPOSE_FILE,
        }
        self.module.ROOT = self.root
        self.module.PROJECTS_VARS = self.projects_vars
        self.module.PROJECTS_DIR = self.projects_dir
        self.module.HAPROXY_CFG = self.haproxy_cfg
        self.module.COMPOSE_FILE = self.compose_file

    def tearDown(self):
        for key, value in self._original_paths.items():
            setattr(self.module, key, value)
        self.tempdir.cleanup()

    def test_create_and_delete_project(self):
        result = self.module.create_or_refresh_project("demo", kind="static", arvan=False)
        self.assertEqual(result["action"], "created")
        self.assertTrue(self.projects_dir.joinpath("demo/html/index.html").exists())
        self.assertIn("demo.divbandai.ir", result["project"]["domains"])
        self.assertIn("host_demo", self.haproxy_cfg.read_text())

        delete_result = self.module.delete_project("demo", arvan=False)
        self.assertEqual(delete_result["action"], "deleted")
        self.assertFalse(self.projects_dir.joinpath("demo").exists())
        self.assertEqual(self.module.load_projects(), [])

    def test_domain_conflict(self):
        self.module.create_or_refresh_project("one", kind="static", arvan=False)
        with self.assertRaises(self.module.ConflictError):
            self.module.create_or_refresh_project(
                "two",
                kind="static",
                extra_domains=["one.divbandai.ir"],
                arvan=False,
            )

    def test_patch_domains_only(self):
        self.module.create_or_refresh_project("demo", kind="static", arvan=False)
        html_path = self.projects_dir / "demo/html/index.html"
        original = html_path.read_text()
        result = self.module.patch_project(
            "demo",
            domains=["extra.example.com"],
            arvan=False,
            refresh_content=False,
        )
        self.assertIn("extra.example.com", result["project"]["domains"])
        self.assertEqual(html_path.read_text(), original)
        nginx_conf = (self.projects_dir / "demo/nginx.conf").read_text()
        self.assertIn("extra.example.com", nginx_conf)

    def test_protected_delete(self):
        self.module.create_or_refresh_project("test", kind="static", arvan=False)
        with self.assertRaises(self.module.ProtectedProjectError):
            self.module.delete_project("test", arvan=False)

    def test_invalid_domain(self):
        with self.assertRaises(self.module.ValidationError):
            self.module.validate_domain("not a domain")

    def test_upload_static_files(self):
        self.module.create_or_refresh_project("demo", kind="static", arvan=False)
        result = self.module.upload_project_files(
            "demo",
            {"html/custom.html": "<h1>custom</h1>"},
        )
        self.assertIn("html/custom.html", result["written"])
        content = (self.projects_dir / "demo/html/custom.html").read_text()
        self.assertIn("custom", content)

    def test_empty_project_stack(self):
        self.module.regenerate_stack([], arvan=False)
        compose = self.compose_file.read_text()
        self.assertNotIn("depends_on:", compose.split("networks:")[0])

    def test_node_kind_scaffold(self):
        result = self.module.create_or_refresh_project("nodeapp", kind="node", arvan=False)
        self.assertTrue((self.projects_dir / "nodeapp/server.js").exists())
        self.assertEqual(result["project"]["port"], 3000)

    def test_custom_health_check(self):
        self.module.create_or_refresh_project(
            "demo",
            kind="static",
            arvan=False,
            metadata={"health_check": "/ready"},
        )
        self.assertIn("GET /ready", self.haproxy_cfg.read_text())

    def test_detect_drift_structure(self):
        self.module.create_or_refresh_project("demo", kind="static", arvan=False)
        drift = self.module.detect_drift()
        self.assertIn("has_drift", drift)
        self.assertIn("expected_services", drift)


class ProjectApiTestCase(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.projects_vars = self.root / "infra/ansible/vars/projects.yml"
        self.projects_dir = self.root / "projects"
        self.haproxy_cfg = self.root / "config/haproxy/haproxy.cfg"
        self.compose_file = self.root / "docker-compose.yml"
        self.projects_vars.parent.mkdir(parents=True, exist_ok=True)
        self.projects_vars.write_text("---\ndivband_projects: []\n")

        self.projects_module = importlib.import_module("divband_projects")
        self._original_paths = {
            "ROOT": self.projects_module.ROOT,
            "PROJECTS_VARS": self.projects_module.PROJECTS_VARS,
            "PROJECTS_DIR": self.projects_module.PROJECTS_DIR,
            "HAPROXY_CFG": self.projects_module.HAPROXY_CFG,
            "COMPOSE_FILE": self.projects_module.COMPOSE_FILE,
        }
        for key, value in {
            "ROOT": self.root,
            "PROJECTS_VARS": self.projects_vars,
            "PROJECTS_DIR": self.projects_dir,
            "HAPROXY_CFG": self.haproxy_cfg,
            "COMPOSE_FILE": self.compose_file,
        }.items():
            setattr(self.projects_module, key, value)

        self.api = load_project_api()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), self.api.ProjectApiHandler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for key, value in self._original_paths.items():
            setattr(self.projects_module, key, value)
        self.tempdir.cleanup()

    def request(self, method, path, payload=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        opener = build_opener(ProxyHandler({}))
        try:
            with opener.open(request, timeout=2) as response:
                body = json.loads(response.read().decode("utf-8"))
                return response.status, body
        except HTTPError as exc:
            body = json.loads(exc.read().decode("utf-8"))
            return exc.code, body

    def test_create_get_delete_flow(self):
        with patch.object(
            self.api,
            "deploy",
            return_value={"command": ["docker", "compose", "up"], "returncode": 0},
        ):
            status, body = self.request(
                "POST",
                "/v1/projects",
                {"name": "demo", "kind": "static"},
            )
        self.assertEqual(status, 201)
        self.assertEqual(body["project"]["name"], "demo")

        status, body = self.request("GET", "/v1/projects/demo")
        self.assertEqual(status, 200)
        self.assertIn("runtime", body)

        with patch.object(
            self.api,
            "finalize_delete",
            return_value=[{"step": "reload_stack", "ok": True}],
        ):
            status, body = self.request("DELETE", "/v1/projects/demo")
        self.assertEqual(status, 200)
        self.assertEqual(body["action"], "deleted")

        status, body = self.request("GET", "/v1/projects/demo")
        self.assertEqual(status, 404)
        self.assertEqual(body["code"], "not_found")

    @patch.dict("os.environ", {"DIVBAND_API_TOKEN": "secret"}, clear=False)
    def test_auth_required_when_token_set(self):
        status, body = self.request("GET", "/v1/projects")
        self.assertEqual(status, 401)
        status, body = self.request("GET", "/v1/projects", token="secret")
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
