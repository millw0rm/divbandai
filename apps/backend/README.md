# divband backend

The backend API is responsible for user authentication and project lifecycle orchestration.

Initial modules:

- `src/backend-service.ts` provides a dependency-light request handler for the initial API surface.
- `src/server.ts` adapts Node HTTP requests into `BackendService.handle` calls.
- `src/config.ts` centralizes runtime environment configuration.
- `src/runtime-store.ts` wires the in-memory store to the MVP SQLite snapshot adapter.
- `src/project-lifecycle.ts` defines project states and orchestration steps.
- `src/services/gitlab.ts` contains the GitLab repository integration boundary.
- `src/services/kubernetes.ts` contains the Kubernetes namespace integration boundary.
- `src/services/dns-verification.ts` creates and verifies custom-domain DNS challenges.
- `src/services/certificate-status.ts` tracks custom-domain certificate state.
- `src/services/deployment-status.ts` tracks build/deploy state and logs.
- `src/services/audit-log.ts` records user and project audit events.

The OpenAPI contract is maintained in `openapi.yaml`.

## Local startup

The MVP runtime uses Node's built-in HTTP server, runs TypeScript with Node's built-in type transform, and persists store snapshots to SQLite. The SQL schema in `migrations/001_initial_schema.sql` documents the relational tables that the next storage adapter can hydrate directly.

### Required environment variables

| Variable | Example | Description |
| --- | --- | --- |
| `API_BASE_URL` | `http://localhost:3000` | Absolute URL used to parse incoming request paths and print startup status. |
| `PUBLIC_SITE_DOMAIN` | `localhost.test` | Base domain for public hosted sites. |
| `UPLOAD_DOMAIN` | `uploads.localhost.test` | Domain for upload URLs; defaults to `PUBLIC_SITE_DOMAIN` if omitted. |
| `DATABASE_URL` | `sqlite://./data/divband-backend.sqlite` | SQLite file for the MVP snapshot adapter; defaults to this value. |
| `GITLAB_URL` | `https://gitlab.com` | GitLab instance base URL used by the GitLab service boundary. |
| `KUBERNETES_CONFIG_MODE` | `disabled` | One of `disabled`, `in_cluster`, or `kubeconfig`. |
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

Use Node 24+ so `node:sqlite` and `--experimental-transform-types` are available.


```sh
cd apps/backend
API_BASE_URL=http://localhost:3000 \
PUBLIC_SITE_DOMAIN=localhost.test \
UPLOAD_DOMAIN=uploads.localhost.test \
DATABASE_URL=sqlite://./data/divband-backend.sqlite \
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

Copy the returned `session.token` into `TOKEN`, then create a project:

```sh
TOKEN='session_token_from_register_response'
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
