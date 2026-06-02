# Project API — TODO backlog

Tracked gaps for `scripts/project-api.py` and its companion `scripts/create-project.py`. Today the API can **list**, **create/refresh**, and **deploy** projects only. Everything below is not implemented yet.

**Related:** [platform-guide.md](platform-guide.md) · current handler: `scripts/project-api.py`

---

## Priority legend

| Priority | Meaning |
| --- | --- |
| **P0** | Required for safe lifecycle (create ↔ delete) |
| **P1** | Expected for a usable remote/automation API |
| **P2** | Quality, observability, and ops ergonomics |
| **P3** | Future platform features |

---

## P0 — Delete project and full cleanup

### `DELETE /projects/{name}` (or `POST /projects/{name}/delete`)

- [ ] **Reject protected names** — block deletion of reserved projects if any (e.g. `test` if it owns apex domains); return `409` with reason.
- [ ] **Remove from registry** — drop entry from `infra/ansible/vars/projects.yml`.
- [ ] **Regenerate routing** — rerun HAProxy + Compose generation for remaining projects (shared logic with create; extract `render_haproxy` / `render_compose` into a module or `delete-project.py` that both CLI and API call).
- [ ] **Delete project tree** — remove `projects/<name>/` (static: `html/`, `nginx.conf`; nextjs: `app/`, `Dockerfile`, `package.json`, build artifacts if present).
- [ ] **Stop and remove containers** — `docker compose stop {name}-web` and `docker compose rm -f {name}-web` (or `docker compose up -d` after regen so orphan services disappear).
- [ ] **Remove built images** — `docker rmi divband-{name}:local` when `kind: nextjs` (ignore error if image missing).
- [ ] **Optional prune** — query param or body flag `prune_volumes: true` for anonymous volumes tied to the service (default false).
- [ ] **Recreate HAProxy dependency graph** — after delete, `haproxy` `depends_on` must not reference removed `{name}-web`; regen handles this if Compose is rewritten.
- [ ] **Reload running stack** — `docker compose up -d` (and `--remove-orphans`) so HAProxy picks up new config without manual step.
- [ ] **Idempotency** — second delete returns `404` or `204` with clear semantics (document choice).
- [ ] **CLI parity** — `scripts/delete-project.py` + `make project-delete NAME=…` (or `make project-rm`).

### Cleanup edge cases to handle in delete

- [ ] **Last project** — allow zero projects? If yes, Compose should still run HAProxy-only or fail fast with a documented minimum (e.g. require at least one backend).
- [ ] **In-flight deploy** — respect `WRITE_LOCK` so delete does not race create/deploy.
- [ ] **Partial failure** — if filesystem delete succeeds but `docker compose` fails, return `207` or `500` with `steps: [{step, ok, error}]` so operators can retry.
- [ ] **Git dirty state** — API mutates tracked files; document that callers should commit or treat repo as ephemeral runtime state.

---

## P0 — Shared generator refactor (enables delete + PATCH)

- [ ] **Extract library module** — move `load_projects`, `write_projects`, `render_haproxy`, `render_compose`, `validate_name` from `create-project.py` into e.g. `scripts/divband_projects.py` so create/delete/update do not subprocess each other.
- [ ] **Single regen entrypoint** — `regenerate_stack(projects, arvan=True)` called after any CRUD change.
- [ ] **Stop shelling out from API** — `project-api.py` should import functions instead of `subprocess` to `create-project.py` (keeps CLI as thin wrapper).

---

## P1 — Read and update

### `GET /projects/{name}`

- [ ] Return one project record from `projects.yml`.
- [ ] Include runtime hints: expected container name, image name, compose service name, health URL path.

### `PATCH /projects/{name}`

- [ ] Update `kind`, `domains`, or `port` without full rescaffold where possible.
- [ ] **Kind change** (`static` ↔ `nextjs`) — delete old tree shape, scaffold new kind, force rebuild on deploy.
- [ ] **Domain-only change** — regen nginx `server_name` / HAProxy ACLs without touching HTML/Next source unless requested (`refresh_content: false`).

### `PUT /projects/{name}`

- [ ] Optional: replace entire project definition (same as create with fixed name); clarify vs `PATCH` in docs.

---

## P1 — Deploy and stack control

### Improve `POST /deploy`

- [ ] **`down` action** — stop stack or single service: `POST /deploy` with `{"action":"down","project":"foo"}`.
- [ ] **`restart`** — recreate one service or full stack.
- [ ] **`pull`** — `docker compose pull` for non-buildable services.
- [ ] **Return structured status** — parse `docker compose ps --format json` into response.
- [ ] **HAProxy reload only** — when only `haproxy.cfg` changed, restart `haproxy` container without rebuilding all apps.

### `GET /status` or `GET /projects/{name}/status`

- [ ] Container state: running, health check result, image digest.
- [ ] Last deploy command exit code (if tracked).

---

## P1 — Security and exposure

- [ ] **Auth on all mutating routes** — today `GET /projects` is public when token is set; consider requiring auth for list or splitting public `/healthz` only.
- [ ] **TLS termination** — document reverse proxy in front of API; not in-process for this branch unless requested.
- [ ] **Bind defaults** — warn when `DIVBAND_API_HOST=0.0.0.0` without token.
- [ ] **Scoped tokens** — optional per-project or read-only tokens (future).
- [ ] **Rate limiting** — basic request limits for POST/DELETE.
- [ ] **Audit log** — append-only log of who created/deleted/deployed what (file or structured stderr).

---

## P1 — Validation and errors

- [ ] **Consistent error schema** — `{"error": "...", "code": "...", "details": {}}` on all 4xx/5xx.
- [ ] **Validate domain names** — DNS hostname rules before writing `projects.yml`.
- [ ] **Conflict detection** — duplicate domain across two projects → `409`.
- [ ] **Docker precondition checks** — daemon reachable before deploy/delete; clear `503` if not.
- [ ] **Request ID** — `X-Request-Id` in responses for support.

---

## P2 — API surface and documentation

- [ ] **OpenAPI 3 spec** — `docs/openapi.yaml` generated from or driving route definitions.
- [ ] **Version prefix** — `/v1/projects` for forward compatibility.
- [ ] **`GET /` discovery** — list all routes, auth requirements, and example bodies.
- [ ] **Async long operations** — for `nextjs` build + deploy, optional `202` + job id polling (builds can take minutes).
- [ ] **Webhook callback** — optional `callback_url` on create/deploy/delete when async jobs finish.

---

## P2 — Project kinds and content

- [ ] **New `kind` values** — e.g. `node`, `python`, raw `docker` with caller-supplied `Dockerfile` path (validated).
- [ ] **Environment variables** — per-project `env` in API body → Compose `environment:` block.
- [ ] **Secrets** — reference env files or Docker secrets without storing secrets in git (`.env` gitignored, path in API).
- [ ] **Custom health check path** — default `/healthz`, overridable in project metadata for HAProxy template.
- [ ] **Upload / replace content** — `PUT /projects/{name}/files` for static assets without rescaffolding entire project.

---

## P2 — DNS and routing integration

- [ ] **DNS provider hook** — optional create/delete of A records (Arvan Cloud, etc.) when project is created/deleted.
- [ ] **TLS** — integrate certbot or Caddy sidecar; API flag `tls: true` on project (large scope).
- [ ] **Non-default base domain** — today hardcoded `divbandai.ir` in generator; make configurable via env `DIVBAND_BASE_DOMAIN`.

---

## P2 — Remote / multi-host (out of current branch, API-shaped)

- [ ] **Remote deploy target** — API triggers Ansible or SSH on VPS instead of local `docker compose` only.
- [ ] **Inventory per environment** — `staging` vs `production` project namespaces.
- [ ] **Drift detection** — compare `projects.yml` vs running containers vs HAProxy config.

---

## P3 — Platform niceties

- [ ] **List images and disk usage** — `GET /system/docker`.
- [ ] **Backup before delete** — tarball `projects/<name>` to `backups/` with timestamp.
- [ ] **Restore project** — `POST /projects/{name}/restore` from backup.
- [ ] **Metrics** — Prometheus endpoint for project count, deploy latency, failures.
- [ ] **Integration tests** — pytest hitting API on ephemeral port with mock Docker (or testcontainers).

---

## Suggested implementation order

```text
1. Extract divband_projects.py (regen helpers)
2. delete-project.py + DELETE /projects/{name} + cleanup steps
3. PATCH /projects/{name} + GET /projects/{name}
4. Structured errors + domain conflict checks
5. Deploy actions (down/restart/status)
6. OpenAPI + v1 prefix
7. Async deploy + webhooks (if needed)
```

---

## Delete cleanup checklist (reference)

When implementing delete, these artifacts must stay consistent:

| Artifact | Action on delete |
| --- | --- |
| `infra/ansible/vars/projects.yml` | Remove project entry |
| `projects/<name>/` | Delete directory tree |
| `config/haproxy/haproxy.cfg` | Regenerate from remaining projects |
| `docker-compose.yml` | Regenerate; drop `{name}-web` service |
| Container `divband-{name}-web` | Stop + remove |
| Image `divband-{name}:local` | Remove if nextjs |
| Running HAProxy | Restart/reload via `compose up -d` |
| DNS (external) | Document manual or automate later |

---

## Testing TODO (per feature)

- [ ] Delete existing static project; smoke remaining domains still work.
- [ ] Delete nextjs project; image removed; `docker images` clean.
- [ ] Delete while deploy in progress (should block or queue).
- [ ] Delete nonexistent project (404).
- [ ] Delete last project (define expected behavior).
- [ ] Auth: DELETE without token returns 401 when `DIVBAND_API_TOKEN` set.
