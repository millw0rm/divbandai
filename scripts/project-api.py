#!/usr/bin/env python3
import json
import os
import sys
import threading
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from divband_api_support import (
    RATE_LIMITER,
    audit,
    authorize,
    create_job,
    get_job,
    git_dirty_paths,
    increment_metric,
    last_deploy_state,
    prometheus_metrics,
    record_deploy,
    require_scope,
    run_async_job,
)
from divband_backup import backup_project, list_backups, restore_project
from divband_docker import (
    DockerError,
    DockerUnavailableError,
    deploy,
    docker_system_info,
    finalize_delete,
    project_status,
    stack_status,
)
from divband_dns import DnsError, create_a_records, delete_a_records
from divband_projects import (
    BUILDABLE_KINDS,
    ConflictError,
    NotFoundError,
    ProjectError,
    ProtectedProjectError,
    ValidationError,
    create_or_refresh_project,
    delete_project as remove_project_record,
    detect_drift,
    find_project,
    load_projects,
    patch_project,
    replace_project,
    runtime_hints,
    upload_project_files,
)
from divband_remote import RemoteError, load_environments, run_ansible

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8080
WRITE_LOCK = threading.Lock()

API_ROUTES = [
    {"method": "GET", "path": "/healthz", "auth": False},
    {"method": "GET", "path": "/", "auth": False},
    {"method": "GET", "path": "/v1/metrics", "auth": False},
    {"method": "GET", "path": "/v1/projects", "auth": True},
    {"method": "GET", "path": "/v1/projects/{name}", "auth": True},
    {"method": "GET", "path": "/v1/projects/{name}/status", "auth": True},
    {"method": "GET", "path": "/v1/projects/{name}/backups", "auth": True},
    {"method": "GET", "path": "/v1/status", "auth": True},
    {"method": "GET", "path": "/v1/drift", "auth": True},
    {"method": "GET", "path": "/v1/jobs/{id}", "auth": True},
    {"method": "GET", "path": "/v1/system/docker", "auth": True},
    {"method": "GET", "path": "/v1/system/git", "auth": True},
    {"method": "GET", "path": "/v1/environments", "auth": True},
    {"method": "POST", "path": "/v1/projects", "auth": True},
    {"method": "POST", "path": "/v1/projects/{name}/restore", "auth": True},
    {"method": "POST", "path": "/v1/projects/{name}/backup", "auth": True},
    {"method": "PUT", "path": "/v1/projects/{name}", "auth": True},
    {"method": "PUT", "path": "/v1/projects/{name}/files", "auth": True},
    {"method": "PATCH", "path": "/v1/projects/{name}", "auth": True},
    {"method": "DELETE", "path": "/v1/projects/{name}", "auth": True},
    {"method": "POST", "path": "/v1/deploy", "auth": True},
    {"method": "POST", "path": "/v1/remote/deploy", "auth": True},
]


def normalize_path(path):
    if path != "/" and path.endswith("/"):
        return path.rstrip("/")
    return path


def strip_version_prefix(path):
    if path == "/projects" or path.startswith("/projects/"):
        return "/v1" + path
    if path == "/deploy":
        return "/v1/deploy"
    if path == "/status":
        return "/v1/status"
    if path == "/metrics":
        return "/v1/metrics"
    if path == "/drift":
        return "/v1/drift"
    return path


def parse_project_path(path):
    if not path.startswith("/v1/projects/"):
        return None, None
    remainder = path[len("/v1/projects/") :]
    if not remainder:
        return None, None
    parts = remainder.split("/")
    name = unquote(parts[0])
    suffix = parts[1] if len(parts) > 1 else None
    return name, suffix


def error_payload(exc, *, request_id):
    if isinstance(exc, (ProjectError, DockerError, RemoteError, DnsError)):
        return {
            "error": exc.message,
            "code": exc.code,
            "details": exc.details,
            "request_id": request_id,
        }
    return {
        "error": str(exc),
        "code": "internal_error",
        "details": {},
        "request_id": request_id,
    }


def http_status_for_error(exc):
    if isinstance(exc, ValidationError):
        return HTTPStatus.BAD_REQUEST
    if isinstance(exc, NotFoundError):
        return HTTPStatus.NOT_FOUND
    if isinstance(exc, (ConflictError, ProtectedProjectError)):
        return HTTPStatus.CONFLICT
    if isinstance(exc, DockerUnavailableError):
        return HTTPStatus.SERVICE_UNAVAILABLE
    if isinstance(exc, (DockerError, RemoteError, DnsError)):
        return HTTPStatus.INTERNAL_SERVER_ERROR
    if isinstance(exc, ProjectError):
        return HTTPStatus.BAD_REQUEST
    return HTTPStatus.INTERNAL_SERVER_ERROR


def project_metadata_from_payload(payload):
    metadata = {}
    for key in ("env", "env_file", "secrets", "health_check", "tls", "dockerfile", "port"):
        if key in payload:
            metadata[key] = payload[key]
    return metadata


class ProjectApiHandler(BaseHTTPRequestHandler):
    server_version = "DivbandProjectAPI/1.2"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    @property
    def request_id(self):
        return getattr(self, "_request_id", "unknown")

    @property
    def auth(self):
        return getattr(self, "_auth", None)

    def client_key(self):
        return self.headers.get("X-Forwarded-For", self.client_address[0])

    def send_json(self, status, payload):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Request-Id", self.request_id)
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, status, body, content_type):
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("X-Request-Id", self.request_id)
        self.end_headers()
        self.wfile.write(encoded)

    def send_error_json(self, status, exc):
        self.send_json(status, error_payload(exc, request_id=self.request_id))

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValidationError(f"invalid JSON: {exc}") from exc

    def require_auth(self, *, write=False, project=None):
        self._auth = authorize(self.headers.get("Authorization"))
        if self._auth is None and (
            os.environ.get("DIVBAND_API_TOKEN") or os.environ.get("DIVBAND_API_SCOPED_TOKENS")
        ):
            self.send_json(
                HTTPStatus.UNAUTHORIZED,
                {
                    "error": "missing or invalid bearer token",
                    "code": "unauthorized",
                    "details": {},
                    "request_id": self.request_id,
                },
            )
            return False
        if not require_scope(self._auth, write=write, project=project):
            self.send_json(
                HTTPStatus.FORBIDDEN,
                {
                    "error": "token scope does not allow this operation",
                    "code": "forbidden",
                    "details": {"project": project, "write": write},
                    "request_id": self.request_id,
                },
            )
            return False
        return True

    def check_rate_limit(self):
        if not RATE_LIMITER.allow(self.client_key()):
            self.send_json(
                HTTPStatus.TOO_MANY_REQUESTS,
                {
                    "error": "rate limit exceeded",
                    "code": "rate_limited",
                    "details": {},
                    "request_id": self.request_id,
                },
            )
            return False
        return True

    def dispatch(self, method):
        self._request_id = self.headers.get("X-Request-Id") or str(uuid.uuid4())
        path = normalize_path(strip_version_prefix(urlparse(self.path).path))
        increment_metric("request_total")

        if path == "/healthz":
            self.send_json(HTTPStatus.OK, {"status": "ok", "request_id": self.request_id})
            return

        if path == "/v1/metrics":
            self.send_text(HTTPStatus.OK, prometheus_metrics(), "text/plain; version=0.0.4")
            return

        if path == "/":
            self.send_json(
                HTTPStatus.OK,
                {
                    "service": "divband project api",
                    "version": "v1.2",
                    "routes": API_ROUTES,
                    "docs": {
                        "openapi": "docs/openapi.yaml",
                        "tls": "docs/api-tls.md",
                        "git_state": "API mutates tracked files; commit or treat repo as runtime state",
                    },
                    "request_id": self.request_id,
                },
            )
            return

        write_methods = {"POST", "PUT", "PATCH", "DELETE"}
        needs_auth = path.startswith("/v1/")
        project_name, _ = parse_project_path(path) if path.startswith("/v1/projects/") else (None, None)

        if needs_auth:
            if not self.check_rate_limit():
                return
            if not self.require_auth(write=method in write_methods, project=project_name):
                return

        try:
            if method == "GET":
                self.handle_get(path)
            elif method == "POST":
                self.handle_post(path, self.read_json())
            elif method == "PATCH":
                self.handle_patch(path, self.read_json())
            elif method == "PUT":
                self.handle_put(path, self.read_json())
            elif method == "DELETE":
                self.handle_delete(path)
            else:
                self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method not allowed"})
        except (ProjectError, DockerError, RemoteError, DnsError) as exc:
            self.send_error_json(http_status_for_error(exc), exc)

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PATCH(self):
        self.dispatch("PATCH")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def handle_get(self, path):
        if path == "/v1/projects":
            self.send_json(HTTPStatus.OK, {"projects": load_projects(), "request_id": self.request_id})
            return

        if path == "/v1/status":
            payload = stack_status()
            payload["last_deploy"] = last_deploy_state()
            payload["request_id"] = self.request_id
            self.send_json(HTTPStatus.OK, payload)
            return

        if path == "/v1/drift":
            self.send_json(HTTPStatus.OK, {"drift": detect_drift(), "request_id": self.request_id})
            return

        if path == "/v1/system/docker":
            self.send_json(HTTPStatus.OK, {"docker": docker_system_info(), "request_id": self.request_id})
            return

        if path == "/v1/system/git":
            self.send_json(HTTPStatus.OK, {"git": git_dirty_paths(), "request_id": self.request_id})
            return

        if path == "/v1/environments":
            self.send_json(HTTPStatus.OK, {"environments": load_environments(), "request_id": self.request_id})
            return

        if path.startswith("/v1/jobs/"):
            job_id = path.split("/")[-1]
            job = get_job(job_id)
            if not job:
                raise NotFoundError(f"job {job_id!r} not found", details={"id": job_id})
            self.send_json(HTTPStatus.OK, {"job": job, "request_id": self.request_id})
            return

        name, suffix = parse_project_path(path)
        if name and suffix == "status":
            project = find_project(name)
            if not project:
                raise NotFoundError(f"project {name!r} not found", details={"name": name})
            self.send_json(
                HTTPStatus.OK,
                {
                    "project": project,
                    "runtime": runtime_hints(project),
                    "status": project_status(name),
                    "last_deploy": last_deploy_state(),
                    "request_id": self.request_id,
                },
            )
            return

        if name and suffix == "backups":
            self.send_json(
                HTTPStatus.OK,
                {"name": name, "backups": list_backups(name), "request_id": self.request_id},
            )
            return

        if name and suffix is None:
            project = find_project(name)
            if not project:
                raise NotFoundError(f"project {name!r} not found", details={"name": name})
            self.send_json(
                HTTPStatus.OK,
                {
                    "project": project,
                    "runtime": runtime_hints(project),
                    "request_id": self.request_id,
                },
            )
            return

        raise NotFoundError("not found", details={"path": path})

    def handle_post(self, path, payload):
        if path == "/v1/projects":
            self.create_project(payload)
            return
        if path == "/v1/deploy":
            self.run_deploy(payload)
            return
        if path == "/v1/remote/deploy":
            self.remote_deploy(payload)
            return

        name, suffix = parse_project_path(path)
        if name and suffix == "restore":
            result = restore_project(
                name,
                backup_file=payload.get("backup_file"),
                arvan=not bool(payload.get("non_arvan_images", False)),
                deploy=bool(payload.get("deploy", False)),
            )
            audit("project.restore", request_id=self.request_id, details={"name": name})
            self.send_json(HTTPStatus.OK, {**result, "request_id": self.request_id})
            return
        if name and suffix == "backup":
            result = backup_project(name)
            audit("project.backup", request_id=self.request_id, details={"name": name})
            self.send_json(HTTPStatus.OK, {**result, "request_id": self.request_id})
            return

        raise NotFoundError("not found", details={"path": path})

    def handle_patch(self, path, payload):
        name, suffix = parse_project_path(path)
        if not name or suffix is not None:
            raise NotFoundError("not found", details={"path": path})
        self.update_project(name, payload, replace=False)

    def handle_put(self, path, payload):
        name, suffix = parse_project_path(path)
        if name and suffix == "files":
            files = payload.get("files")
            if not isinstance(files, dict):
                raise ValidationError("files must be an object of path -> content")
            result = upload_project_files(name, files)
            audit("project.files", request_id=self.request_id, details={"name": name, "files": result["written"]})
            self.send_json(HTTPStatus.OK, {**result, "request_id": self.request_id})
            return
        if not name or suffix is not None:
            raise NotFoundError("not found", details={"path": path})
        self.update_project(name, payload, replace=True)

    def handle_delete(self, path):
        name, suffix = parse_project_path(path)
        if not name or suffix is not None:
            raise NotFoundError("not found", details={"path": path})
        try:
            payload = self.read_json()
        except ValidationError:
            payload = {}
        self.remove_project(name, payload)

    def _maybe_async(self, payload, worker):
        if not bool(payload.get("async")):
            return worker(), None
        job = create_job("operation", payload=payload)
        run_async_job(job["id"], worker)
        return None, job["id"]

    def create_project(self, payload):
        name = payload.get("name")
        if not isinstance(name, str) or not name:
            raise ValidationError("name is required")

        kind = payload.get("kind", "static")
        domains = payload.get("domains", [])
        deploy_now = bool(payload.get("deploy", False))
        non_arvan_images = bool(payload.get("non_arvan_images", False))
        refresh_content = bool(payload.get("refresh_content", True))
        metadata = project_metadata_from_payload(payload)

        if not isinstance(domains, list):
            raise ValidationError("domains must be a list of strings")

        def work():
            with WRITE_LOCK:
                result = create_or_refresh_project(
                    name,
                    kind=kind,
                    extra_domains=domains,
                    arvan=not non_arvan_images,
                    refresh_content=refresh_content,
                    metadata=metadata,
                )
                dns_result = None
                if bool(payload.get("dns", False)):
                    dns_result = create_a_records(result["project"]["domains"])
                deploy_result = None
                if deploy_now:
                    deploy_result = deploy("up", build=True, project=name, remove_orphans=True)
                    record_deploy("up", returncode=0, project=name, request_id=self.request_id)
                return {"project": result["project"], "action": result["action"], "dns": dns_result, "deploy": deploy_result}

        result, job_id = self._maybe_async(payload, work)
        if job_id:
            self.send_json(HTTPStatus.ACCEPTED, {"job_id": job_id, "request_id": self.request_id})
            return

        increment_metric("project_create_total")
        audit("project.create", request_id=self.request_id, details={"name": name, "action": result["action"]})
        status = HTTPStatus.CREATED if result["action"] == "created" else HTTPStatus.OK
        self.send_json(status, {**result, "request_id": self.request_id})

    def update_project(self, name, payload, *, replace):
        kind = payload.get("kind")
        domains = payload.get("domains")
        non_arvan_images = bool(payload.get("non_arvan_images", False))
        refresh_content = bool(payload.get("refresh_content", False))
        deploy_now = bool(payload.get("deploy", False))
        metadata = project_metadata_from_payload(payload)

        with WRITE_LOCK:
            if replace:
                result = replace_project(
                    name,
                    kind=kind or "static",
                    domains=domains,
                    arvan=not non_arvan_images,
                    refresh_content=bool(payload.get("refresh_content", True)),
                    metadata=metadata,
                )
            else:
                if kind is None and domains is None and not metadata:
                    raise ValidationError("at least one updatable field is required")
                result = patch_project(
                    name,
                    kind=kind,
                    domains=domains,
                    arvan=not non_arvan_images,
                    refresh_content=refresh_content,
                    metadata=metadata,
                )
            deploy_result = None
            if deploy_now:
                deploy_result = deploy(
                    payload.get("deploy_action", "up"),
                    project=name,
                    build=bool(payload.get("build", True)),
                    remove_orphans=True,
                )
                record_deploy(payload.get("deploy_action", "up"), returncode=0, project=name, request_id=self.request_id)

        audit("project.update", request_id=self.request_id, details={"name": name, "action": result["action"]})
        response = {"project": result["project"], "action": result["action"], "request_id": self.request_id}
        if deploy_result is not None:
            response["deploy"] = deploy_result
        self.send_json(HTTPStatus.OK, response)

    def remove_project(self, name, payload):
        non_arvan_images = bool(payload.get("non_arvan_images", False))
        reload_stack = bool(payload.get("reload_stack", True))
        prune_image = bool(payload.get("prune_image", True))
        prune_volumes = bool(payload.get("prune_volumes", False))
        backup_before = bool(payload.get("backup_before", False))

        project = find_project(name)
        domains = project["domains"] if project else []

        with WRITE_LOCK:
            result = remove_project_record(
                name,
                arvan=not non_arvan_images,
                backup_before=backup_before,
            )
            docker_steps = []
            if not payload.get("skip_docker"):
                try:
                    docker_steps = finalize_delete(
                        name,
                        kind=result["kind"],
                        reload_stack=reload_stack,
                        prune_image=prune_image,
                        prune_volumes=prune_volumes,
                    )
                except DockerError as exc:
                    docker_steps = [{"step": "docker", "ok": False, "error": exc.message, **exc.details}]
            dns_result = None
            if bool(payload.get("dns", False)) and domains:
                dns_result = delete_a_records(domains)

        increment_metric("project_delete_total")
        audit("project.delete", request_id=self.request_id, details={"name": name})
        failed_steps = [step for step in docker_steps if not step.get("ok", True)]
        response = {**result, "docker": docker_steps, "dns": dns_result, "request_id": self.request_id}
        status = HTTPStatus.OK if not failed_steps else HTTPStatus.MULTI_STATUS
        self.send_json(status, response)

    def run_deploy(self, payload):
        action = payload.get("action", "up")
        project = payload.get("project")
        build = bool(payload.get("build", True))
        remove_orphans = bool(payload.get("remove_orphans", True))
        force_recreate = bool(payload.get("force_recreate", False))

        def work():
            with WRITE_LOCK:
                result = deploy(
                    action,
                    project=project,
                    build=build,
                    remove_orphans=remove_orphans,
                    force_recreate=force_recreate,
                )
                record_deploy(action, returncode=0, project=project, request_id=self.request_id)
                services = stack_status().get("services")
                return {"deploy": result, "services": services}

        result, job_id = self._maybe_async(payload, work)
        if job_id:
            self.send_json(HTTPStatus.ACCEPTED, {"job_id": job_id, "request_id": self.request_id})
            return

        audit("deploy", request_id=self.request_id, details={"action": action, "project": project})
        self.send_json(HTTPStatus.OK, {**result, "request_id": self.request_id})

    def remote_deploy(self, payload):
        environment = payload.get("environment", "production")

        def work():
            return {"remote": run_ansible(environment, extra_vars=payload.get("extra_vars"))}

        result, job_id = self._maybe_async(payload, work)
        if job_id:
            self.send_json(HTTPStatus.ACCEPTED, {"job_id": job_id, "request_id": self.request_id})
            return

        audit("remote.deploy", request_id=self.request_id, details={"environment": environment})
        self.send_json(HTTPStatus.OK, {**result, "request_id": self.request_id})


def main():
    host = os.environ.get("DIVBAND_API_HOST", DEFAULT_HOST)
    port = int(os.environ.get("DIVBAND_API_PORT", DEFAULT_PORT))
    server = ThreadingHTTPServer((host, port), ProjectApiHandler)
    print(f"Divband project API listening on http://{host}:{port}", flush=True)
    if host not in {"127.0.0.1", "localhost", "::1"} and not (
        os.environ.get("DIVBAND_API_TOKEN") or os.environ.get("DIVBAND_API_SCOPED_TOKENS")
    ):
        print(
            "warning: DIVBAND_API_HOST is not loopback and no API tokens are configured",
            flush=True,
        )
    elif not os.environ.get("DIVBAND_API_TOKEN") and not os.environ.get("DIVBAND_API_SCOPED_TOKENS"):
        print("No API tokens configured; authenticated routes accept any caller.", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
