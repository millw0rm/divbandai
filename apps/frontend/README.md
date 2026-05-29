# divband frontend

The frontend package defines a minimal dashboard surface for operating divband projects. It is intentionally framework-neutral so it can be embedded in a static shell, tested with a mocked `fetch`, or adapted to a UI framework later.

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

- `DivbandApiClient`, a small backend API client for auth, projects, GitLab repository provisioning, namespace provisioning, platform subdomains, custom domains, deployments, environment variables, logs, and assistant change requests.
- Dashboard page metadata for routing/navigation.
- Lifecycle state labels for Created, Repository provisioned, Namespace provisioned, Building, Deployed, Domain pending verification, Domain active, and Failed.
- HTML render helpers for a minimal dashboard shell and each page.

The backend currently exposes most of the project lifecycle API in `apps/backend/openapi.yaml`. The assistant client method targets `POST /projects/{projectId}/assistant/requests` as the frontend contract for the forthcoming AI workflow endpoint.
