# Divband VPS Ansible

This directory captures the manual VPS setup as reversible Ansible automation.
It is intentionally small and only covers the current Docker + HAProxy test
stack.

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

This playbook exists so that fix is no longer an undocumented one-off VM
mutation. It makes the change repeatable, reviewable, and reversible:

- The Arvan behavior is behind `divband_arvan_enabled=true`.
- Revert behavior is behind `divband_arvan_enabled=false`.
- Original `/etc/hosts` and Ubuntu source files are backed up under
  `/etc/divband/backups`.
- Validation playbooks assert that the selected mode is actually applied before
  we trust the VPS state.

This is still not a broad platform automation layer. It is a narrow record of
the Docker/HAProxy VPS bootstrap event and the network workaround that made it
deployable.

## What It Manages

- Optional Arvan host pins for:
  - `mirror.arvancloud.ir`
  - `docker.arvancloud.ir`
- Optional Arvan Ubuntu apt source file.
- Docker installation from Ubuntu packages.
- `/opt/divband` project files.
- Docker Compose stack startup.
- Smoke checks for `test.divband.com` and unknown host routing.

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

## Apply Arvan Setup and Deploy

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/vps-docker.yml \
  -e divband_arvan_enabled=true
```

## Revert Arvan Setup

This keeps Docker and the project stack installed, but removes the Arvan mirror
configuration and renders Compose with normal image names.

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/vps-docker.yml \
  -e divband_arvan_enabled=false
```

## Validate Current Mode

Validate that Arvan mode is actually applied and traffic still works:

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/validate-vps.yml \
  -e divband_arvan_enabled=true
```

Validate that non-Arvan mode is actually applied and traffic still works:

```bash
ansible-playbook \
  -i infra/ansible/inventory.yml \
  infra/ansible/playbooks/validate-vps.yml \
  -e divband_arvan_enabled=false
```

The validator checks:

- Arvan host pins are present or absent as expected.
- The Ubuntu apt source points to Arvan or does not, based on the expected mode.
- Compose uses Arvan-prefixed or normal image names.
- Docker is active.
- Both Compose containers are present.
- `test.divband.com` returns the welcome page.
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
  infra/ansible/playbooks/vps-docker.yml \
  -e divband_arvan_enabled=true \
  -e divband_install_docker=false \
  -e divband_deploy_stack=true
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `divband_arvan_enabled` | `true` | Toggle Arvan mirror and registry behavior. |
| `divband_install_docker` | `true` | Install Docker packages with apt. |
| `divband_deploy_stack` | `true` | Upload files and run `docker compose up -d`. |
| `divband_app_dir` | `/opt/divband` | Remote project directory. |
| `divband_domain` | `test.divband.com` | Host header routed to the test project. |
