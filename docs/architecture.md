# Architecture

For a full platform overview (API, project kinds, provisioning flows, and
operations), see [platform-guide.md](platform-guide.md).

**Setup from scratch:** [getting-started.md](getting-started.md)

This branch keeps only the infrastructure needed to prove the first public
traffic path.

## Components

| Component | Path | Responsibility |
| --- | --- | --- |
| HAProxy | `config/haproxy/haproxy.cfg` | Public HTTP entrypoint and host-header router. |
| Projects | `projects/<name>` | Generated Nginx static sites or Next.js apps for `name.divbandai.ir`. |
| Docker Compose | `docker-compose.yml` | Defines and connects the containers on one VM. |
| Project generator | `scripts/create-project.py` | Creates project files and refreshes local routing configs. |
| Local Ansible | `infra/ansible/playbooks/local-docker.yml` | Local Docker install/start, config rendering, Compose startup, and smoke tests. |
| Remote Ansible | `infra/ansible/playbooks/remote-docker.yml` | VPS Docker install/start, optional Arvan mirror/registry settings, config rendering, Compose startup, and smoke tests. |
| Validation | `infra/ansible/playbooks/validate-local.yml`, `infra/ansible/playbooks/validate-vps.yml` | Asserts Docker/Compose state and smoke-tests HAProxy routing. |

## Request Flow

```text
Browser
  -> DNS A record for divbandai.ir or test.divbandai.ir
  -> VM public IP port 80
  -> HAProxy frontend public_http
  -> Host header match: divbandai.ir, www.divbandai.ir, or test.divbandai.ir
  -> backend test_project
  -> Nginx service test-web
  -> /usr/share/nginx/html/index.html
```

Requests for any unknown host return HTTP 404 from HAProxy.

## Current Scope

Included:

- One VM deployment model.
- Docker Compose runtime.
- HAProxy HTTP routing.
- Generated static Nginx projects.
- Manual SSH deployment runbook.
- Separate local and remote Ansible playbooks for Docker/HAProxy setup.
- Validation playbooks for current-state checks and guarded remote on/off/on toggle smoke tests.

Not included:

- TLS certificates.
- Kubernetes.
- Terraform.
- GitLab CI (GitHub Actions + GHCR pull deploy on VPS; see [ci-cd.md](ci-cd.md)).
- Multi-tenant project provisioning.
- Application control plane.
- Persistent databases or object storage.

## Future Ansible Shape

The manual runbook maps cleanly into future Ansible tasks:

| Manual step | Future Ansible equivalent |
| --- | --- |
| Install Docker | `docker` role package tasks. |
| Create `/opt/divband` | `file` task. |
| Upload repository files | `synchronize` or `git` task. |
| Render HAProxy config | `template` task. |
| Start Compose stack | `community.docker.docker_compose_v2`. |
| Smoke test host routing | `uri` task with `Host` header. |
