# Divband Ansible

Bootstrap Docker and the Divband HAProxy + Compose stack on localhost or a remote VPS. This is not a full platform layer — it installs packages, renders project configs, starts the stack, and runs smoke checks.

## Playbooks

| Environment | Playbook | Purpose |
| --- | --- | --- |
| Local | `playbooks/local-docker.yml` | Docker + stack in the repo checkout; smoke on localhost |
| Remote | `playbooks/remote-docker.yml` | Docker + stack under `/opt/divband` on the VPS |
| Validate (local) | `playbooks/validate-local.yml` | Assert Docker, Compose, HAProxy, and routing |
| Validate (remote) | `playbooks/validate-vps.yml` | Same checks on the VPS (no Arvan registry prefixes in Compose) |
| Compatibility | `playbooks/vps-docker.yml` | Wrapper for `remote-docker.yml` |

Shared pieces:

- `vars/common.yml` — hostnames, package names, defaults
- `vars/projects.yml` — routed project list (from `make project`)
- `tasks/docker-debian.yml` — Docker via standard Ubuntu apt
- `tasks/project-stack.yml` — Compose, HAProxy, Nginx, static assets
- `tasks/smoke.yml` — Host-header routing checks

## Quick start

Local (from repo root):

```bash
make setup-ansible-sudo   # once, for passwordless apt/docker tasks
make ansible-local
make ansible-local-validate
```

Remote (copy `inventory.example.yml` to `inventory.yml`, set `ansible_host`):

```bash
make ansible-remote INVENTORY=infra/ansible/inventory.yml
make ansible-remote-validate INVENTORY=infra/ansible/inventory.yml
```

Production releases normally use **pull deploy** (CI → GHCR → webhook → `scripts/vps-deploy.sh`), not Ansible over SSH. See [docs/ci-cd.md](../../docs/ci-cd.md).

## Project generator

```bash
make project NAME=test
make project NAME=app KIND=nextjs
```

Writes project files, `infra/ansible/vars/projects.yml`, `docker-compose.yml`, and `config/haproxy/haproxy.cfg`. Images use Docker Hub names (`nginx:…`, `haproxy:…`).

Optional DNS for new domains is via the Project API (`"dns": true`) and `DIVBAND_DNS_PROVIDER=arvan` — that is separate from Ansible.

## Inventory

`inventory.yml` is gitignored. Start from `inventory.example.yml`:

```yaml
---
all:
  hosts:
    divband-vps:
      ansible_host: YOUR_VPS_IP
      ansible_user: ubuntu
```

## Extra variables (optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `divband_use_ghcr` | `false` | Pull project images from GHCR instead of building on the host |
| `divband_ghcr_owner` | — | GHCR namespace |
| `divband_ghcr_image_tag` | — | Image tag (e.g. commit SHA) |
| `divband_ghcr_token` | — | PAT for private GHCR pulls |

Example with GHCR on remote:

```bash
ansible-playbook -i inventory.yml playbooks/remote-docker.yml \
  -e divband_use_ghcr=true \
  -e divband_ghcr_owner=millw0rm \
  -e divband_ghcr_image_tag=abc123
```
