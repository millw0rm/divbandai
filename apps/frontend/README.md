# divband frontend

The frontend package ships a Next.js app (App Router) with an embedded API route that loads `BackendService` in-process for local and VPS dev. The dashboard module in `src/dashboard.ts` remains the framework-neutral controller for auth, projects, and lifecycle actions.

Related docs: [`docs/local-mvp.md`](../docs/local-mvp.md), [`docs/development-vs-production.md`](../docs/development-vs-production.md), [`apps/backend/README.md`](../apps/backend/README.md), [`README.md`](../README.md#project-auto-provision-on-k3s).

Implemented dashboard pages:

- Sign in and sign up.
- Project list.
- Create project.
- Project overview with lifecycle stepper.
- GitLab repository status.
- Deployment status.
- Domain management.
- Environment variables.
- Logs and build history.
- AI assistant preview/mock chat for post-MVP feature requests and project changes.

`src/dashboard.ts` includes:

- `DivbandApiClient`, a backend API client for auth, projects, GitLab repository provisioning, namespace provisioning (retry/idempotent), platform subdomains, custom domains, deployments, environment variables, logs, and preview/mock AI change requests.
- On k3s/VPS backends, namespace provisioning and welcome-site deploy typically complete automatically when the user creates a project; dashboard buttons for manual provision remain as retry paths.
- `DashboardController` and `mountDashboard`, which wire forms/buttons to the backend API, store the auth token, load page-specific project data, and re-render after actions.
- Dashboard page metadata for routing/navigation.
- Lifecycle state labels for Created, Repository provisioned, Namespace provisioned, Building, Deployed, Domain pending verification, Domain active, and Failed.
- HTML render helpers for a minimal dashboard shell and each page.

## Local startup

From the repository root, install workspace dependencies once:

```sh
npm install
```

From the repository root, use the integrated dev path (recommended):

```sh
npm run dev:mvp
```

This starts Next.js on port 3000 with the API at `/api/*`. Do not run `dev:backend` and `dev:frontend` simultaneously — both use port 3000.

Legacy static build (optional):

```sh
npm run build --workspace @divband/frontend
npm run preview --workspace @divband/frontend
```

## Backend API URL

The build script reads the backend base URL from `DIVBAND_API_BASE_URL` (or `VITE_API_BASE_URL` for compatibility) and falls back to `/api` when neither variable is set.

Set the API URL when building or starting the local static server:

```sh
DIVBAND_API_BASE_URL=http://localhost:3000 npm run dev --workspace @divband/frontend
```

A compatibility `apps/frontend/.env.example` is included for hosts that load `VITE_API_BASE_URL`, but the built-in scripts use shell environment variables directly.

The expected local backend URL is `http://localhost:3000` unless you run `apps/backend` on a different port. The controller expects the backend API documented in `apps/backend/openapi.yaml`, including `POST /auth/register`, `POST /auth/login`, project lifecycle routes under `/projects`, and preview/mock AI change-request routes under `/projects/{projectId}/ai/change-requests` that are excluded from MVP acceptance.

## Browser mounting API

The static app uses the same browser mounting API that can be reused by other shells:

```ts
import { mountDashboard } from '@divband/frontend';

mountDashboard({
  root: document.querySelector('#app')!,
  baseUrl: '/api',
});
```
