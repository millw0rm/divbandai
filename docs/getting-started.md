# Getting Started

This guide walks through **local development setup** and **VPS deployment** from
scratch. For architecture details, API reference, and operational deep dives, see
[platform-guide.md](platform-guide.md).

---

## What you are setting up

Divband runs a single-host stack:

- **HAProxy** on port 80 routes by `Host` header
- One Docker service per project (`{name}-web`)
- Project configs live in git (`projects/`, `docker-compose.yml`, `config/haproxy/`)

You create projects with the CLI or HTTP API; the generator updates routing and
Compose for you.

---

## Prerequisites

| Requirement | Local dev | VPS deploy |
| --- | --- | --- |
| Docker Engine + Compose v2 | Yes | Yes (or install via Ansible) |
| Python 3 | Yes (scripts and tests) | Optional on VM |
| Git | Yes | Yes |
| SSH access to VM | No | Yes |
| DNS A records → VM IP | Optional locally | Yes for public traffic |

Check Docker:

```bash
docker --version
docker compose version
docker info
```

If `docker info` fails, install Docker or add your user to the `docker` group,
then log out and back in.

Optional for Ansible on your laptop:

```bash
# repo ships a venv path used by the Makefile
test -x .venv-ansible/bin/ansible-playbook && .venv-ansible/bin/ansible-playbook --version
```

---

## 1. Get the repository

```bash
git clone <repository-url> divbandai
cd divbandai
```

List available Make targets:

```bash
make help
```

---

## 2. Local setup (developer machine)

### Step 2a — Create a project

**Static site** (Nginx + HTML):

```bash
make project NAME=myapp
```

**Next.js app**:

```bash
make project NAME=myapp2 KIND=nextjs
```

Other supported kinds: `node`, `python`, `docker`. See
[platform-guide.md](platform-guide.md#project-types-kind).

Each project gets a default domain: `myapp.divbandai.ir`. The special name
`test` also receives `divbandai.ir` and `www.divbandai.ir`.

Generated/updated files include:

- `projects/<name>/`
- `infra/ansible/vars/projects.yml`
- `config/haproxy/haproxy.cfg`
- `docker-compose.yml`

### Step 2b — Start the stack

```bash
make up
```

For Next.js or changed Dockerfiles, build on first run:

```bash
docker compose up -d --build
```

Check containers:

```bash
make ps
```

### Step 2c — Local DNS (optional but convenient)

Add hostnames to `/etc/hosts` so browsers resolve them without public DNS:

```text
127.0.0.1 divbandai.ir www.divbandai.ir test.divbandai.ir myapp.divbandai.ir myapp2.divbandai.ir
```

### Step 2d — Verify routing

Smoke-test every domain in `projects.yml`:

```bash
make smoke
```

You should see `ok <domain>` for each hostname. The smoke script bypasses HTTP
proxies (`curl --noproxy '*'`), so it works even when shell proxy variables are
set.

Manual check:

```bash
curl -H "Host: myapp.divbandai.ir" http://127.0.0.1/
```

Expected body contains: `Welcome to myapp`.

### Step 2e — Run the full test suite

```bash
make test-all
```

This runs, in order:

1. `make test-api` — 74+ Python unit tests
2. `make smoke` — HTTP routing checks
3. `make ansible-local-validate` — Docker/Compose/Ansible smoke validation

Unit tests alone:

```bash
make test-api
```

### Step 2f — (Optional) Project API

Start the local control-plane HTTP server:

```bash
export DIVBAND_API_TOKEN=your-secret   # strongly recommended
make api
```

Health check:

```bash
curl http://127.0.0.1:8080/healthz
```

Create a project via HTTP:

```bash
curl -s -X POST http://127.0.0.1:8080/v1/projects \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${DIVBAND_API_TOKEN}" \
  -d '{"name":"demo","kind":"static","deploy":true}'
```

OpenAPI spec: [openapi.yaml](openapi.yaml).

### Step 2g — (Optional) Ansible local deploy

If Docker is already installed and your user is in the `docker` group, validation
works without sudo:

```bash
make ansible-local-validate
```

To let Ansible install Docker packages via apt (needs root once), install the
passwordless-sudo helper **once**:

```bash
make setup-ansible-sudo
```

Then deploy the full local stack with Ansible:

```bash
make ansible-local
```

Skip Docker installation when it is already present:

```bash
.venv-ansible/bin/ansible-playbook infra/ansible/playbooks/local-docker.yml \
  -e divband_install_docker=false
```

### Step 2h — Stop the stack

```bash
make down
```

---

## 3. VPS / production setup

Use this when traffic should reach a public VM on port 80.

### Step 3a — DNS

Create **A records** for every hostname listed in
`infra/ansible/vars/projects.yml`, pointing at the VM public IP.

Example for the default `test` + `test2` projects:

| Hostname | Points to |
| --- | --- |
| `divbandai.ir` | VM public IP |
| `www.divbandai.ir` | VM public IP |
| `test.divbandai.ir` | VM public IP |
| `test2.divbandai.ir` | VM public IP |

### Step 3b — Inventory

```bash
cp infra/ansible/inventory.example.yml infra/ansible/inventory.yml
```

Edit `infra/ansible/inventory.yml`:

```yaml
all:
  hosts:
    divband-vps:
      ansible_host: <vm-public-ip>
      ansible_user: ubuntu
```

`inventory.yml` is typically gitignored; keep real host details there.

### Step 3c — Deploy with Ansible

From your laptop (repo checkout):

```bash
make ansible-remote INVENTORY=infra/ansible/inventory.yml
```

On Iranian VPSes that cannot reach global Ubuntu/Docker endpoints, this applies
Arvan mirror and registry settings (`divband_arvan_enabled=true` by default in
the Makefile remote target).

Revert to normal Docker Hub image names:

```bash
make ansible-remote-revert INVENTORY=infra/ansible/inventory.yml
```

More detail: [infra/ansible/README.md](../infra/ansible/README.md).

### Step 3d — Validate the VPS

Arvan mode:

```bash
make ansible-remote-validate INVENTORY=infra/ansible/inventory.yml
```

Non-Arvan mode:

```bash
make ansible-remote-validate-revert INVENTORY=infra/ansible/inventory.yml
```

### Step 3e — Manual alternative

If you prefer SSH and explicit commands instead of Ansible, follow
[manual-ssh-deployment.md](manual-ssh-deployment.md).

---

## 4. Day-2 operations

### Add a new public site

1. `make project NAME=<label> KIND=static|nextjs` (or `POST /v1/projects`)
2. Commit generated files if git is your source of truth
3. Add DNS A record for `<label>.divbandai.ir`
4. `make up` or `docker compose up -d --build` on the host
5. `make smoke`
6. Test from outside: `curl http://<label>.divbandai.ir/`

### Remove a project

```bash
make project-delete NAME=<label>
```

Or `DELETE /v1/projects/<label>` via the API. Remove DNS records manually.

### Common Make commands

| Goal | Command |
| --- | --- |
| Create static project | `make project NAME=app` |
| Create Next.js project | `make project NAME=app KIND=nextjs` |
| Delete project | `make project-delete NAME=app` |
| Start stack | `make up` |
| Stop stack | `make down` |
| Routing smoke test | `make smoke` |
| Unit tests | `make test-api` |
| Full local verification | `make test-all` |
| Run API | `make api` |
| Local Ansible deploy | `make ansible-local` |
| Remote Ansible deploy | `make ansible-remote INVENTORY=infra/ansible/inventory.yml` |

---

## 5. Troubleshooting

### `make smoke` fails with proxy / connection errors

Your shell may set `http_proxy` to a local SOCKS proxy. The smoke script already
uses `curl --noproxy '*'`. If another tool fails, unset proxies or add
`127.0.0.1` to `NO_PROXY`.

### `docker info` permission denied

```bash
sudo usermod -aG docker "$USER"
# log out and back in
```

### Ansible asks for a sudo password

For **validation only**, sudo is not required if Docker works for your user.

For **local Docker install** via Ansible, run once:

```bash
make setup-ansible-sudo
```

### Next.js project container not healthy

Rebuild after scaffold changes:

```bash
docker compose up -d --build test2-web
```

### Unknown host returns 404

Expected for hostnames not in `projects.yml`. HAProxy responds with
`Unknown divband host`.

---

## Next steps

- [ci-cd.md](ci-cd.md) — GitHub Actions CI, auto-deploy, and production secrets
- [platform-guide.md](platform-guide.md) — full platform reference
- [architecture.md](architecture.md) — request flow and component map
- [manual-ssh-deployment.md](manual-ssh-deployment.md) — manual VPS runbook
- [infra/ansible/README.md](../infra/ansible/README.md) — Ansible toggles and validation
- [api-todo.md](api-todo.md) — planned API work
