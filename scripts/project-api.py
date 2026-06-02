#!/usr/bin/env python3
import json
import os
import pathlib
import subprocess
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import yaml


ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECTS_VARS = ROOT / "infra" / "ansible" / "vars" / "projects.yml"
CREATE_PROJECT = ROOT / "scripts" / "create-project.py"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8080
WRITE_LOCK = threading.Lock()


def load_projects():
    data = yaml.safe_load(PROJECTS_VARS.read_text()) or {}
    return data.get("divband_projects", [])


def find_project(name):
    return next((project for project in load_projects() if project.get("name") == name), None)


def run_command(command):
    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return {
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


class ProjectApiHandler(BaseHTTPRequestHandler):
    server_version = "DivbandProjectAPI/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, status, payload):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON: {exc}") from exc

    def require_auth(self):
        token = os.environ.get("DIVBAND_API_TOKEN")
        if not token:
            return True
        expected = f"Bearer {token}"
        if self.headers.get("Authorization") == expected:
            return True
        self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "missing or invalid bearer token"})
        return False

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/healthz":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
            return

        if path == "/":
            self.send_json(
                HTTPStatus.OK,
                {
                    "service": "divband project api",
                    "endpoints": [
                        "GET /healthz",
                        "GET /projects",
                        "POST /projects",
                        "POST /deploy",
                    ],
                },
            )
            return

        if not self.require_auth():
            return

        if path == "/projects":
            self.send_json(HTTPStatus.OK, {"projects": load_projects()})
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.require_auth():
            return

        try:
            payload = self.read_json()
        except ValueError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        if path == "/projects":
            self.create_project(payload)
            return

        if path == "/deploy":
            self.deploy(payload)
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def create_project(self, payload):
        name = payload.get("name")
        kind = payload.get("kind", "static")
        domains = payload.get("domains", [])
        deploy = bool(payload.get("deploy", False))
        non_arvan_images = bool(payload.get("non_arvan_images", False))

        if not isinstance(name, str) or not name:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "name is required"})
            return
        if kind not in {"static", "nextjs"}:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "kind must be static or nextjs"})
            return
        if not isinstance(domains, list) or not all(isinstance(domain, str) for domain in domains):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "domains must be a list of strings"})
            return

        command = [str(CREATE_PROJECT), name, "--kind", kind]
        for domain in domains:
            command.extend(["--domain", domain])
        if non_arvan_images:
            command.append("--non-arvan-images")

        with WRITE_LOCK:
            create_result = run_command(command)
            project = find_project(name)
            deploy_result = None
            if create_result["returncode"] == 0 and deploy:
                deploy_result = run_command(["docker", "compose", "up", "-d", "--build"])

        status = HTTPStatus.OK if create_result["returncode"] == 0 else HTTPStatus.BAD_REQUEST
        response = {
            "project": project,
            "create": create_result,
        }
        if deploy_result is not None:
            response["deploy"] = deploy_result
            if deploy_result["returncode"] != 0:
                status = HTTPStatus.INTERNAL_SERVER_ERROR

        self.send_json(status, response)

    def deploy(self, payload):
        project = payload.get("project")
        build = bool(payload.get("build", True))
        command = ["docker", "compose", "up", "-d"]
        if build:
            command.append("--build")
        if project:
            command.append(f"{project}-web")

        with WRITE_LOCK:
            result = run_command(command)

        status = HTTPStatus.OK if result["returncode"] == 0 else HTTPStatus.INTERNAL_SERVER_ERROR
        self.send_json(status, {"deploy": result})


def main():
    host = os.environ.get("DIVBAND_API_HOST", DEFAULT_HOST)
    port = int(os.environ.get("DIVBAND_API_PORT", DEFAULT_PORT))
    server = ThreadingHTTPServer((host, port), ProjectApiHandler)
    print(f"Divband project API listening on http://{host}:{port}", flush=True)
    if not os.environ.get("DIVBAND_API_TOKEN"):
        print("DIVBAND_API_TOKEN is not set; write endpoints are unauthenticated.", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
