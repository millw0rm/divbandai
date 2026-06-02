# divband

This branch is a deliberately small starting point for Divband infrastructure.

The current deployable system is:

- Docker Compose on one VM.
- HAProxy as the public HTTP entrypoint.
- A single internal Nginx project named `test`.
- Host routing for `test.divband.com`.
- Container images pulled through `docker.arvancloud.ir`.

There is no Kubernetes, Terraform, GitLab CI, runner automation, or app control
plane in this branch. The first Ansible layer is deliberately limited to the
manual VPS event: Arvan mirror/registry toggles, Docker package installation,
Compose rendering, and smoke tests.

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
│   ├── architecture.md
│   └── manual-ssh-deployment.md
└── infra/
    └── ansible/
        ├── README.md
        └── playbooks/
            └── vps-docker.yml
```

## Local Run

Start the stack:

```bash
docker compose up -d
```

Test HAProxy routing:

```bash
curl -H "Host: test.divband.com" http://127.0.0.1/
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

Create an `A` record for `test.divband.com` pointing at the VM public IP.

For local-only testing, add this to `/etc/hosts`:

```text
127.0.0.1 test.divband.com
```

Then open `http://test.divband.com/`.

## VM Deployment

Follow [docs/manual-ssh-deployment.md](docs/manual-ssh-deployment.md). The steps
are intentionally explicit and operator-friendly so they can later be converted
into Ansible tasks.

The first reversible Ansible version of the VPS flow lives in
[infra/ansible](infra/ansible/README.md). It can apply or revert the Arvan
mirror/registry configuration with `divband_arvan_enabled=true|false`.
