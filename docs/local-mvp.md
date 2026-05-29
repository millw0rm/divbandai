# Local MVP

This guide describes the smallest useful local divband setup: one API process, one static dashboard process, SQLite snapshot persistence, and mocked platform integrations. It is intended for repeatable product and API smoke testing before production GitLab, Kubernetes, DNS, certificate, storage, email, and billing adapters are connected.

## What runs locally

| Area | Local MVP behavior | Real or mocked locally? |
| --- | --- | --- |
| Backend API | Node HTTP server from `apps/backend` on `http://localhost:3000`. | Real local process. |
| Frontend dashboard | Static dashboard bundle from `apps/frontend` on `http://localhost:5173`. | Real local process. |
| Database | SQLite snapshot at `apps/backend/data/divband-backend.sqlite` when launched through the root script. | Real local file, not a shared production database. |
| GitLab | Service boundary returns deterministic repository/runner metadata when called; no remote project is created in the basic smoke path. | Mocked locally. |
| Kubernetes | `KUBERNETES_CONFIG_MODE=disabled`; namespace operations stay inside the service boundary. | Mocked locally. |
| DNS | Verification uses generated challenge tokens and optional `observedToken` input; no DNS provider is changed. | Mocked locally. |
| Certificates | Certificate status is tracked as control-plane metadata; no ACME issuer or secret is created. | Mocked locally. |
| Object storage | The backend uses in-memory object metadata for publish planning; the smoke path below uses project deployment status rather than static-file upload promotion. | Mocked locally. |
| Email | No outbound email is sent for registration or local flows. | Mocked/not wired. |
| Billing | Plans and ownership are local metadata only; no payment provider is called. | Mocked/not wired. |

## Prerequisites

- Node.js 24 or newer. The backend uses `node:sqlite` and Node's `--experimental-transform-types` support.
- npm with workspace support.

Install dependencies once from the repository root:

```sh
npm install
```

## Start the smallest useful stack

From the repository root, run both local processes:

```sh
npm run dev:mvp
```

The script starts the backend first with local-safe environment variables, then builds and serves the dashboard with `DIVBAND_API_BASE_URL=http://localhost:3000`.

If you prefer separate terminals, use:

```sh
npm run dev:backend
```

```sh
npm run dev:frontend
```

No `docker-compose.yml` is required for the current MVP because SQLite is file-backed and object storage is mocked in memory. Add Compose later only when the local path needs a real PostgreSQL, MinIO/S3, mail sink, or similar emulator.

## Smoke scenario

Keep `npm run dev:mvp` running, then execute the following commands from another shell at the repository root. The scenario registers a user, creates a project, publishes the project by recording a successful deployment, fetches status, and opens the dashboard.

### 1. Register a user

```sh
REGISTER_RESPONSE=$(curl -sS -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"dev@example.com","name":"Dev User","password":"correct-horse"}')
TOKEN=$(printf '%s' "$REGISTER_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
```

### 2. Create a project

```sh
CREATE_RESPONSE=$(curl -sS -X POST http://localhost:3000/projects \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Site","slug":"demo-site"}')
PROJECT_ID=$(printf '%s' "$CREATE_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["project"]["id"])')
```

### 3. Attach the local platform hostname

```sh
curl -sS -X POST "http://localhost:3000/projects/$PROJECT_ID/platform-subdomain" \
  -H "authorization: Bearer $TOKEN"
```

### 4. Publish/finalize by reporting a successful deployment

The local MVP treats this as the project publish/finalize step because CI/CD and Kubernetes are mocked. It records the deployment as succeeded and moves the project to `deployed`.

```sh
DEPLOYMENT_RESPONSE=$(curl -sS -X POST "http://localhost:3000/projects/$PROJECT_ID/deployments" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"gitRef":"main","commitSha":"local-smoke"}')
DEPLOYMENT_ID=$(printf '%s' "$DEPLOYMENT_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployment"]["id"])')

curl -sS -X PUT "http://localhost:3000/projects/$PROJECT_ID/deployments/$DEPLOYMENT_ID/status" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"state":"succeeded","gitRef":"main","commitSha":"local-smoke","environment":"production","ingressHostname":"demo-site.localhost.test","healthCheckUrl":"http://demo-site.localhost.test/healthz","logLine":"local MVP deployment published"}'
```

### 5. Fetch status

```sh
curl -sS "http://localhost:3000/projects/$PROJECT_ID/status" \
  -H "authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected highlights:

- `status` is `deployed`.
- `platformSubdomainAttached` is `true`.
- `latestDeployment.state` is `succeeded`.

### 6. View the dashboard

Open `http://localhost:5173` in a browser, sign in as `dev@example.com` with password `correct-horse`, and verify the project appears in the dashboard. The project overview should show the deployed status and the latest deployment details.

## Useful checks

Run a repository-wide typecheck from the root:

```sh
npm run typecheck
```

Check backend health while it is running:

```sh
curl -sS http://localhost:3000/healthz
```
