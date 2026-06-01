# divband product source of truth

This document is the source of truth for divband product planning. Keep it current when scope, priorities, implementation status, or release readiness changes.

## 1. Product vision

**divband is for:**

- Solo founders, agencies, and small teams that need to publish client or product websites without assembling GitLab, Kubernetes, DNS, TLS, and deployment plumbing themselves.
- Coding agents and AI development workflows that need an immediate, safe, documented way to publish generated static output or deploy a managed project.
- Platform operators who want each customer project isolated by repository, runner, Kubernetes namespace, network policy, quota, routing, and domain verification.

**Problem divband solves:** publishing a real website or application currently requires many handoffs: account creation, repository setup, CI/CD, infrastructure provisioning, DNS records, TLS issuance, deployment status tracking, and ongoing changes. divband turns that workflow into a managed product path: create or instantly publish a project, get a platform URL, optionally attach a custom domain, and iterate through GitLab-backed deployments with visible status and auditability.

**Product promise:** a user or agent can get from content to a live, isolated URL quickly, then graduate that site into a durable project with account ownership, GitLab source control, Kubernetes deployment, custom domains, and operational guardrails.

## 2. MVP definition

For the prioritized minimal workable scope (P0/P1/CUT tags, simplified user/admin auth, git + K8s deploy loop, and explicit defer list), see **`docs/mvp-scope.md`**.

### Exact first usable product

The first usable product is a local-demo-ready hosted project flow where a new user can sign up, create a project, and see lifecycle state in the dashboard. On a k3s-backed control plane (`KUBERNETES_APPLY=true`), project creation also auto-provisions `project-{slug}` with a nginx welcome page, ingress, and platform hostname — see [`README.md`](../README.md#project-auto-provision-on-k3s), [`docs/architecture.md`](architecture.md), and [`infra/k8s/README.md`](../infra/k8s/README.md). GitLab/GitHub repository setup remains a separate optional step before CI replaces the welcome site. Locally, Kubernetes is mocked and provisioning placeholders are exercised through API smoke flows. Agent instant hosting exists as a documented/API skeleton for anonymous static publish sessions, but the MVP should not claim production-grade static serving until object storage, edge routing, abuse controls, and API-key ownership are implemented. AI-assisted change requests are explicitly post-MVP: the dashboard/API may expose preview/mock controls for design validation, but real model calls, repository context retrieval, diff generation, GitLab commits, merge requests, and CI polling are not required for MVP acceptance.

### Must have

- Account signup and login with bearer-session use in the API and dashboard client.
- Project creation with normalized slug, owner membership, platform hostname (`{slug}.{username}.{platformDomain}`), namespace name (`project-{slug}`), runner tag, and lifecycle state.
- Automatic Kubernetes welcome-stack provisioning on `POST /projects` when `KUBERNETES_APPLY=true` (namespace, nginx welcome page, platform ingress, deployment record, hostname attached).
- GitLab identity linkage plus project repository provisioning interface (optional before first custom app deploy).
- Kubernetes namespace provisioning interface, welcome profile templates, and full tenant manifests for quota, RBAC, network policy, app/static/frontend services, ingress, HTTPRoute, certificates, and external secrets — see [`infra/k8s/README.md`](../infra/k8s/README.md).
- Deployment creation/status/reporting, build logs, rollback records, and project status summary.
- Platform subdomain attach flow (automatic with welcome deploy on cluster-backed backends; manual retry via API when needed).
- Custom domain add/verify/certificate-status flow with clear DNS verification token expectations.
- Environment variable management with masked return values.
- Dashboard client pages and API methods for signup, signin, project list/create, repository status, deployment status, domains, environment variables, and logs.
- Product documentation, release checklist, and backlog in this file.
- AI assistant dashboard and API surfaces, if present, are labeled preview/mock and excluded from MVP acceptance.

### Should have

- Agent instant publish create/get/update/delete/finalize/claim API semantics documented and locally testable against the backend service.
- OpenAPI or equivalent API reference for dashboard and agent surfaces.
- Seed/demo script that walks through signup, project creation, provisioning, deployment, and domain verification.
- Clear local development instructions for running backend/frontend checks and a demo request sequence.
- Role/member management exposed in dashboard or documented API examples.
- Explicit acceptance tests for the core journeys listed below.

### Later

- Production static serving from object storage/CDN for agent instant publish.
- API keys for agents and CI systems.
- Billing tiers, quotas, retention limits, usage analytics, and abuse controls.
- Real GitLab, Kubernetes, DNS provider, certificate manager, database, object storage, and auth provider integrations.
- Production AI-assisted change requests with real model calls, repository context retrieval, diff generation, redaction pipeline, user-confirmed GitLab commits, merge request creation, and CI status polling.
- MCP server, installable agent skill, `/.well-known/agent.json`, and `/llms.txt` distribution surfaces.
- Rich frontend framework UI, onboarding emails, team invites, audit-log viewer, support/admin tooling, and production SLO dashboards.

## 3. User journeys

### Agent instant publish

1. Agent builds a static directory locally and chooses or receives a slug.
2. Agent calls `POST /api/v1/publish` with manifest/upload metadata and receives an accepted publish response plus claim/finalization metadata.
3. Agent uploads or registers files according to the publish contract.
4. Agent calls `POST /api/v1/publish/{slug}/finalize` with the version ID.
5. Agent shares the live slug URL.
6. If the user later creates an account, the user signs in and calls `POST /api/v1/publish/{slug}/claim` with the claim token.
7. Future owned updates use authenticated publish update/delete/list APIs and, later, API keys.

### Account signup

1. Visitor opens the dashboard and chooses **Sign up**.
2. Dashboard submits email, name, and password to `POST /auth/register`.
3. Backend creates a user, session, and personal organization, then returns the session token.
4. Dashboard stores the session token and moves the user to project creation or project list.
5. User can optionally link OAuth/OIDC and GitLab identities for future provisioning.

### Project creation

1. Authenticated user chooses **Create project**.
2. Dashboard submits project name and optional slug to `POST /projects`.
3. Backend normalizes the slug, creates project metadata, owner membership, default platform hostname, namespace name `project-{slug}`, runner tag, and lifecycle plan.
4. On cluster-backed backends (`KUBERNETES_APPLY=true`, `DIVBAND_AUTO_PROVISION_PROJECTS` not disabled), the backend automatically applies the welcome Kubernetes stack, records a successful welcome deployment, and attaches the platform hostname. Failures are audited; retry with `POST /projects/{id}/kubernetes-namespace`. See [`operations.md`](operations.md#mvp-provisioning-runbook-api-request-to-live-hostname).
5. User lands on the project overview and sees status, GitLab path, namespace, platform hostname, domains, deployments, and environment variables.
6. User can invite members, create API tokens, configure environment variables, and connect GitHub/GitLab when ready to replace the welcome page.

### GitLab/Kubernetes project deploy

1. User links a GitLab or GitHub identity if not already linked.
2. User starts repository provisioning from dashboard or API (`POST /projects/{id}/gitlab-repository` or `…/github-repository`).
3. Backend calls the source-control adapter and records repository URL/path and runner configuration status.
4. Kubernetes namespace and welcome site already exist on cluster-backed backends after project create. If provisioning failed or the backend runs locally, user retries with `POST /projects/{id}/kubernetes-namespace`.
5. User pushes code or triggers a deployment for a Git ref or commit SHA; CI replaces the welcome nginx workload in `project-{slug}`.
6. Backend creates a queued/running deployment, receives status reports from CI/runner integration, appends logs, and updates lifecycle state.
7. User monitors deployment status and logs; if needed, user rolls back to a previous deployment.

### Custom domain attach

1. User opens domain management for a project.
2. User enters a hostname and submits it to `POST /projects/{projectId}/domains`.
3. Backend creates a domain record with a verification token and DNS record instructions.
4. User creates the required DNS record at their provider.
5. User clicks verify or calls `POST /projects/{projectId}/domains/{domainId}/verify` with the observed token when locally simulating DNS.
6. Backend verifies ownership, marks the domain verified, and requests or updates certificate status.
7. Routing/TLS manifests or providers attach traffic to the project after certificate issuance.

## 4. Current implementation status

| Capability | Status | Existing source |
| --- | --- | --- |
| Account registration/login | Implemented in backend service skeleton; dashboard client has register/login methods. | `apps/backend/src/backend-service.ts`, `apps/frontend/src/dashboard.ts` |
| OAuth/OIDC identity linkage | Backend API path exists; provider decision remains open. | `apps/backend/src/backend-service.ts` |
| GitLab identity and repository provisioning | Backend identity/provisioning paths exist and require linked GitLab identity; real provider behavior is service-backed/skeleton. | `apps/backend/src/backend-service.ts`, `docs/gitlab.md` |
| Project creation/list/status | Backend project routes and dashboard types/client methods exist. | `apps/backend/src/backend-service.ts`, `apps/frontend/src/dashboard.ts` |
| Kubernetes namespace provisioning | Implemented: auto welcome stack on `POST /projects` when `KUBERNETES_APPLY=true`; idempotent retry via `POST /projects/{id}/kubernetes-namespace`. Templates in `infra/k8s/base`. | `apps/backend/src/services/kubernetes.ts`, [`infra/k8s/README.md`](../infra/k8s/README.md), [`architecture.md`](architecture.md) |
| Platform subdomain attach | Automatic with welcome deploy on cluster backends; manual API retry still available. | `apps/backend/src/backend-service.ts`, [`operations.md`](operations.md) |
| Deployment tracking/logs/rollback | Backend routes and dashboard client types/methods exist for deployments, reports, logs, and rollback. Welcome deploy recorded automatically on k3s project create. | `apps/backend/src/backend-service.ts`, [`deployments.md`](deployments.md) |
| Custom domains and certificate status | Backend domain add/verify/status behavior and dashboard domain types/methods exist; Kubernetes ingress/HTTPRoute/certificate templates are placeholders. | `apps/backend/src/backend-service.ts`, `apps/frontend/src/dashboard.ts`, `infra/k8s/base` |
| Environment variables | Backend masked environment-variable management and dashboard methods exist. | `apps/backend/src/backend-service.ts`, `apps/frontend/src/dashboard.ts` |
| AI-assisted change requests | Post-MVP preview/mock only; backend and dashboard types/methods cover the shape of request, context, patch, branch, MR, CI, and status flow, but the implementation must not be counted as an MVP acceptance criterion until real adapters replace synthetic behavior. | `apps/backend/src/backend-service.ts`, `apps/frontend/src/dashboard.ts`, `docs/ai-workflow.md` |
| Agent instant hosting | Product/design milestones and publish API routes exist; production object storage/edge serving remains later work. | `docs/agent-instant-hosting.md`, `apps/backend/src/backend-service.ts` |
| Kubernetes base templates | Welcome profile + full tenant manifests (`welcome-deployment.yaml`, `ingress-platform.yaml`, etc.). | [`infra/k8s/README.md`](../infra/k8s/README.md) |
| Frontend dashboard UI | TypeScript controller/client definitions and page inventory exist; framework/build decision remains open. | `apps/frontend/src/dashboard.ts` |

## 5. Backlog

| Item | Area | Priority | Owner/status | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| Local demo walkthrough | Product/devrel | P0 | Unowned / not started | Backend service, dashboard client | A contributor can follow one documented script from signup through project deploy and custom-domain verification locally. |
| API reference for current backend routes | API/docs | P0 | Unowned / not started | Stable route list in backend | Docs include request/response examples for auth, projects, provisioning, domains, deployments, env vars, and publish routes; AI change-request routes are marked preview/mock and excluded from MVP acceptance. |
| Persist backend state in a database | Platform | P0 | Open decision | Database selection, migrations | Data survives process restart; tests cover user, project, domain, deployment, publish, and audit records. |
| Real auth provider/session hardening | Auth/security | P0 | Open decision | Auth provider, password/session policy | Signup/login use production-grade credential handling, expiration, revocation, and OAuth/OIDC configuration. |
| GitLab provisioning integration | Integrations | P0 | Skeleton exists | GitLab instance/token, runner model | Creating a project creates a private GitLab project, configures runner tags, and stores repository URL. |
| Kubernetes apply integration | Infrastructure | P0 | Welcome auto-provision implemented | Cluster target, kube credentials, `kubectl` in backend image | `POST /projects` applies welcome stack; CI replaces welcome workload; full-stack templates available for later phases. |
| Deployment status webhook/runner bridge | Deployments | P0 | Skeleton exists | GitLab CI integration, auth for reports | CI can report queued/running/succeeded/failed states and logs to the correct project deployment. |
| Monorepo automated test suite | Testing/CI | P0 | Smoke scripts exist | Test runner choice, CI runner | Root `npm test` runs typecheck plus backend smoke/unit/integration checks; CI blocks regressions for auth, projects, domains, deployments, persistence, and dashboard-critical paths. |
| Custom-domain DNS provider integration | Domains | P1 | Skeleton exists | DNS provider, hosting domain | Domain verification checks real DNS and prevents cross-project/domain takeover. |
| Delegated DNS / nameserver support | Domains/infra | P1 | Designed only | DNS architecture decision, provider or authoritative DNS infra, database persistence | Customers can delegate a full zone or sub-zone to Divband/provider nameservers, the backend verifies NS delegation, DNS records and DNS-01 challenges are managed automatically, and Kubernetes routes traffic only to the owning project namespace. |
| TLS/certificate automation | Domains/infra | P1 | Templates exist | cert-manager or managed cert decision | Verified domains receive certificates and expose certificate status transitions. |
| Frontend app build/runtime | Frontend | P1 | Open decision | Framework/build decision | Dashboard can be built, served, and used for the MVP journeys without manual API calls. |
| Agent publish storage and edge serving | Agent hosting | P1 | Designed only | Object storage, CDN/edge, route metadata store | Finalized static publish is served from immutable versioned storage at a live URL. |
| Agent API keys | Agent hosting/auth | P1 | Designed only | Auth/session provider, token storage | Owned sites can be updated by scoped revocable API keys without browser sessions. |
| Abuse controls and quotas | Security/platform | P1 | Not started | Storage/edge/provider metrics | Publish and deployment flows enforce size, rate, retention, phishing/malware, and bandwidth controls. |
| Product analytics and audit viewer | Operations | P2 | Audit service skeleton | Database, frontend UI | Operators and project owners can inspect relevant usage and audit events safely. |
| Billing/tier enforcement | Business | P2 | Not started | Quotas, payment provider, plans | Free/paid limits are enforced before costly operations and explained in product UI/API errors. |
| Production AI assistant | AI/workflow | P2 | Preview/mock only | Model provider, GitLab adapter, repository context indexer, redaction service, audit/event store | Natural-language change requests use real adapters for model calls, context retrieval, diff generation, redaction, confirmation, branch commits, merge requests, and CI polling with documented failure handling. |

## 6. Open decisions

| Decision | Current options | Decision needed before | Notes |
| --- | --- | --- | --- |
| Object storage provider | S3-compatible storage, Cloudflare R2, Google Cloud Storage, Azure Blob, MinIO for local/dev | Agent static serving MVP | Must support immutable version prefixes, signed upload/download paths, lifecycle/retention policy, and abuse quarantine. |
| Database | PostgreSQL, managed Postgres/Supabase, SQLite for local-only prototype | Private alpha | Prefer a relational model for users, orgs, projects, memberships, domains, deployments, publish metadata, tokens, and audit logs. |
| Auth provider | In-house email/password plus OIDC, Auth0, Clerk, Supabase Auth, GitLab OAuth-first | Private alpha | Must support secure sessions, OAuth/OIDC, service/API tokens, revocation, and organization membership mapping. |
| Frontend framework/build | Current TypeScript-only controller, Vite + React, SvelteKit, Next.js, Astro | Local demo / private alpha | MVP needs a buildable dashboard; static UI is acceptable if journeys are complete. |
| Hosting domain | `divband.ir`, `divband.io`, separate static-hosting domain, local wildcard domain | Public MVP | Consider cookie isolation, phishing risk, custom-domain routing, TLS automation, and brand/domain availability. |
| Deployment target | Local kind/k3d, managed Kubernetes, single VPS/k3s, hybrid static edge + Kubernetes apps | Private alpha | Must match the MVP promise: isolated project namespaces for app deploys and a separate static-serving path for agent instant publish. |
| AI assistant scope | Defer to post-MVP unless promoted with real adapters and security review | Post-MVP | Current decision: preview/mock only for MVP; do not include in MVP acceptance criteria. |

## 7. Release checklist

### Local demo

- [ ] Repository installs dependencies and typechecks on a clean machine.
- [ ] On k3s/VPS backends, creating a project provisions `project-{slug}` with welcome nginx, ingress, and platform hostname without manual API steps.
- [ ] Backend service can be exercised with local requests for signup, login, project creation, deployment reporting, and domain verification (Kubernetes mocked locally).
- [ ] Dashboard can call local backend methods or a mocked fetch implementation for the core journeys, excluding the preview/mock AI assistant.
- [ ] Kubernetes base manifests render with demo placeholder replacements or have documented manual substitutions.
- [ ] Demo documentation includes exact commands, sample payloads, expected responses, and reset steps.
- [ ] Known limitations are explicit: no production database, provider integrations, real DNS/TLS, object storage, or edge serving unless implemented.

### Private alpha

- [ ] Database persistence, migrations, backups, and environment-specific configuration are in place.
- [ ] Auth/session provider is production-grade enough for invited users.
- [ ] GitLab project provisioning and runner/deployment reporting work against the selected GitLab environment.
- [ ] Kubernetes welcome-stack provisioning applies manifests to the selected cluster on project create; CI can replace the welcome workload.
- [ ] Platform subdomains and at least one verified custom domain path work end to end.
- [ ] Basic monitoring, logs, audit records, and operator rollback/debug runbooks exist.
- [ ] Invite-only terms, support channel, incident contact, and abuse reporting path are documented.

### Public MVP

- [ ] Public onboarding, docs, API reference, and product positioning are complete.
- [ ] Core dashboard journeys are usable without manual API calls, excluding the preview/mock AI assistant.
- [ ] Agent instant hosting either works end to end with static serving or is clearly excluded from public claims.
- [ ] Quotas, rate limits, retention, and abuse scanning protect anonymous and authenticated surfaces.
- [ ] Custom-domain ownership checks and TLS lifecycle are automated and tested.
- [ ] Security review covers auth, project isolation, domain takeover, API tokens, and CI/deployment report authentication; AI secret redaction and workflow safety are reviewed before the post-MVP AI assistant becomes production.
- [ ] Operational dashboards track availability, deployment success rate, certificate health, DNS failures, publish abuse, and storage/bandwidth usage.

### Production

- [ ] Multi-region or clearly defined single-region reliability target is documented with SLOs.
- [ ] Backups, disaster recovery, migration rollback, and incident response are tested.
- [ ] Billing/tier enforcement, paid limits, invoices, and account lifecycle flows are live if monetization is enabled.
- [ ] Abuse, legal, privacy, and security processes are staffed and documented.
- [ ] Provider credentials, secrets, and cluster access follow least privilege and rotation policies.
- [ ] End-to-end tests and synthetic checks continuously cover signup, project create (auto welcome on k3s), GitLab deploy replacing welcome, domain attach, TLS, deployment rollback, and instant publish if launched.
- [ ] Production readiness review signs off on scalability, cost controls, support load, and deprecation/versioning policy.

## Related documentation

| Topic | Document |
| --- | --- |
| MVP scope and P0/P1 tags | [`mvp-scope.md`](mvp-scope.md) |
| Local vs k3s run paths | [`development-vs-production.md`](development-vs-production.md), [`local-mvp.md`](local-mvp.md) |
| Architecture and provisioning flow | [`architecture.md`](architecture.md) |
| Operator runbook | [`operations.md`](operations.md#mvp-provisioning-runbook-api-request-to-live-hostname) |
| Tenancy and isolation | [`tenancy.md`](tenancy.md) |
| K8s templates (welcome vs full stack) | [`infra/k8s/README.md`](../infra/k8s/README.md) |
| Ansible/k3s bootstrap | [`infra/ansible/README.md`](../infra/ansible/README.md) |
| GitLab lifecycle | [`gitlab.md`](gitlab.md) |
| CI deploy and rollback | [`deployments.md`](deployments.md) |
| Entry point | [`README.md`](../README.md#project-auto-provision-on-k3s) |
