# Project API — backlog status

All planned P0–P3 items from the original backlog are implemented as of API **v1.2**.

**Related:** [platform-guide.md](platform-guide.md) · [openapi.yaml](openapi.yaml) · [api-tls.md](api-tls.md)

## Implemented modules

| Module | Purpose |
| --- | --- |
| `scripts/divband_projects.py` | Registry, all project kinds, TLS, env/secrets, drift |
| `scripts/divband_docker.py` | Compose ops, prune volumes, system info |
| `scripts/divband_api_support.py` | Scoped tokens, rate limit, audit, jobs, metrics |
| `scripts/divband_dns.py` | Optional Arvan DNS A-record hooks |
| `scripts/divband_remote.py` | Ansible remote deploy by environment |
| `scripts/divband_backup.py` | Backup/restore tarballs |
| `scripts/divband_scaffold.py` | Node/Python scaffolds |

## API surface (v1.2)

- CRUD + `PUT /v1/projects/{name}/files`
- `POST /v1/projects/{name}/backup` and `/restore`
- `GET /v1/drift`, `/v1/system/docker`, `/v1/system/git`
- `GET /v1/metrics` (Prometheus)
- `GET /v1/jobs/{id}` + `"async": true` on create/deploy/delete
- `POST /v1/remote/deploy` with `infra/ansible/vars/environments.json`
- Webhooks via `"callback_url"` on async jobs
- Scoped tokens via `DIVBAND_API_SCOPED_TOKENS`
- Rate limiting via `DIVBAND_API_RATE_LIMIT`
- Audit log at `.divband/audit.log`

## Project kinds

`static`, `nextjs`, `node`, `python`, `docker`

## Optional integrations (env-driven)

| Variable | Effect |
| --- | --- |
| `DIVBAND_API_SCOPED_TOKENS` | JSON map of bearer tokens to scopes |
| `DIVBAND_API_RATE_LIMIT` | Requests per window (default 60/min) |
| `DIVBAND_DNS_PROVIDER=arvan` | Create/delete A records on project lifecycle |
| `ARVAN_DNS_API_KEY` | Arvan DNS API credential |
| `DIVBAND_DNS_TARGET_IP` | A-record target IP |
| `DIVBAND_BASE_DOMAIN` | Override default base domain |

## Remaining operational notes

- API TLS: terminate at reverse proxy — see [api-tls.md](api-tls.md)
- Git: API mutates tracked files; commit or treat repo as runtime state
- Docker-in-CI tests for image prune require a Docker daemon in CI
