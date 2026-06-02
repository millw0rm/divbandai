#!/usr/bin/env python3
"""Cross-cutting API support: auth scopes, rate limits, audit, jobs, metrics."""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = ROOT / ".divband"
AUDIT_LOG = STATE_DIR / "audit.log"
JOBS_FILE = STATE_DIR / "jobs.json"
DEPLOY_STATE_FILE = STATE_DIR / "deploy-state.json"
METRICS = {
    "project_create_total": 0,
    "project_delete_total": 0,
    "deploy_total": 0,
    "deploy_failures_total": 0,
    "request_total": 0,
    "rate_limited_total": 0,
}
METRICS_LOCK = threading.Lock()
JOBS_LOCK = threading.Lock()
JOBS = {}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def ensure_state_dir():
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def load_scoped_tokens():
    raw = os.environ.get("DIVBAND_API_SCOPED_TOKENS")
    if not raw:
        return {}
    data = json.loads(raw)
    tokens = {}
    for token, config in data.items():
        if isinstance(config, str):
            tokens[token] = {"scope": config}
        else:
            tokens[token] = config
    return tokens


def authorize(header_value):
    master = os.environ.get("DIVBAND_API_TOKEN")
    if not master and not load_scoped_tokens():
        return {"scope": "admin", "projects": None}

    if not header_value or not header_value.startswith("Bearer "):
        return None

    token = header_value.removeprefix("Bearer ").strip()
    if master and token == master:
        return {"scope": "admin", "projects": None}

    scoped = load_scoped_tokens().get(token)
    if not scoped:
        return None
    return {
        "scope": scoped.get("scope", "read"),
        "projects": scoped.get("projects"),
    }


def require_scope(auth, *, write=False, project=None):
    if auth is None:
        return False
    scope = auth.get("scope", "read")
    if scope == "admin":
        return True
    if write and scope == "read":
        return False
    allowed = auth.get("projects")
    if allowed is not None and project and project not in allowed:
        return False
    return True


class RateLimiter:
    def __init__(self, limit=60, window_seconds=60):
        self.limit = int(os.environ.get("DIVBAND_API_RATE_LIMIT", limit))
        self.window = int(os.environ.get("DIVBAND_API_RATE_WINDOW", window_seconds))
        self.events = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key):
        if self.limit <= 0:
            return True
        now = time.monotonic()
        with self.lock:
            bucket = self.events[key]
            while bucket and now - bucket[0] > self.window:
                bucket.popleft()
            if len(bucket) >= self.limit:
                with METRICS_LOCK:
                    METRICS["rate_limited_total"] += 1
                return False
            bucket.append(now)
            return True


RATE_LIMITER = RateLimiter()


def audit(action, *, request_id, actor=None, details=None):
    ensure_state_dir()
    entry = {
        "timestamp": utc_now(),
        "action": action,
        "request_id": request_id,
        "actor": actor or "anonymous",
        "details": details or {},
    }
    with AUDIT_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")


def record_deploy(action, *, returncode, project=None, request_id=None):
    ensure_state_dir()
    payload = {
        "timestamp": utc_now(),
        "action": action,
        "returncode": returncode,
        "project": project,
        "request_id": request_id,
    }
    DEPLOY_STATE_FILE.write_text(json.dumps(payload, indent=2) + "\n")
    with METRICS_LOCK:
        METRICS["deploy_total"] += 1
        if returncode != 0:
            METRICS["deploy_failures_total"] += 1


def last_deploy_state():
    if not DEPLOY_STATE_FILE.exists():
        return None
    return json.loads(DEPLOY_STATE_FILE.read_text())


def increment_metric(name):
    with METRICS_LOCK:
        METRICS[name] = METRICS.get(name, 0) + 1


def prometheus_metrics():
    projects_count = 0
    try:
        from divband_projects import load_projects

        projects_count = len(load_projects())
    except Exception:
        pass
    with METRICS_LOCK:
        lines = [
            "# HELP divband_projects_total Number of registered projects",
            "# TYPE divband_projects_total gauge",
            f"divband_projects_total {projects_count}",
        ]
        for key, value in sorted(METRICS.items()):
            metric = f"divband_{key}"
            lines.extend(
                [
                    f"# TYPE {metric} counter",
                    f"{metric} {value}",
                ]
            )
    return "\n".join(lines) + "\n"


def git_dirty_paths():
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return {"available": False, "dirty": None, "paths": []}
    paths = [line[3:].strip() for line in result.stdout.splitlines() if line.strip()]
    return {"available": True, "dirty": bool(paths), "paths": paths}


def save_jobs():
    ensure_state_dir()
    JOBS_FILE.write_text(json.dumps(JOBS, indent=2))


def create_job(kind, *, payload=None):
    job_id = str(uuid.uuid4())
    job = {
        "id": job_id,
        "kind": kind,
        "status": "queued",
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "payload": payload or {},
        "result": None,
        "error": None,
    }
    with JOBS_LOCK:
        JOBS[job_id] = job
        save_jobs()
    return job


def update_job(job_id, **fields):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return None
        job.update(fields)
        job["updated_at"] = utc_now()
        save_jobs()
        return dict(job)


def get_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        return dict(job) if job else None


def load_jobs():
    ensure_state_dir()
    if JOBS_FILE.exists():
        global JOBS
        JOBS = json.loads(JOBS_FILE.read_text())


def deliver_webhook(callback_url, payload):
    if not callback_url:
        return {"delivered": False, "skipped": True}
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        callback_url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "DivbandProjectAPI/1.2"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return {"delivered": True, "status": response.status}
    except urllib.error.URLError as exc:
        return {"delivered": False, "error": str(exc.reason)}


def run_async_job(job_id, worker):
    def _runner():
        update_job(job_id, status="running")
        try:
            result = worker()
            job = update_job(job_id, status="completed", result=result)
            callback = (job or {}).get("payload", {}).get("callback_url")
            if callback:
                deliver_webhook(callback, {"job": get_job(job_id)})
        except Exception as exc:
            job = update_job(job_id, status="failed", error=str(exc))
            callback = (job or {}).get("payload", {}).get("callback_url")
            if callback:
                deliver_webhook(callback, {"job": get_job(job_id)})

    threading.Thread(target=_runner, daemon=True).start()


load_jobs()
