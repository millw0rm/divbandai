#!/usr/bin/env python3
"""Minimal deploy webhook: POST /deploy {"sha":"<git-sha>"} triggers vps-deploy.sh."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPLOY_SCRIPT = ROOT / "scripts" / "vps-deploy.sh"
SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")

HOST = os.environ.get("DIVBAND_DEPLOY_WEBHOOK_HOST", "0.0.0.0")
PORT = int(os.environ.get("DIVBAND_DEPLOY_WEBHOOK_PORT", "9090"))
SECRET = os.environ.get("DIVBAND_DEPLOY_WEBHOOK_SECRET", "")
DEPLOY_LOCK = threading.Lock()


def authorized(header_value: str) -> bool:
    if not SECRET:
        return False
    expected = f"Bearer {SECRET}"
    return header_value == expected


def run_deploy(sha: str) -> tuple[int, str]:
    if not DEPLOY_SCRIPT.exists():
        return 1, f"missing deploy script: {DEPLOY_SCRIPT}"
    if not SHA_RE.fullmatch(sha):
        return 1, "invalid sha"

    with DEPLOY_LOCK:
        completed = subprocess.run(
            [str(DEPLOY_SCRIPT), sha],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
    output = (completed.stdout or "") + (completed.stderr or "")
    return completed.returncode, output.strip() or f"exit {completed.returncode}"


class DeployWebhookHandler(BaseHTTPRequestHandler):
    server_version = "divband-deploy-webhook/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, status: HTTPStatus, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in {"/healthz", "/"}:
            self._json(HTTPStatus.OK, {"ok": True, "service": "divband-deploy-webhook"})
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/deploy":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if not authorized(self.headers.get("Authorization", "")):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
            return

        sha = str(payload.get("sha", "")).strip()
        if not sha:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "sha_required"})
            return

        code, message = run_deploy(sha)
        if code == 0:
            self._json(HTTPStatus.OK, {"ok": True, "sha": sha, "message": message})
        else:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "sha": sha, "error": message})


def main():
    if not SECRET:
        print("DIVBAND_DEPLOY_WEBHOOK_SECRET is required", file=sys.stderr)
        sys.exit(2)
    if not DEPLOY_SCRIPT.exists():
        print(f"missing {DEPLOY_SCRIPT}", file=sys.stderr)
        sys.exit(2)

    server = ThreadingHTTPServer((HOST, PORT), DeployWebhookHandler)
    print(f"deploy webhook listening on {HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
