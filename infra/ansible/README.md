# Divband Ansible

This directory separates local and remote environment setup while sharing the
same Docker + HAProxy project configuration.

## Environment Entry Points

| Environment | Playbook | Purpose |
| --- | --- | --- |
| Local | `playbooks/local-docker.yml` | Install/start Docker if requested, render project configs into the checkout, run the Compose stack, and smoke-test localhost routing. |
| Remote | `playbooks/remote-docker.yml` | Prepare the VPS package/registry path, install/start Docker, render `/opt/divband`, run the Compose stack, and smoke-test remote localhost routing. |
| Remote compatibility | `playbooks/vps-docker.yml` | Backward-compatible wrapper for `remote-docker.yml`. |

The shared pieces live under:

- `vars/common.yml` for hostnames, package names, and defaults.
- `vars/projects.yml` for the routed project list.
- `tasks/docker-debian.yml` for Docker package installation and service state.
- `tasks/project-stack.yml` for Docker Compose, HAProxy, Nginx, and static page deployment.
- `tasks/smoke.yml` for host-header routing checks.
- `tasks/arvan.yml` for the remote-only Arvan mirror/registry workaround.

## Project Generator

Create or refresh a static project before deploying:

```bash
make project NAME=test
```

Use `KIND=nextjs` when the domain should route to a buildable Next.js
container instead of an Nginx static site:

```bash
make project NAME=test2 KIND=nextjs
```

This writes:

- `projects/<name>/html/index.html`
- `projects/<name>/nginx.conf`
- `infra/ansible/vars/projects.yml`
- checked-in local `docker-compose.yml`
- checked-in local `config/haproxy/haproxy.cfg`

By default, `NAME=app` routes `app.divbandai.ir`. The existing `test` project
also keeps the apex and `www` domains routed to the same welcome page.

The same workflow is available over a local administrative HTTP API:

```bash
make api
curl -X POST http://127.0.0.1:8080/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"app","kind":"static"}'
```

Set `DIVBAND_API_TOKEN` before running `make api` to require bearer-token
authentication on project and deploy endpoints.

## Why This Exists

The first VPS setup for `94.101.178.146` exposed an infrastructure constraint:
the VM accepted inbound SSH, but default outbound package and registry paths were
not usable.

Observed during setup:

- `apt-get update` against `archive.ubuntu.com` and `security.ubuntu.com`
  failed because the VM could not resolve those hostnames.
- Changing the VM resolver to public DNS did not fix the issue.
- Raw outbound checks to public internet targets such as `1.1.1.1` and
  `8.8.8.8` failed.
- Direct connectivity to Arvan CDN IPs worked.
- `docker.arvancloud.ir` responded correctly when pinned to reachable Arvan IPs.
- `https://mirror.arvancloud.ir/ubuntu/` was reachable and could serve Ubuntu
  package indexes.

The manual fix was:

1. Pin Arvan hostnames in `/etc/hosts`.
2. Move Ubuntu apt sources to the Arvan mirror.
3. Install Docker from Ubuntu packages available through that mirror.
4. Pull runtime images through `docker.arvancloud.ir`.

The remote playbook exists so that fix is no longer an undocumented one-off VM
mutation. It makes the change repeatable, reviewable, and reversible:

- The Arvan behavior is behind `divband_arvan_enabled=true`.
- Revert behavior is behind `divband_arvan_enabled=false`.
- Original `/etc/hosts` and Ubuntu source files are backed up under
  `/etc/divband/backups`.
- Validation playbooks assert that the selected mode is actually applied before
  we trust the VPS state.

This is still not a broad platform automation layer. It is a narrow Docker and
HAProxy bootstrap layer with separate local and remote entrypoints.

## What It Manages

- Optional Arvan host pins for:
  - `mirror.arvancloud.ir`
  - `docker.arvancloud.ir`
- Optional Arvan Ubuntu apt source file.
- Docker installation from Ubuntu packages.
- `/opt/divband` project files.
- Docker Compose stack startup.
- Smoke checks for the configured Divband public hosts and unknown host routing.

## Toggle

Set `divband_arvan_enabled`:

- `true` applies Arvan apt mirror settings and uses `docker.arvancloud.ir`
  images in Compose.
- `false` removes Arvan host pins, restores the original
  `/etc/apt/sources.list.d/ubuntu.sources` backup when available, and uses
  normal Docker Hub image names in Compose.

## Inventory

Copy the example inventory and edit host/user values:

```bash
cp infra/ansible/inventory.example.yml infra/ansible/inventory.yml
```

The current VPS can be represented as:

```yaml
all:
  hosts:
    divband-vps:
      ansible_host: 94.101.178.146
      ansible_user: ubuntu
```

`infra/ansible/inventory.yml` is gitignored by convention; keep real VM details
there when they become sensitive.

## Local Setup and Deploy

This targets the machine running Ansible. It renders the same HAProxy and Nginx
configs into the repository checkout and starts the local Compose stack.

```bash
ansible-playbook infra/ansible/playbooks/local-docker.yml
```

Validate the local stack:

```bash
ansible-playbook infra/ansible/playbooks/validate-local.yml
```

The Makefile aliases are:

```bash
make ansible-local
make ansible-local-validate
```

## Remote Arvan Setup and Deploy

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/remote-docker.yml \
  -e divband_arvan_enabled=true
```

The Makefile alias is:

```bash
make ansible-remote INVENTORY=infra/ansible/inventory.yml
```

## Revert Arvan Setup

This keeps Docker and the project stack installed, but removes the Arvan mirror
configuration and renders Compose with normal image names.

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/remote-docker.yml \
  -e divband_arvan_enabled=false
```

The Makefile alias is:

```bash
make ansible-remote-revert INVENTORY=infra/ansible/inventory.yml
```

## Validate Current Mode

Validate that Arvan mode is actually applied and traffic still works:

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/validate-vps.yml \
  -e divband_arvan_enabled=true
```

Or:

```bash
make ansible-remote-validate INVENTORY=infra/ansible/inventory.yml
```

Validate that non-Arvan mode is actually applied and traffic still works:

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/validate-vps.yml \
  -e divband_arvan_enabled=false
```

Or:

```bash
make ansible-remote-validate-revert INVENTORY=infra/ansible/inventory.yml
```

The validator checks:

- Arvan host pins are present or absent as expected.
- The Ubuntu apt source points to Arvan or does not, based on the expected mode.
- Compose uses Arvan-prefixed or normal image names.
- Docker is active.
- Both Compose containers are present.
- `divbandai.ir`, `www.divbandai.ir`, and `test.divbandai.ir` return the welcome page.
- Unknown host routing returns HAProxy 404.

## Toggle Cycle Smoke Test

The full toggle test changes the live VPS through:

```text
Arvan on -> validate -> Arvan off -> validate -> Arvan on -> validate
```

It is guarded because the non-Arvan phase may break image pulls or apt on VMs
that cannot reach global endpoints.

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/toggle-smoke.yml \
  -e divband_confirm_toggle_cycle=true
```

Running the playbook without `divband_confirm_toggle_cycle=true` fails before
touching remote hosts.

## Useful Overrides

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/remote-docker.yml \
  -e divband_arvan_enabled=true \
  -e divband_install_docker=false \
  -e divband_deploy_stack=true
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `divband_arvan_enabled` | `true` | Toggle Arvan mirror and registry behavior. |
| `divband_install_docker` | `true` | Install Docker packages with apt. |
| `divband_deploy_stack` | `true` | Upload files and run `docker compose up -d`. |
| `divband_app_dir` | `/opt/divband` remote, repo root local | Project directory. |
| `divband_domains` | `divbandai.ir`, `www.divbandai.ir`, `test.divbandai.ir` | Host headers routed to the test project. |
