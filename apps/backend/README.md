# divband backend

The backend API is responsible for user authentication and project lifecycle orchestration.

Initial modules:

- `src/backend-service.ts` provides a dependency-light request handler for the initial API surface.
- `src/server.ts` adapts Node HTTP requests into `BackendService.handle` calls.
- `src/config.ts` centralizes runtime environment configuration.
- `src/runtime-store.ts` wires the application to an in-memory store by default, with snapshot persistence adapters available for later durable backends.
- `src/project-lifecycle.ts` defines project states and orchestration steps.
- `src/services/gitlab.ts` contains the GitLab repository integration boundary.
- `src/services/kubernetes.ts` contains the Kubernetes namespace integration boundary.
- `src/services/dns-verification.ts` creates and verifies custom-domain DNS challenges.
- `src/services/certificate-status.ts` tracks custom-domain certificate state.
- `src/services/deployment-status.ts` tracks build/deploy state and logs.
- `src/services/audit-log.ts` records user and project audit events.

The OpenAPI contract is maintained in `openapi.yaml`.

## Local startup

The MVP runtime uses Node's built-in HTTP server, runs TypeScript with Node's built-in type transform, and keeps application state in memory by default. The service layer depends on `BackendStore` and a small `PersistenceAdapter` contract so a later SQL, NoSQL, or snapshot backend can be installed without changing request handlers.

### Required environment variables

| Variable | Example | Description |
| --- | --- | --- |
| `API_BASE_URL` | `http://localhost:3000` | Absolute URL used to parse incoming request paths and print startup status. |
| `PUBLIC_SITE_DOMAIN` | `localhost.test` | Base domain for public hosted sites. |
| `UPLOAD_DOMAIN` | `uploads.localhost.test` | Domain for upload URLs; defaults to `PUBLIC_SITE_DOMAIN` if omitted. |
| `PERSISTENCE_DRIVER` | `memory` | Optional persistence adapter selector: `memory`, `sqlite`, or `postgres`. Defaults to `memory`, unless `DATABASE_URL` implies a SQL adapter. |
| `DATABASE_URL` | `postgresql://...` | Optional durable adapter URL. `postgres://` / `postgresql://` selects PostgreSQL, `sqlite://` / `file:` selects SQLite, and an omitted value keeps the in-memory adapter. |
| `DIVBAND_SEED_DEMO_DATA` | `1` | Optional local/demo seed toggle. Enabled by default outside production; set to `0` to skip demo accounts. |
| `SOURCE_CONTROL_PROVIDER` | `github` | Optional source-control adapter selector: `github` for local GitHub user-token flows or `gitlab` for the legacy GitLab adapter. |
| `GITHUB_API_URL` | `https://api.github.com` | Optional GitHub API base URL for GitHub Enterprise or testing. |
| `GITHUB_TOKEN` / `GITHUB_ACCESS_TOKEN` | `github_pat_...` | Optional platform-level GitHub token. For local user-on-behalf-of flows, prefer `/auth/github-identity` instead. |
| `GITHUB_OAUTH_CLIENT_ID` | `Iv1...` | Optional OAuth app client ID for the dashboard `Connect GitHub` flow. |
| `GITHUB_OAUTH_CLIENT_SECRET` | `...` | Optional OAuth app client secret for exchanging GitHub authorization codes. |
| `GITHUB_OAUTH_CALLBACK_URL` | `http://localhost:3000/api/auth/callback/github` | Optional explicit callback URL; defaults to `${API_BASE_URL}/api/auth/callback/github`. |
| `GITLAB_URL` | `https://gitlab.com` | GitLab instance base URL used by the GitLab service boundary. |
| `KUBERNETES_CONFIG_MODE` / `KUBERNETES_MODE` | `disabled` | One of `disabled`, `in_cluster`, or `kubeconfig`; `KUBERNETES_MODE` is accepted for operator bootstrap hand-offs. |
| `KUBERNETES_APPLY` | `false` | When `true`, the backend runs `kubectl apply` for tenant manifests. Required for automatic project provisioning on k3s/VPS. |
| `KUBERNETES_TEMPLATE_DIR` | `infra/k8s/base` | Directory of `REPLACE_WITH_*` tenant templates. |
| `DIVBAND_AUTO_PROVISION_PROJECTS` | on when apply enabled | Set to `0`/`false` to skip automatic welcome-stack provisioning on `POST /projects`. |
| `KUBERNETES_WELCOME_IMAGE` | `nginx:1.27-alpine` | Container image for the default per-project welcome page. |
| `CERT_MANAGER_CLUSTER_ISSUER` | `letsencrypt-prod` | ClusterIssuer name rendered into tenant ingress/certificate templates. |
| `KUBERNETES_INGRESS_CLASS` | `nginx` | Ingress class name for tenant routes. |
| `EXTERNAL_SECRET_STORE_NAME` | `divband-tenant-secrets` | ClusterSecretStore name for full-stack templates that include `external-secret.yaml`. |
| `OBJECT_STORAGE_PROVIDER` | `auto` | `auto`, `memory`, or `s3`; `auto` selects S3 when access key and secret env vars are present, otherwise the in-memory development adapter. |
| `OBJECT_STORAGE_BUCKET` | `divband-local` | Object storage bucket for publish uploads. |
| `OBJECT_STORAGE_ENDPOINT` | `http://localhost:9000` | Optional S3-compatible endpoint. |
| `OBJECT_STORAGE_REGION` | `us-east-1` | Optional object storage region. |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | `minioadmin` | Optional object storage access key. |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | `minioadmin` | Optional object storage secret key. |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | `true` | Optional boolean for S3-compatible local services. |
| `OBJECT_STORAGE_STAGING_PREFIX` | `staging` | Non-public prefix used for pending publish uploads. |
| `OBJECT_STORAGE_LIVE_PREFIX` | `sites` | Prefix used for immutable live static-site versions. |
| `PORT` | `3000` | Optional HTTP port; defaults to `3000`. |

### Start the server

Use Node 24+ so `--experimental-transform-types` is available.


```sh
cd apps/backend
API_BASE_URL=http://localhost:3000 \
PUBLIC_SITE_DOMAIN=localhost.test \
UPLOAD_DOMAIN=uploads.localhost.test \
PERSISTENCE_DRIVER=memory \
DIVBAND_SEED_DEMO_DATA=1 \
SOURCE_CONTROL_PROVIDER=github \
GITLAB_URL=https://gitlab.com \
KUBERNETES_CONFIG_MODE=disabled \
OBJECT_STORAGE_BUCKET=divband-local \
OBJECT_STORAGE_REGION=us-east-1 \
npm run dev
```

### Happy-path API smoke flow

From another shell, register a user, create a project, and read the project status:

```sh
curl -sS -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"dev@example.com","name":"Dev User","password":"correct-horse"}'
```

Copy the one-time returned top-level `token` into `TOKEN`, then create a project:

```sh
TOKEN='token_from_register_response'
PROJECT_ID=$(curl -sS -X POST http://localhost:3000/projects \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Site","slug":"demo-site"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["project"]["id"])')
```

Read status for the newly created project:

```sh
curl -sS "http://localhost:3000/projects/$PROJECT_ID/status" \
  -H "authorization: Bearer $TOKEN"
```

A healthy response includes `status`, `repositoryUrl`, `namespaceProvisioned`, `platformSubdomainAttached`, `activeDomains`, and `latestDeployment` fields.


## Production adapters

The local default is intentionally ephemeral. Use PostgreSQL and S3-compatible
object storage for durable production runtime state:

```sh
DATABASE_URL=postgresql://divband_backend:change-me@postgres.example.com:5432/divband_backend?sslmode=require
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_BUCKET=divband-sites-prod
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
```

Run `apps/backend/migrations/002_postgres_snapshot_persistence.sql` against the
production database and configure the bucket permissions/CORS described in
[`PRODUCTION.md`](PRODUCTION.md) before starting replicas.

For k3s tenant auto-provision (`KUBERNETES_APPLY`, welcome stack on project create), see [`PRODUCTION.md`](PRODUCTION.md#kubernetes-tenant-auto-provision), [`../../README.md`](../../README.md#project-auto-provision-on-k3s), and [`../../infra/k8s/README.md`](../../infra/k8s/README.md).

## Related documentation

| Topic | Document |
| --- | --- |
| Local dev | [`docs/local-mvp.md`](../../docs/local-mvp.md) |
| Production persistence + K8s | [`PRODUCTION.md`](PRODUCTION.md) |
| OpenAPI | [`openapi.yaml`](openapi.yaml) |
| Architecture | [`docs/architecture.md`](../../docs/architecture.md) |
| Operator runbook | [`docs/operations.md`](../../docs/operations.md) |
