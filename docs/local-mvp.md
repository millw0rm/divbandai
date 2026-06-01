# Local MVP

This guide describes the smallest useful local divband setup: a single Next.js dev server with an embedded API, in-memory application state, and mocked platform integrations. It is intended for repeatable product and API smoke testing before production GitLab, Kubernetes, DNS, certificate, storage, email, billing, and durable persistence adapters are connected.

For how this path compares to Ansible, Kubernetes, and production deployment scripts, see [`development-vs-production.md`](./development-vs-production.md).

## What runs locally

| Area | Local MVP behavior | Real or mocked locally? |
| --- | --- | --- |
| Backend API | Node HTTP server from `apps/backend` on `http://localhost:3000`. | Real local process. |
| Frontend dashboard | Next.js app from `apps/frontend` on `http://localhost:3000` (API proxied at `/api/*`). | Real local process. |
| Application state | In-memory `BackendStore` maps and arrays behind the runtime persistence adapter. Data resets when the process restarts. | Real local process memory. |
| GitLab | Service boundary returns deterministic repository/runner metadata when called; no remote project is created in the basic smoke path. | Mocked locally. |
| Kubernetes | `KUBERNETES_CONFIG_MODE=disabled`; namespace operations stay inside the service boundary. | Mocked locally. |
| DNS | Verification uses generated challenge tokens and optional `observedToken` input; no DNS provider is changed. | Mocked locally. |
| Certificates | Certificate status is tracked as control-plane metadata; no ACME issuer or secret is created. | Mocked locally. |
| Object storage | The backend uses in-memory object metadata for publish planning; the smoke path below uses project deployment status rather than static-file upload promotion. | Mocked locally. |
| Email | No outbound email is sent for registration or local flows. | Mocked/not wired. |
| Billing | Plans and ownership are local metadata only; no payment provider is called. | Mocked/not wired. |
| Per-project Kubernetes | Not applied locally. On k3s/VPS backends with `KUBERNETES_APPLY=true`, `POST /projects` auto-provisions `project-{slug}` with a nginx welcome page. | Real on cluster-backed backends only. |

## Production-style auto-provision (not local)

On a k3s/VPS control plane, project creation triggers real Kubernetes work when the backend has:

- `KUBERNETES_APPLY=true`
- `KUBERNETES_CONFIG_MODE=kubeconfig` (with mounted kubeconfig)
- `DIVBAND_AUTO_PROVISION_PROJECTS=true` (Ansible default; set to `0` to disable)

That path is documented in [`development-vs-production.md`](./development-vs-production.md), [`operations.md`](./operations.md), [`README.md`](../README.md#project-auto-provision-on-k3s), and [`../infra/k8s/README.md`](../infra/k8s/README.md). Local `npm run dev:mvp` intentionally skips it.

## Demo accounts

Local dev scripts set `DIVBAND_SEED_DEMO_DATA=1`, so the app creates the same test accounts on every in-memory startup. All demo accounts use password `DemoPass123!`.

| Role | Email |
| --- | --- |
| Platform super admin | `demo.superadmin@divband.test` |
| Platform support | `demo.support@divband.test` |
| Platform security | `demo.security@divband.test` |
| Project owner | `demo.owner@divband.test` |
| Project admin | `demo.admin@divband.test` |
| Project developer | `demo.developer@divband.test` |
| Project viewer | `demo.viewer@divband.test` |

The project-role accounts are members of the `demo-role-test` project.

## Local GitHub connection

Local scripts set `SOURCE_CONTROL_PROVIDER=github`. To let a demo user provision and push to a real GitHub repository through the dashboard, create a GitHub OAuth app and set:

```sh
export GITHUB_OAUTH_CLIENT_ID=...
export GITHUB_OAUTH_CLIENT_SECRET=...
```

Set the OAuth app callback URL to:

```text
http://localhost:3000/api/auth/callback/github
```

After signing in, open the repository status page and click `Connect GitHub`. GitHub will show its authorization page, then return to the local dashboard with the linked identity.

For a manual fallback, create a GitHub personal access token and link it to the local user:

```sh
curl -sS -X POST http://localhost:3000/api/auth/github-identity \
  -H "authorization: Bearer $DIVBAND_SESSION_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"username":"your-github-login","githubUserId":"your-github-login","accessToken":"github_pat_or_classic_token"}'
```

Then use the dashboard's repository provisioning action or call:

```sh
curl -sS -X POST "http://localhost:3000/api/projects/$PROJECT_ID/github-repository" \
  -H "authorization: Bearer $DIVBAND_SESSION_TOKEN"
```

The local GitHub adapter creates a private repository under the linked GitHub user, stores non-secret Divband metadata as repository variables when permitted, and writes reviewed AI proposals to `ai/...` branches before opening pull requests.

To seed the demo owner with a GitHub identity on every local restart, set these environment variables before running the app:

```sh
export DIVBAND_DEMO_GITHUB_USERNAME=your-github-login
export DIVBAND_DEMO_GITHUB_TOKEN=github_pat_or_classic_token
npm run dev:mvp
```

## Prerequisites

- Node.js 24 or newer. The backend uses Node's `--experimental-transform-types` support.
- npm with workspace support.

Install dependencies once from the repository root:

```sh
npm install
```

## Start the smallest useful stack

From the repository root, run:

```sh
npm run dev:mvp
```

This starts Next.js on port 3000 with local-safe environment variables and an in-process API (`apps/frontend/app/api/[[...path]]/route.ts`). The dashboard talks to `/api/*` on the same origin.

If you prefer separate terminals, use:

```sh
npm run dev:backend
```

```sh
npm run dev:frontend
```

No `docker-compose.yml` is required for the current MVP because application state and object storage are mocked in memory. Add Compose later only when the local path needs a real PostgreSQL, MinIO/S3, mail sink, or similar emulator.

## Smoke scenario

Keep `npm run dev:mvp` running, then execute the following commands from another shell at the repository root. The scenario registers a user, creates a project, publishes the project by recording a successful deployment, fetches status, and opens the dashboard. API paths use the `/api` prefix because `dev:mvp` serves the backend through Next.js. If you use `npm run dev:backend` instead, drop the `/api` segment from each URL.

### 1. Register a user

```sh
REGISTER_RESPONSE=$(curl -sS -X POST http://localhost:3000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"dev@example.com","name":"Dev User","password":"correct-horse"}')
TOKEN=$(printf '%s' "$REGISTER_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
```

### 2. Create a project

```sh
CREATE_RESPONSE=$(curl -sS -X POST http://localhost:3000/api/projects \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Site","slug":"demo-site"}')
PROJECT_ID=$(printf '%s' "$CREATE_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["project"]["id"])')
```

### 3. Attach the local platform hostname

```sh
curl -sS -X POST "http://localhost:3000/api/projects/$PROJECT_ID/platform-subdomain" \
  -H "authorization: Bearer $TOKEN"
```

### 4. Publish/finalize by reporting a successful deployment

The local MVP treats this as the project publish/finalize step because CI/CD and Kubernetes are mocked. It records the deployment as succeeded and moves the project to `deployed`.

```sh
DEPLOYMENT_RESPONSE=$(curl -sS -X POST "http://localhost:3000/api/projects/$PROJECT_ID/deployments" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"gitRef":"main","commitSha":"local-smoke"}')
DEPLOYMENT_ID=$(printf '%s' "$DEPLOYMENT_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployment"]["id"])')

curl -sS -X PUT "http://localhost:3000/api/projects/$PROJECT_ID/deployments/$DEPLOYMENT_ID/status" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"state":"succeeded","gitRef":"main","commitSha":"local-smoke","environment":"production","ingressHostname":"demo-site.localhost.test","healthCheckUrl":"http://demo-site.localhost.test/healthz","logLine":"local MVP deployment published"}'
```

### 5. Fetch status

```sh
curl -sS "http://localhost:3000/api/projects/$PROJECT_ID/status" \
  -H "authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected highlights:

- `status` is `deployed`.
- `platformSubdomainAttached` is `true`.
- `latestDeployment.state` is `succeeded`.

### 6. View the dashboard

Open `http://localhost:3000` in a browser, sign in as `dev@example.com` with password `correct-horse`, and verify the project appears in the dashboard. The project overview should show the deployed status and the latest deployment details.


## Agent static publish smoke path

The local backend now supports the complete in-memory static publish loop: create a publish session, upload each file to the returned local presigned URL, finalize the version, and serve it back through the static host resolver. The root `npm test` command runs this through `npm run smoke:publish --workspace @divband/backend`.

For a manual check while `npm run dev:backend` is running, create a small build directory and publish it with the bundled agent helper:

```sh
mkdir -p /tmp/divband-static-smoke
printf '<!doctype html><h1>hello from divband</h1>' > /tmp/divband-static-smoke/index.html
DIVBAND_API_BASE_URL=http://localhost:3000 node packages/agent-skill/scripts/publish-static-site.mjs /tmp/divband-static-smoke --anonymous
```

The helper uploads to the local backend's in-memory object storage URL and finalizes the returned version. To fetch the served object without configuring DNS, send the platform hostname in the `Host` header:

```sh
curl -sS -H 'Host: <returned-slug>.localhost.test' http://localhost:3000/
```

Replace `<returned-slug>` with the `slug` printed by the helper. The response should contain the uploaded `index.html` content.

## Useful checks

Run a repository-wide typecheck from the root:

```sh
npm run typecheck
```

Check backend health while it is running:

```sh
curl -sS http://localhost:3000/api/healthz
```
