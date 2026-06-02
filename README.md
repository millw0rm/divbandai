# divband

This branch is a deliberately small starting point for Divband infrastructure.

The current deployable system is:

- Docker Compose on one VM.
- HAProxy as the public HTTP entrypoint.
- A single internal Nginx project named `test`.
- Host routing for `divbandai.ir`, `www.divbandai.ir`, and `test.divbandai.ir`.
- Container images pulled through `docker.arvancloud.ir`.

There is no Kubernetes or Terraform in this branch. **GitHub Actions** builds and
pushes to GHCR; the **VPS pulls** images and deploys via webhook. See
[docs/ci-cd.md](docs/ci-cd.md). Provisioning is
handled by a **local Project API** and
`scripts/create-project.py`, which generate Docker Compose services, HAProxy
routes, and project scaffolds (Nginx static or Next.js). Ansible covers VPS
bootstrap: Arvan mirror/registry toggles, Docker install, Compose deploy, and
smoke tests.

**Full documentation:** [docs/getting-started.md](docs/getting-started.md) · [docs/platform-guide.md](docs/platform-guide.md)

## Repository Map

```text
.
├── docker-compose.yml
├── Makefile
├── config/
│   └── haproxy/
│       └── haproxy.cfg
├── projects/
│   └── test/
│       ├── nginx.conf
│       └── html/
│           └── index.html
├── docs/
│   ├── getting-started.md
│   ├── platform-guide.md
│   ├── architecture.md
│   └── manual-ssh-deployment.md
├── scripts/
│   └── create-project.py
└── infra/
    └── ansible/
        ├── README.md
        ├── tasks/
        ├── vars/
        └── playbooks/
            ├── local-docker.yml
            ├── remote-docker.yml
            ├── validate-local.yml
            └── validate-vps.yml
```

## Local Run

Create or refresh a static project:

```bash
make project NAME=test
```

Create a Next.js project instead of a static Nginx project:

```bash
make project NAME=test2 KIND=nextjs
```

For `NAME=test`, the generator creates:

- `projects/test/html/index.html`
- `projects/test/nginx.conf`
- routing for `test.divbandai.ir`
- checked-in `docker-compose.yml` and `config/haproxy/haproxy.cfg`

The generator also updates `infra/ansible/vars/projects.yml`, so local and
remote Ansible deployments render the same project list.

## Project API

Run the local administrative API:

```bash
make api
```

Create a project through HTTP:

```bash
curl -X POST http://127.0.0.1:8080/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"test2","kind":"nextjs"}'
```

Set `DIVBAND_API_TOKEN` to require `Authorization: Bearer <token>` for
`GET /projects`, `POST /projects`, and `POST /deploy`.

Planned API work (delete, cleanup, updates): [docs/api-todo.md](docs/api-todo.md).

Start the stack:

```bash
docker compose up -d
```

Test HAProxy routing:

```bash
curl -H "Host: divbandai.ir" http://127.0.0.1/
curl -H "Host: test.divbandai.ir" http://127.0.0.1/
```

Expected response:

```text
Welcome to test
```

Stop the stack:

```bash
docker compose down
```

## DNS

Create `A` records for `divbandai.ir`, `www.divbandai.ir`, and
`test.divbandai.ir` pointing at the VM public IP.

For local-only testing, add this to `/etc/hosts`:

```text
127.0.0.1 divbandai.ir www.divbandai.ir test.divbandai.ir
```

Then open `http://divbandai.ir/` or `http://test.divbandai.ir/`.

## CI/CD

Full setup: [docs/ci-cd.md](docs/ci-cd.md). One command on your machine:

```bash
make setup-github-actions   # uses gh CLI; see .github/setup.env.example
```

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | Push and PRs to `main` | Tests, GHCR publish, smoke; **webhook deploy** on push to `main` |
| `deploy.yml` | Manual | Trigger VPS pull deploy for a commit |

On the VPS once: `sudo bash scripts/install-vps-deploy.sh`.  
On GitHub **`production`** secrets: `DIVBAND_DEPLOY_WEBHOOK_URL`, `DIVBAND_DEPLOY_WEBHOOK_SECRET`.

## VM Deployment

Follow [docs/manual-ssh-deployment.md](docs/manual-ssh-deployment.md). The steps
are intentionally explicit and operator-friendly so they can later be converted
into Ansible tasks.

The Ansible setup lives in [infra/ansible](infra/ansible/README.md). It has
separate local and remote entrypoints, both covering Docker installation,
HAProxy/Nginx config rendering, Compose startup, and smoke tests. The remote
entrypoint can also apply or revert the Arvan mirror/registry configuration
with `divband_arvan_enabled=true|false`.
