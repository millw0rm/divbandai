#!/usr/bin/env python3
"""Shared project registry, config generation, and lifecycle helpers."""

from __future__ import annotations

import html
import os
import re
import shutil
from pathlib import Path

import yaml

from divband_scaffold import (
    node_dockerfile,
    node_package_json,
    node_server_js,
    python_app_py,
    python_dockerfile,
    python_requirements,
)

ROOT = Path(__file__).resolve().parents[1]
PROJECTS_VARS = ROOT / "infra" / "ansible" / "vars" / "projects.yml"
PROJECTS_DIR = ROOT / "projects"
HAPROXY_CFG = ROOT / "config" / "haproxy" / "haproxy.cfg"
COMPOSE_FILE = ROOT / "docker-compose.yml"
CERTS_DIR = ROOT / "config" / "certs"
BASE_DOMAIN = os.environ.get("DIVBAND_BASE_DOMAIN", "divbandai.ir")
NEXT_VERSION = "16.2.7"
REACT_VERSION = "19.2.7"
PROTECTED_NAMES = {"test"}
SUPPORTED_KINDS = {"static", "nextjs", "node", "python", "docker"}
BUILDABLE_KINDS = {"nextjs", "node", "python", "docker"}
DEFAULT_HEALTH_PATH = "/healthz"
DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"
)


class ProjectError(Exception):
    code = "project_error"

    def __init__(self, message, *, details=None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ValidationError(ProjectError):
    code = "validation_error"


class NotFoundError(ProjectError):
    code = "not_found"


class ConflictError(ProjectError):
    code = "conflict"


class ProtectedProjectError(ConflictError):
    code = "protected_project"

    def __init__(self, name):
        super().__init__(
            f"project {name!r} is protected and cannot be deleted",
            details={"name": name},
        )


def validate_name(name):
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", name):
        raise ValidationError(
            "project name must be a DNS-safe label: lowercase letters, numbers, "
            "hyphens, and no leading/trailing hyphen",
            details={"name": name},
        )
    return name


def validate_domain(domain):
    if not isinstance(domain, str) or not domain:
        raise ValidationError("domain must be a non-empty string", details={"domain": domain})
    normalized = domain.rstrip(".").lower()
    if not DOMAIN_RE.fullmatch(normalized):
        raise ValidationError(
            f"invalid domain name: {domain!r}",
            details={"domain": domain},
        )
    return normalized


def validate_domains(domains):
    if not isinstance(domains, list):
        raise ValidationError("domains must be a list of strings")
    return [validate_domain(domain) for domain in domains]


def load_projects():
    if not PROJECTS_VARS.exists():
        return []
    data = yaml.safe_load(PROJECTS_VARS.read_text()) or {}
    return data.get("divband_projects", [])


def write_projects(projects):
    data = {"divband_projects": projects}
    PROJECTS_VARS.parent.mkdir(parents=True, exist_ok=True)
    PROJECTS_VARS.write_text(
        yaml.safe_dump(data, sort_keys=False, explicit_start=True),
    )


def find_project(name, projects=None):
    projects = projects if projects is not None else load_projects()
    return next((project for project in projects if project.get("name") == name), None)


def project_domains(name):
    if name == "test":
        return [BASE_DOMAIN, f"www.{BASE_DOMAIN}", f"{name}.{BASE_DOMAIN}"]
    return [f"{name}.{BASE_DOMAIN}"]


def project_port(kind, project=None):
    if project and project.get("port"):
        return int(project["port"])
    if kind == "nextjs":
        return 3000
    if kind == "node":
        return 3000
    if kind == "python":
        return 8000
    if kind == "docker" and project and project.get("port"):
        return int(project["port"])
    return 80


def health_check_path(project):
    return project.get("health_check") or DEFAULT_HEALTH_PATH


def normalize_project_metadata(project):
    kind = project.get("kind", "static")
    if kind not in SUPPORTED_KINDS:
        raise ValidationError("kind must be one of: " + ", ".join(sorted(SUPPORTED_KINDS)), details={"kind": kind})
    project["kind"] = kind
    project["port"] = project_port(kind, project)
    project["health_check"] = health_check_path(project)
    if project.get("env") is not None and not isinstance(project["env"], dict):
        raise ValidationError("env must be an object of string keys and values")
    if project.get("secrets") is not None:
        if not isinstance(project["secrets"], list):
            raise ValidationError("secrets must be a list of env file paths")
        for secret in project["secrets"]:
            if not isinstance(secret, str):
                raise ValidationError("secrets entries must be strings")
    if project.get("env_file") is not None and not isinstance(project["env_file"], str):
        raise ValidationError("env_file must be a string path")
    if kind == "docker":
        dockerfile = project.get("dockerfile", "Dockerfile")
        if not isinstance(dockerfile, str) or ".." in dockerfile:
            raise ValidationError("dockerfile must be a safe relative path")
        project["dockerfile"] = dockerfile
    return project


def check_domain_conflicts(domains, *, exclude_name=None, projects=None):
    projects = projects if projects is not None else load_projects()
    conflicts = []
    requested = {validate_domain(domain) for domain in domains}
    for project in projects:
        if exclude_name and project["name"] == exclude_name:
            continue
        overlap = requested.intersection(validate_domain(d) for d in project.get("domains", []))
        if overlap:
            conflicts.append({"project": project["name"], "domains": sorted(overlap)})
    if conflicts:
        raise ConflictError(
            "one or more domains are already assigned to another project",
            details={"conflicts": conflicts},
        )


def runtime_hints(project):
    name = project["name"]
    kind = project.get("kind", "static")
    buildable = kind in BUILDABLE_KINDS
    return {
        "compose_service": f"{name}-web",
        "container_name": f"divband-{name}-web",
        "image": f"divband-{name}:local" if buildable else "nginx:1.27-alpine",
        "health_path": health_check_path(project),
        "tls": bool(project.get("tls")),
    }


def index_html(name):
    escaped_name = html.escape(name)
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{escaped_name}</title>
    <style>
      :root {{
        color-scheme: light dark;
        font-family: Arial, Helvetica, sans-serif;
      }}

      body {{
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: #f6f7f9;
        color: #111827;
      }}

      main {{
        text-align: center;
      }}

      h1 {{
        margin: 0;
        font-size: clamp(2rem, 8vw, 4rem);
        font-weight: 700;
        letter-spacing: 0;
      }}

      @media (prefers-color-scheme: dark) {{
        body {{
          background: #111827;
          color: #f9fafb;
        }}
      }}
    </style>
  </head>
  <body>
    <main>
      <h1>Welcome to {escaped_name}</h1>
    </main>
  </body>
</html>
"""


def nginx_conf(project):
    domains = " ".join(project["domains"])
    health_path = health_check_path(project)
    return f"""server {{
    listen 80;
    server_name {domains};

    root /usr/share/nginx/html;
    index index.html;

    location = {health_path} {{
        access_log off;
        return 200 "ok\\n";
    }}

    location / {{
        try_files $uri $uri/ /index.html;
    }}
}}
"""


def nextjs_package_json(name):
    return f"""{{
  "name": "{name}",
  "version": "0.1.0",
  "private": true,
  "scripts": {{
    "dev": "next dev",
    "build": "next build",
    "start": "next start -H 0.0.0.0 -p 3000"
  }},
  "dependencies": {{
    "next": "{NEXT_VERSION}",
    "react": "{REACT_VERSION}",
    "react-dom": "{REACT_VERSION}"
  }}
}}
"""


def nextjs_dockerfile():
    return """FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3000
CMD ["npm", "start"]
"""


def nextjs_page(name):
    escaped_name = html.escape(name)
    return f"""export default function Home() {{
  return (
    <main className="page">
      <h1>Welcome to {escaped_name}</h1>
    </main>
  );
}}
"""


def nextjs_layout(name):
    escaped_name = html.escape(name)
    return f"""import "./globals.css";

export const metadata = {{
  title: "{escaped_name}",
}};

export default function RootLayout({{ children }}) {{
  return (
    <html lang="en">
      <body>{{children}}</body>
    </html>
  );
}}
"""


def nextjs_css():
    return """:root {
  color-scheme: light dark;
  font-family: Arial, Helvetica, sans-serif;
}

body {
  min-height: 100vh;
  margin: 0;
  background: #f6f7f9;
  color: #111827;
}

.page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  text-align: center;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 8vw, 4rem);
  font-weight: 700;
  letter-spacing: 0;
}

@media (prefers-color-scheme: dark) {
  body {
    background: #111827;
    color: #f9fafb;
  }
}
"""


def nextjs_health_route():
    return """export function GET() {
  return new Response("ok\\n", { status: 200 });
}
"""


def render_haproxy(projects):
    lines = [
        "global",
        "    log stdout format raw local0",
        "    maxconn 2048",
        "",
        "defaults",
        "    log global",
        "    mode http",
        "    option httplog",
        "    option dontlognull",
        "    timeout connect 5s",
        "    timeout client 30s",
        "    timeout server 30s",
        "",
        "frontend public_http",
        "    bind *:80",
        "",
    ]
    for project in projects:
        domains = " ".join(project["domains"])
        port_domains = " ".join(f"{domain}:80" for domain in project["domains"])
        name = project["name"]
        lines.append(f"    acl host_{name} hdr(host) -i {domains}")
        lines.append(f"    acl host_{name}_port hdr(host) -i {port_domains}")
        lines.append("")
        lines.append(f"    use_backend {name}_project if host_{name} or host_{name}_port")
    lines.extend(
        [
            "    default_backend unknown_host",
            "",
        ]
    )
    if any(project.get("tls") for project in projects):
        lines.extend(
            [
                "frontend public_https",
                "    bind *:443 ssl crt /etc/haproxy/certs/",
                "",
            ]
        )
        for project in projects:
            if not project.get("tls"):
                continue
            domains = " ".join(project["domains"])
            name = project["name"]
            lines.append(f"    acl host_{name} hdr(host) -i {domains}")
            lines.append(f"    use_backend {name}_project if host_{name}")
        lines.extend(["    default_backend unknown_host", ""])
    for project in projects:
        name = project["name"]
        port = project.get("port", project_port(project.get("kind", "static"), project))
        health_path = health_check_path(project)
        lines.extend(
            [
                f"backend {name}_project",
                f"    option httpchk GET {health_path}",
                "    http-check expect status 200",
                f"    server {name}_web {name}-web:{port} check",
                "",
            ]
        )
    lines.extend(
        [
            "backend unknown_host",
            '    http-request return status 404 content-type text/plain string "Unknown divband host\\n"',
            "",
        ]
    )
    HAPROXY_CFG.parent.mkdir(parents=True, exist_ok=True)
    HAPROXY_CFG.write_text("\n".join(lines))


def _compose_service_lines(project, prefix):
    name = project["name"]
    kind = project.get("kind", "static")
    lines = [f"  {name}-web:"]

    if kind in BUILDABLE_KINDS:
        dockerfile = project.get("dockerfile", "Dockerfile")
        lines.extend(
            [
                f"    image: divband-{name}:local",
                "    build:",
                f"      context: ./projects/{name}",
                f"      dockerfile: {dockerfile}",
            ]
        )
    else:
        lines.append(f"    image: {prefix}nginx:1.27-alpine")

    lines.extend(
        [
            f"    container_name: divband-{name}-web",
            "    restart: unless-stopped",
        ]
    )

    env = dict(project.get("env") or {})
    if kind == "nextjs" and "NODE_ENV" not in env:
        env["NODE_ENV"] = "production"
    if env:
        lines.append("    environment:")
        for key, value in sorted(env.items()):
            lines.append(f"      {key}: {value}")

    env_file_paths = []
    if project.get("env_file"):
        env_file_paths.append(project["env_file"])
    for secret in project.get("secrets") or []:
        if secret not in env_file_paths:
            env_file_paths.append(secret)
    if env_file_paths:
        lines.append("    env_file:")
        for path in env_file_paths:
            lines.append(f"      - {path}")

    if kind == "static":
        lines.extend(
            [
                "    volumes:",
                f"      - ./projects/{name}/html:/usr/share/nginx/html:ro",
                f"      - ./projects/{name}/nginx.conf:/etc/nginx/conf.d/default.conf:ro",
            ]
        )

    lines.extend(["    networks:", "      - divband", ""])
    return lines


def render_compose(projects, arvan=True):
    prefix = "docker.arvancloud.ir/" if arvan else ""
    tls_enabled = any(project.get("tls") for project in projects)
    lines = [
        "services:",
        "  haproxy:",
        f"    image: {prefix}haproxy:2.9-alpine",
        "    container_name: divband-haproxy",
        "    restart: unless-stopped",
        "    ports:",
        '      - "80:80"',
    ]
    if tls_enabled:
        lines.append('      - "443:443"')
    lines.extend(
        [
            "    volumes:",
            "      - ./config/haproxy/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro",
        ]
    )
    if tls_enabled:
        CERTS_DIR.mkdir(parents=True, exist_ok=True)
        lines.append("      - ./config/certs:/etc/haproxy/certs:ro")
    if projects:
        lines.append("    depends_on:")
        for project in projects:
            lines.append(f"      - {project['name']}-web")
    lines.extend(["    networks:", "      - divband", ""])
    for project in projects:
        lines.extend(_compose_service_lines(project, prefix))
    lines.extend(["networks:", "  divband:", "    name: divband", ""])
    COMPOSE_FILE.write_text("\n".join(lines))


def regenerate_stack(projects, *, arvan=True):
    render_haproxy(projects)
    render_compose(projects, arvan=arvan)


def create_project_files(project, *, refresh_content=True):
    project = normalize_project_metadata(dict(project))
    project_dir = PROJECTS_DIR / project["name"]
    kind = project.get("kind", "static")

    if project.get("tls"):
        CERTS_DIR.mkdir(parents=True, exist_ok=True)
        (project_dir / "certs").mkdir(parents=True, exist_ok=True)
        readme = project_dir / "certs" / "README.txt"
        if refresh_content or not readme.exists():
            readme.write_text(
                "Place combined PEM files in config/certs/ named by domain, e.g. demo.divbandai.ir.pem\n"
            )

    if kind == "nextjs":
        if not refresh_content and project_dir.exists():
            return
        app_dir = project_dir / "app"
        health_dir = app_dir / "healthz"
        health_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "package.json").write_text(nextjs_package_json(project["name"]))
        (project_dir / "Dockerfile").write_text(nextjs_dockerfile())
        (app_dir / "page.jsx").write_text(nextjs_page(project["name"]))
        (app_dir / "layout.jsx").write_text(nextjs_layout(project["name"]))
        (app_dir / "globals.css").write_text(nextjs_css())
        (health_dir / "route.js").write_text(nextjs_health_route())
        return

    if kind == "node":
        if not refresh_content and project_dir.exists():
            return
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "package.json").write_text(node_package_json(project["name"]))
        (project_dir / "server.js").write_text(node_server_js(project["name"]))
        (project_dir / "Dockerfile").write_text(node_dockerfile())
        return

    if kind == "python":
        if not refresh_content and project_dir.exists():
            return
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "requirements.txt").write_text(python_requirements())
        (project_dir / "app.py").write_text(python_app_py(project["name"]))
        (project_dir / "Dockerfile").write_text(python_dockerfile())
        return

    if kind == "docker":
        project_dir.mkdir(parents=True, exist_ok=True)
        dockerfile = project_dir / project.get("dockerfile", "Dockerfile")
        if refresh_content and not dockerfile.exists():
            dockerfile.write_text(
                "FROM nginx:1.27-alpine\nCOPY html/ /usr/share/nginx/html/\nEXPOSE 80\n"
            )
            (project_dir / "html").mkdir(parents=True, exist_ok=True)
            (project_dir / "html" / "index.html").write_text(index_html(project["name"]))
        elif not dockerfile.exists():
            raise ValidationError(
                "docker kind requires a Dockerfile in the project tree",
                details={"path": str(dockerfile.relative_to(ROOT))},
            )
        return

    html_dir = project_dir / "html"
    html_dir.mkdir(parents=True, exist_ok=True)
    if refresh_content or not (html_dir / "index.html").exists():
        (html_dir / "index.html").write_text(index_html(project["name"]))
    (project_dir / "nginx.conf").write_text(nginx_conf(project))


def _merge_metadata(project, metadata):
    for key in ("env", "env_file", "secrets", "health_check", "tls", "dockerfile", "port"):
        if key in metadata and metadata[key] is not None:
            project[key] = metadata[key]
    return normalize_project_metadata(project)


def create_or_refresh_project(
    name,
    *,
    kind="static",
    extra_domains=None,
    arvan=True,
    refresh_content=True,
    metadata=None,
):
    validate_name(name)
    if kind not in SUPPORTED_KINDS:
        raise ValidationError(
            "kind must be one of: " + ", ".join(sorted(SUPPORTED_KINDS)),
            details={"kind": kind},
        )

    projects = load_projects()
    domains = project_domains(name)
    for domain in extra_domains or []:
        normalized = validate_domain(domain)
        if normalized not in domains:
            domains.append(normalized)
    check_domain_conflicts(domains, exclude_name=name, projects=projects)

    existing = find_project(name, projects)
    if existing:
        project = dict(existing)
        project["domains"] = domains
        project["kind"] = kind
        project = _merge_metadata(project, metadata or {})
        for index, item in enumerate(projects):
            if item["name"] == name:
                projects[index] = project
                break
        action = "refreshed"
    else:
        project = {
            "name": name,
            "kind": kind,
            "port": project_port(kind),
            "domains": domains,
        }
        project = _merge_metadata(project, metadata or {})
        projects.append(project)
        projects.sort(key=lambda item: item["name"])
        action = "created"

    create_project_files(project, refresh_content=refresh_content)
    write_projects(projects)
    regenerate_stack(projects, arvan=arvan)
    return {"action": action, "project": project}


def patch_project(
    name,
    *,
    kind=None,
    domains=None,
    arvan=True,
    refresh_content=False,
    metadata=None,
):
    validate_name(name)
    projects = load_projects()
    project = find_project(name, projects)
    if not project:
        raise NotFoundError(f"project {name!r} not found", details={"name": name})

    project = dict(project)
    kind_changed = kind is not None and kind != project.get("kind", "static")
    if kind is not None:
        if kind not in SUPPORTED_KINDS:
            raise ValidationError(
                "kind must be one of: " + ", ".join(sorted(SUPPORTED_KINDS)),
                details={"kind": kind},
            )
        project["kind"] = kind

    if domains is not None:
        merged = list(project.get("domains", []))
        for domain in validate_domains(domains):
            if domain not in merged:
                merged.append(domain)
        project["domains"] = merged

    project = _merge_metadata(project, metadata or {})
    check_domain_conflicts(project["domains"], exclude_name=name, projects=projects)

    if kind_changed:
        project_dir = PROJECTS_DIR / name
        if project_dir.exists():
            shutil.rmtree(project_dir)
        create_project_files(project, refresh_content=True)
    elif domains is not None:
        if project.get("kind", "static") == "static":
            (PROJECTS_DIR / name / "nginx.conf").write_text(nginx_conf(project))
        if refresh_content:
            create_project_files(project, refresh_content=True)
    elif metadata:
        if project.get("kind", "static") == "static":
            (PROJECTS_DIR / name / "nginx.conf").write_text(nginx_conf(project))

    for index, item in enumerate(projects):
        if item["name"] == name:
            projects[index] = project
            break
    write_projects(projects)
    regenerate_stack(projects, arvan=arvan)
    return {"action": "updated", "project": project}


def replace_project(name, *, kind="static", domains=None, arvan=True, refresh_content=True, metadata=None):
    validate_name(name)
    if kind not in SUPPORTED_KINDS:
        raise ValidationError(
            "kind must be one of: " + ", ".join(sorted(SUPPORTED_KINDS)),
            details={"kind": kind},
        )

    projects = load_projects()
    merged_domains = project_domains(name)
    for domain in domains or []:
        normalized = validate_domain(domain)
        if normalized not in merged_domains:
            merged_domains.append(normalized)
    check_domain_conflicts(merged_domains, exclude_name=name, projects=projects)

    project = {
        "name": name,
        "kind": kind,
        "port": project_port(kind),
        "domains": merged_domains,
    }
    project = _merge_metadata(project, metadata or {})
    remaining = [item for item in projects if item["name"] != name]
    remaining.append(project)
    remaining.sort(key=lambda item: item["name"])

    project_dir = PROJECTS_DIR / name
    if project_dir.exists():
        shutil.rmtree(project_dir)
    create_project_files(project, refresh_content=refresh_content)
    write_projects(remaining)
    regenerate_stack(remaining, arvan=arvan)
    return {"action": "replaced", "project": project}


def delete_project_tree(name):
    project_dir = PROJECTS_DIR / name
    if project_dir.exists():
        shutil.rmtree(project_dir)
        return True
    return False


def upload_project_files(name, files):
    validate_name(name)
    project = find_project(name)
    if not project:
        raise NotFoundError(f"project {name!r} not found", details={"name": name})
    if project.get("kind", "static") != "static":
        raise ValidationError("file upload is supported for static projects only", details={"kind": project.get("kind")})

    project_dir = PROJECTS_DIR / name
    if not project_dir.exists():
        raise NotFoundError(f"project tree for {name!r} not found", details={"name": name})

    written = []
    for relative_path, content in files.items():
        if not isinstance(relative_path, str) or ".." in relative_path or relative_path.startswith("/"):
            raise ValidationError(f"unsafe file path: {relative_path!r}", details={"path": relative_path})
        target = project_dir / relative_path
        if relative_path.startswith("html/"):
            target.parent.mkdir(parents=True, exist_ok=True)
        elif relative_path == "nginx.conf":
            pass
        else:
            raise ValidationError(
                "only html/* and nginx.conf uploads are allowed",
                details={"path": relative_path},
            )
        target.write_text(content)
        written.append(relative_path)
    return {"written": written, "project": name}


def detect_drift():
    projects = load_projects()
    expected_services = {f"{project['name']}-web" for project in projects}
    drift = {
        "projects": projects,
        "expected_services": sorted(expected_services),
        "missing_services": [],
        "extra_services": [],
        "registry_mismatch": False,
        "haproxy_mismatch": False,
        "compose_mismatch": False,
    }

    try:
        from divband_docker import compose_ps

        running = compose_ps()
        running_services = {item.get("Service") for item in running if item.get("Service")}
        drift["running_services"] = sorted(running_services)
        drift["missing_services"] = sorted(expected_services - running_services)
        drift["extra_services"] = sorted(running_services - expected_services - {"haproxy"})
    except Exception as exc:
        drift["docker_error"] = str(exc)

    if HAPROXY_CFG.exists():
        haproxy_text = HAPROXY_CFG.read_text()
        for project in projects:
            if f"backend {project['name']}_project" not in haproxy_text:
                drift["haproxy_mismatch"] = True
                break

    if COMPOSE_FILE.exists():
        compose_text = COMPOSE_FILE.read_text()
        for project in projects:
            if f"  {project['name']}-web:" not in compose_text:
                drift["compose_mismatch"] = True
                break

    drift["has_drift"] = bool(
        drift.get("missing_services")
        or drift.get("extra_services")
        or drift["haproxy_mismatch"]
        or drift["compose_mismatch"]
    )
    return drift


def delete_project(name, *, arvan=True, backup_before=False):
    validate_name(name)
    if name in PROTECTED_NAMES:
        raise ProtectedProjectError(name)

    projects = load_projects()
    project = find_project(name, projects)
    if not project:
        raise NotFoundError(f"project {name!r} not found", details={"name": name})

    kind = project.get("kind", "static")
    remaining = [item for item in projects if item["name"] != name]
    steps = []

    backup_info = None
    if backup_before:
        from divband_backup import backup_project

        backup_info = backup_project(name)
        steps.append({"step": "backup", "ok": True, "backup": backup_info["backup"]})

    write_projects(remaining)
    steps.append({"step": "registry", "ok": True})

    deleted_tree = delete_project_tree(name)
    steps.append({"step": "project_tree", "ok": True, "deleted": deleted_tree})

    regenerate_stack(remaining, arvan=arvan)
    steps.append({"step": "regenerate_stack", "ok": True})

    return {
        "action": "deleted",
        "name": name,
        "kind": kind,
        "steps": steps,
        "remaining_projects": len(remaining),
        "backup": backup_info,
    }
