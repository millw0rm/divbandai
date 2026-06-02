#!/usr/bin/env python3
import argparse
import html
import pathlib
import re
import sys

import yaml


ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECTS_VARS = ROOT / "infra" / "ansible" / "vars" / "projects.yml"
PROJECTS_DIR = ROOT / "projects"
HAPROXY_CFG = ROOT / "config" / "haproxy" / "haproxy.cfg"
COMPOSE_FILE = ROOT / "docker-compose.yml"
BASE_DOMAIN = "divbandai.ir"
NEXT_VERSION = "16.2.7"
REACT_VERSION = "19.2.7"


def validate_name(name):
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", name):
        raise ValueError(
            "project name must be a DNS-safe label: lowercase letters, numbers, "
            "hyphens, and no leading/trailing hyphen"
        )
    return name


def load_projects():
    if not PROJECTS_VARS.exists():
        return []
    data = yaml.safe_load(PROJECTS_VARS.read_text()) or {}
    return data.get("divband_projects", [])


def write_projects(projects):
    data = {"divband_projects": projects}
    PROJECTS_VARS.write_text(
        yaml.safe_dump(data, sort_keys=False, explicit_start=True),
    )


def project_domains(name):
    if name == "test":
        return [BASE_DOMAIN, f"www.{BASE_DOMAIN}", f"{name}.{BASE_DOMAIN}"]
    return [f"{name}.{BASE_DOMAIN}"]


def project_port(kind):
    if kind == "nextjs":
        return 3000
    return 80


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
    return f"""server {{
    listen 80;
    server_name {domains};

    root /usr/share/nginx/html;
    index index.html;

    location = /healthz {{
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
    for project in projects:
        name = project["name"]
        port = project.get("port", project_port(project.get("kind", "static")))
        lines.extend(
            [
                f"backend {name}_project",
                "    option httpchk GET /healthz",
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
    HAPROXY_CFG.write_text("\n".join(lines))


def render_compose(projects, arvan=True):
    prefix = "docker.arvancloud.ir/" if arvan else ""
    lines = [
        "services:",
        "  haproxy:",
        f"    image: {prefix}haproxy:2.9-alpine",
        "    container_name: divband-haproxy",
        "    restart: unless-stopped",
        "    ports:",
        '      - "80:80"',
        "    volumes:",
        "      - ./config/haproxy/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro",
        "    depends_on:",
    ]
    for project in projects:
        lines.append(f"      - {project['name']}-web")
    lines.extend(["    networks:", "      - divband", ""])
    for project in projects:
        name = project["name"]
        kind = project.get("kind", "static")
        if kind == "nextjs":
            lines.extend(
                [
                    f"  {name}-web:",
                    f"    image: divband-{name}:local",
                    "    build:",
                    f"      context: ./projects/{name}",
                    "      dockerfile: Dockerfile",
                    f"    container_name: divband-{name}-web",
                    "    restart: unless-stopped",
                    "    environment:",
                    "      NODE_ENV: production",
                    "    networks:",
                    "      - divband",
                    "",
                ]
            )
        else:
            lines.extend(
                [
                    f"  {name}-web:",
                    f"    image: {prefix}nginx:1.27-alpine",
                    f"    container_name: divband-{name}-web",
                    "    restart: unless-stopped",
                    "    volumes:",
                    f"      - ./projects/{name}/html:/usr/share/nginx/html:ro",
                    f"      - ./projects/{name}/nginx.conf:/etc/nginx/conf.d/default.conf:ro",
                    "    networks:",
                    "      - divband",
                    "",
                ]
            )
    lines.extend(["networks:", "  divband:", "    name: divband", ""])
    COMPOSE_FILE.write_text("\n".join(lines))


def create_project_files(project):
    project_dir = PROJECTS_DIR / project["name"]
    kind = project.get("kind", "static")
    if kind == "nextjs":
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

    html_dir = project_dir / "html"
    html_dir.mkdir(parents=True, exist_ok=True)
    (html_dir / "index.html").write_text(index_html(project["name"]))
    (project_dir / "nginx.conf").write_text(nginx_conf(project))


def main():
    parser = argparse.ArgumentParser(description="Create or refresh a Divband project.")
    parser.add_argument("name", help="Project name, e.g. test creates test.divbandai.ir")
    parser.add_argument(
        "--kind",
        choices=("static", "nextjs"),
        default="static",
        help="Container type to create. static uses Nginx, nextjs builds a Next.js container.",
    )
    parser.add_argument(
        "--domain",
        action="append",
        dest="domains",
        help="Extra domain to route to this project. Can be used more than once.",
    )
    parser.add_argument(
        "--non-arvan-images",
        action="store_true",
        help="Render checked-in docker-compose.yml with Docker Hub image names.",
    )
    args = parser.parse_args()

    try:
        name = validate_name(args.name)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    projects = load_projects()
    domains = project_domains(name)
    kind = args.kind
    for domain in args.domains or []:
        if domain not in domains:
            domains.append(domain)

    existing = next((project for project in projects if project["name"] == name), None)
    if existing:
        existing["domains"] = domains
        existing["kind"] = kind
        existing["port"] = project_port(kind)
        project = existing
        action = "refreshed"
    else:
        project = {
            "name": name,
            "kind": kind,
            "port": project_port(kind),
            "domains": domains,
        }
        projects.append(project)
        projects.sort(key=lambda item: item["name"])
        action = "created"

    create_project_files(project)
    write_projects(projects)
    render_haproxy(projects)
    render_compose(projects, arvan=not args.non_arvan_images)

    print(f"{action} project {name}")
    print(f"domains: {', '.join(domains)}")
    print("next: docker compose up -d")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
