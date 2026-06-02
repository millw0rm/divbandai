# Divband VPS Ansible

This directory captures the manual VPS setup as reversible Ansible automation.
It is intentionally small and only covers the current Docker + HAProxy test
stack.

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
