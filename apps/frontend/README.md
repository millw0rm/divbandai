# divband frontend

The frontend package defines a minimal, framework-neutral dashboard for operating divband projects. It can be mounted into a static HTML shell, tested with a mocked `fetch`, or adapted to a UI framework later.

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
- AI assistant chat for feature requests and project changes.

`src/dashboard.ts` includes:

- `DivbandApiClient`, a backend API client for auth, projects, GitLab repository provisioning, namespace provisioning, platform subdomains, custom domains, deployments, environment variables, logs, and AI change requests.
- `DashboardController` and `mountDashboard`, which wire forms/buttons to the backend API, store the auth token, load page-specific project data, and re-render after actions.
- Dashboard page metadata for routing/navigation.
- Lifecycle state labels for Created, Repository provisioned, Namespace provisioned, Building, Deployed, Domain pending verification, Domain active, and Failed.
- HTML render helpers for a minimal dashboard shell and each page.

Minimal browser usage:

```ts
import { mountDashboard } from '@divband/frontend';

mountDashboard({
  root: document.querySelector('#app')!,
  baseUrl: '/api',
});
```

The controller expects the backend API documented in `apps/backend/openapi.yaml`, including `POST /auth/register`, `POST /auth/login`, project lifecycle routes under `/projects`, and AI change-request routes under `/projects/{projectId}/ai/change-requests`.
