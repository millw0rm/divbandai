# Architecture

This branch keeps only the infrastructure needed to prove the first public
traffic path.

## Components

| Component | Path | Responsibility |
| --- | --- | --- |
| HAProxy | `config/haproxy/haproxy.cfg` | Public HTTP entrypoint and host-header router. |
| Test project | `projects/test` | Static Nginx site for `test.divband.com`. |
| Docker Compose | `docker-compose.yml` | Defines and connects the containers on one VM. |

## Request Flow

```text
Browser
  -> DNS A record for test.divband.com
  -> VM public IP port 80
  -> HAProxy frontend public_http
  -> Host header match: test.divband.com
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
- Static Nginx project.
- Manual SSH deployment runbook.

Not included:

- TLS certificates.
- Kubernetes.
- Ansible.
- Terraform.
- GitLab CI or runners.
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
