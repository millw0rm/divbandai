# CI/CD with GitHub Actions

Divband uses GitHub Actions for continuous integration and production deployment
to the VPS. There is no separate container registry: runtime images are pulled on
the host (Arvan or Docker Hub), and Next.js apps build as `divband-<name>:local`.

## Workflows

| Workflow | File | When it runs |
| --- | --- | --- |
| CI | `.github/workflows/ci.yml` | Every push and pull request to `main` / `master` |
| Deploy | `.github/workflows/deploy.yml` | Manual **Run workflow**, or automatically after CI on `main` |

### CI pipeline

1. **unit-tests** — `make test-api` (Python 3.12, PyYAML).
2. **integration** — `docker compose up`, routing smoke (`make smoke`), `validate-local.yml`.
3. **deploy-production** (push to `main` only) — Ansible deploy to the VPS after integration succeeds.

CI uses Docker Hub image names (no `docker.arvancloud.ir/` prefix) so GitHub-hosted
runners can pull images reliably.

### Deploy pipeline

Deploy runs the same Ansible entrypoints as local production:

```bash
make ansible-remote INVENTORY=infra/ansible/inventory.yml
make ansible-remote-validate INVENTORY=infra/ansible/inventory.yml
```

Equivalent playbooks: `remote-docker.yml`, then `validate-vps.yml`.

## One-time GitHub setup (gh CLI on your PC)

Prerequisites: [GitHub CLI](https://cli.github.com/) installed and logged in (`gh auth login`),
admin access to the repository, and workflows pushed to GitHub.

### Automated setup script

```bash
# Interactive — prompts for VPS host, key generation, optional ssh-copy-id
make setup-github-actions

# Or non-interactive with an env file:
cp .github/setup.env.example .github/setup.env
# edit .github/setup.env, then:
scripts/setup-github-actions.sh -y --env-file .github/setup.env --generate-key --copy-ssh-id
```

The script uses `gh` to:

1. Create the **`production`** deployment environment.
2. Set environment secrets: `DIVBAND_SSH_PRIVATE_KEY`, `DIVBAND_VPS_HOST`, `DIVBAND_VPS_USER`.
3. Set repository variable `DIVBAND_ARVAN_ENABLED` (`true` / `false`).
4. Optionally generate `~/.ssh/divband_github_actions` and run `ssh-copy-id`.
5. Optionally enable branch protection (`--require-ci`) or trigger deploy (`--run-deploy`).

Useful flags: `--help`, `--dry-run`, `--host`, `--key-file`, `--arvan false`, `--require-ci`.

### Manual setup (GitHub UI)

1. Push this repository to GitHub (workflows must exist on the default branch).
2. Create environment **`production`** (Settings → Environments).
3. Add **environment secrets** on `production`:

| Secret | Required | Description |
| --- | --- | --- |
| `DIVBAND_SSH_PRIVATE_KEY` | Yes | Full private key (PEM) for the deploy user |
| `DIVBAND_VPS_HOST` | Yes | VPS IP or hostname |
| `DIVBAND_VPS_USER` | No | SSH user; defaults to `ubuntu` |

4. Optional **repository variable** `DIVBAND_ARVAN_ENABLED` — set to `false` to skip Arvan prefixes.

5. Recommended: **branch protection** on `main` — require CI jobs to pass before merge
   (or re-run the script with `--require-ci` after the first green workflow).

## One-time VPS setup

The deploy user must accept the GitHub Actions SSH key and allow Ansible `become`:

```bash
# On the VPS, as root or with sudo — replace DEPLOY_USER if not ubuntu
export DEPLOY_USER=ubuntu
sudo install -d -m 0755 /etc/sudoers.d
sudo sed "s/^ubuntu /${DEPLOY_USER} /" /opt/divband/infra/ansible/sudoers.d/99-divband-ansible \
  | sudo tee /etc/sudoers.d/99-divband-ansible
sudo chmod 440 /etc/sudoers.d/99-divband-ansible
sudo visudo -cf /etc/sudoers.d/99-divband-ansible
```

After the first deploy, files live under `/opt/divband`. For the **first** bootstrap,
use [manual-ssh-deployment.md](manual-ssh-deployment.md) or run **Deploy** manually
with `arvan_enabled=true` if the VM cannot reach public Docker Hub or Ubuntu mirrors.

Authorize the CI deploy public key:

```bash
# On your laptop — add the public half to the VPS
ssh-copy-id -i ~/.ssh/divband_github_actions.pub "${DEPLOY_USER}@${DIVBAND_VPS_HOST}"
```

Store only the **private** key in `DIVBAND_SSH_PRIVATE_KEY`.

## Manual deploy

**Actions → Deploy → Run workflow**

- **arvan_enabled** — match your VPS network (usually `true` for Arvan-restricted hosts).
- **validate_after_deploy** — run `validate-vps.yml` after deploy (recommended).

## Automatic deploy

Every successful push to **`main`** runs CI, then **deploy-production** if integration passed.
Disable auto-deploy by removing the `deploy-production` job from `ci.yml` or restricting
the `production` environment with approval gates.

## Local parity

Install the same tools CI uses:

```bash
python3 -m venv .venv-ci
.venv-ci/bin/pip install -r requirements-ci.txt
make test-api
```

Run deploy logic locally (secrets in the environment):

```bash
export DIVBAND_SSH_PRIVATE_KEY="$(cat ~/.ssh/id_ed25519)"
export DIVBAND_VPS_HOST=94.101.178.146
export DIVBAND_ARVAN_ENABLED=true
bash scripts/github-actions-deploy.sh
```

## What CI/CD does not cover

- TLS certificates and DNS (still operator / DNS provider).
- GitHub Container Registry (images are not published to `ghcr.io`).
- Multi-environment staging hosts (only `production` is wired today).

See also [getting-started.md](getting-started.md) and [infra/ansible/README.md](../infra/ansible/README.md).
