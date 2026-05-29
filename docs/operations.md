# Operations

This document defines the first operational contract for Divband project hosting. It is intended to be implemented by the API, GitLab automation, Kubernetes templates, observability stack, and the admin dashboard before production launch.

## Resource identity and ownership

Every operational signal and managed resource must carry the same tenant-scoped identity fields so logs, metrics, alerts, audits, quota reports, and invoices can be joined without guessing.

| Field | Required label or attribute | Description |
| --- | --- | --- |
| Project ID | `divband.io/project-id` | Stable platform project identifier. Never reuse after deletion. |
| Project slug | `divband.io/project-slug` | Human-readable namespace and default hostname component. |
| Tenant ID | `divband.io/tenant-id` | Stable customer, workspace, or organization identifier used for quota and billing rollups. |
| Environment | `divband.io/environment` | Deployment environment such as `preview`, `staging`, or `production`. |
| Owner ID | `divband.io/owner-id` | User or service principal responsible for the project. |

Kubernetes resources in `infra/k8s/` use these labels and matching annotations. Labels support selectors, policy, metrics, and cost allocation. Annotations preserve the same metadata on resources where selectors should stay narrow or where downstream tools copy annotations into events.

## Per-project logs collection design

- Collect container stdout and stderr from each project namespace with a node-level agent such as Fluent Bit, Vector, or OpenTelemetry Collector.
- Enrich every log record with Kubernetes namespace, pod, container, image, node, and the Divband identity labels listed above.
- Partition or index logs by tenant ID, project ID, and environment. Retain project-level query filters in the UI and block cross-tenant reads unless the viewer has platform administrator privileges.
- Capture GitLab automation logs for project creation, runner registration, CI jobs, deployment jobs, and rollback jobs. These logs must include GitLab group ID, GitLab project ID, pipeline ID, job ID, commit SHA, tenant ID, project ID, and environment.
- Capture control-plane API logs for project lifecycle, domain lifecycle, role assignment, secret metadata operations, quota updates, and deployment orchestration. Do not log secret values, tokens, private keys, or full authorization headers.
- Apply retention tiers by plan: short-term searchable hot storage, longer cold/archive storage for audit-relevant events, and configurable deletion on project deletion when legal hold is not active.
- Emit structured JSON logs with a stable `event.name`, `event.outcome`, `actor.id`, `actor.type`, `trace.id`, and `request.id` to support correlation between API, GitLab, and Kubernetes events.

## Per-project metrics labels

All application, platform, GitLab, and Kubernetes metrics used for dashboards, alerting, quota, or billing must include these labels when cardinality is bounded:

- `project_id`
- `project_slug`
- `tenant_id`
- `environment`
- `owner_id`
- `namespace`
- `workload`
- `service`
- `gitlab_project_id` when the metric originates from GitLab automation or CI
- `pipeline_id` and `deployment_id` only for short-lived deployment metrics where high cardinality is expected and controlled

Required metric families:

- Deployment health: rollout duration, rollout status, failed rollout count, rollback count, image pull failures, readiness failures, and active revision.
- Runtime health: request rate, error rate, latency histogram, pod restarts, CPU requests and usage, memory requests and usage, storage requests and usage, network ingress and egress.
- Certificate and domain health: certificate ready status, expiration timestamp, renewal failure count, DNS verification status, and custom-domain attachment status.
- GitLab health: project provisioning duration, runner registration status, runner online status, CI queue duration, job duration, and job failure count.
- Quota and billing: requested CPU, used CPU, requested memory, used memory, requested storage, used storage, pod count, service count, ingress count, secret count, public egress bytes, build minutes, deployment count, and retained log bytes.

## Instant static hosting operational limits

The backend must centralize product defaults in `apps/backend/src/publishing/limits.ts` and keep public documentation, agent metadata, gateway configuration, and enforcement code aligned with that module.

| Limit family | Anonymous | Free account | Paid tiers |
| --- | --- | --- | --- |
| Retention | 24-hour TTL; one-hour fallback during abuse spikes | Permanent while under quota | Permanent while under quota, with longer version history by plan |
| Upload size | 100 files, 10 MiB max file, 50 MiB total | 1,000 files, 25 MiB max file, 1 GiB pooled storage | Increased storage, file, and version-history caps by plan |
| Publish rate | 10 publishes per IP per hour | 60 publishes per account per hour | Higher account, team, IP, and API-token limits by plan |
| Domains | Platform subdomain only | One custom domain | Increased custom domains by plan |
| Product features | Unguessable slug and claim token only | Permanent sites and limited or no analytics | Password protection, analytics, vanity handles, and higher limits |

Operational requirements:

- Enforce max files, max file bytes, max total upload bytes, default TTL, upload-plan TTL, and rate-limit defaults from the centralized backend constants.
- Emit structured metrics for accepted publishes, rejected publishes, total bytes, file counts, TTL chosen, source IP, source ASN, authenticated account, and triggering limit.
- Configure API gateway and application throttles with the same per-IP and per-ASN windows so edge and backend decisions are explainable.
- Use unguessable anonymous slugs and never route anonymous sites through user-supplied vanity handles or custom domains.
- Lower anonymous TTL to the configured one-hour abuse fallback when phishing, malware, ASN reputation, report volume, or publish velocity thresholds are exceeded.

## Abuse operations workflow

- Run phishing-pattern checks on HTML before finalization and quarantine suspicious sites instead of serving them publicly.
- Run malware/hash checks for every uploaded file and block known-bad hashes before issuing upload completion or live-version status.
- Block dangerous MIME types at manifest validation and again at object ingestion so clients cannot bypass checks by changing declared content type.
- Expose an abuse-report endpoint that accepts URL, category, reporter contact, and evidence; reports must be acknowledged, deduplicated, and linked to the affected site/version.
- Takedowns must preserve evidence, disable serving, notify the owner when known, record reviewer decisions, and support reinstatement or permanent deletion according to policy.
- Alert Trust & Safety when a single IP, account, ASN, domain, hash, or HTML pattern crosses abuse thresholds or triggers repeated shorter-TTL fallbacks.

## Audit events

Audit events must be immutable, append-only, tenant-scoped, and queryable by actor, target, project ID, tenant ID, request ID, and time range. Store event metadata and before/after summaries, but never store secret values.

| Event | Required event names | Required fields |
| --- | --- | --- |
| Project creation | `project.create.requested`, `project.create.succeeded`, `project.create.failed` | Actor, tenant ID, project ID, slug, template, requested environment, failure reason. |
| Domain changes | `domain.added`, `domain.verification_requested`, `domain.verified`, `domain.activated`, `domain.removed`, `domain.failed` | Actor, project ID, tenant ID, domain, verification method, certificate name, previous domain state, new domain state. |
| GitLab project creation | `gitlab_project.create.requested`, `gitlab_project.create.succeeded`, `gitlab_project.create.failed` | Actor or automation principal, project ID, tenant ID, GitLab group ID, GitLab project ID, visibility, template, failure reason. |
| Runner registration | `runner.register.requested`, `runner.register.succeeded`, `runner.register.failed`, `runner.unregistered` | Actor or automation principal, project ID, tenant ID, runner ID, runner scope, tags, executor, failure reason. |
| Deployment | `deployment.requested`, `deployment.started`, `deployment.succeeded`, `deployment.failed`, `deployment.rollback_requested`, `deployment.rolled_back` | Actor, project ID, tenant ID, environment, deployment ID, pipeline ID, job ID, commit SHA, image digest, namespace, workload, failure reason. |
| Secret changes | `secret.created`, `secret.updated`, `secret.deleted`, `secret.rotated`, `secret.sync_failed` | Actor, project ID, tenant ID, environment, secret key name or secret metadata ID, external secret path, version, operation type, failure reason. |
| User role changes | `user_role.granted`, `user_role.changed`, `user_role.revoked` | Actor, tenant ID, project ID when project-scoped, target user ID, old role, new role, reason, invitation ID if applicable. |

Additional audit coverage should include login, project archive/delete, AI workflow approvals, merge request creation, quota changes, billing-plan changes, and admin impersonation.

## Admin dashboard requirements

The admin dashboard must provide platform-wide and tenant-scoped operational views:

- Project inventory with tenant, owner, environment, GitLab project, namespace, current deployment, domains, certificate state, runner state, quota consumption, and lifecycle state.
- Per-project detail page showing recent deployments, active pods, logs link, metrics graphs, alerts, audit trail, secrets metadata, domains, GitLab pipelines, and current quota limits.
- Tenant overview with aggregate resource usage, plan limits, projected billable usage, failed projects, suspended projects, and noisy alerts.
- Deployment operations controls for retry, rollback, pause, resume, and mark incident, guarded by role-based access control and audit logging.
- Domain and certificate operations controls for re-verify DNS, reissue certificate, detach domain, and inspect challenge status.
- Runner operations view for registered runners, assignment, tags, executor, last contact, failed jobs, queue time, and registration errors.
- Quota controls for adjusting limits, viewing historical usage, forecasting exhaustion, and showing which workloads consume the most resources.
- Audit explorer with filters for event name, actor, target user, tenant, project, environment, request ID, outcome, and time range.
- Alert center with severity, owning tenant/project, impacted environment, runbook link, first seen, last seen, acknowledgment, and resolution notes.

## Quota and billing-ready resource accounting

Resource accounting must be generated from Kubernetes, GitLab, object/log storage, and application gateway signals using the same project and tenant labels.

- Maintain point-in-time quota state per project and environment for CPU, memory, storage, pods, services, ingresses, secrets, build minutes, public egress, retained logs, and deployment count.
- Record both requested resources and observed usage. Requested CPU, memory, and storage are required for quota enforcement; observed usage is required for efficiency reports and optional usage-based billing.
- Sample usage at fixed intervals and store rollups at hourly and daily granularity by tenant ID, project ID, and environment.
- Attribute GitLab CI build minutes, runner minutes, artifacts storage, container registry storage, and package storage to the Divband project that owns the GitLab project.
- Attribute shared ingress and certificate-manager costs by active hostnames, request volume, bandwidth, and certificate count where possible.
- Emit quota usage metrics and persist billing ledger entries separately. Metrics can be corrected or backfilled; ledger entries require an auditable adjustment event.
- Enforce hard Kubernetes `ResourceQuota` objects per project namespace and soft product-plan quotas at the API layer before provisioning expensive resources.
- Alert before quota exhaustion and block new deployments or resource-creating operations with clear remediation steps when hard quotas are reached.

## Alerting requirements

All alerts must include tenant ID, project ID, environment, severity, runbook URL, dashboard URL, and recent audit or deployment context.

| Alert | Severity | Trigger | Required routing and action |
| --- | --- | --- | --- |
| Failed deployment | Page for production, ticket for non-production | Deployment fails, rollout exceeds SLO, pods crash loop, image pull fails, or readiness never succeeds. | Notify project owner and platform on-call for production; link to pipeline, rollout events, logs, and rollback control. |
| Certificate failure | Page when production certificate is expired or expires soon; ticket for issuance/renewal failure | cert-manager `Certificate` not ready, ACME challenge failed, DNS validation failed, or expiration is inside the warning window. | Notify project owner and platform routing owner; link to domain verification and certificate reissue actions. |
| Runner failure | Ticket unless production deployment queue is blocked, then page | Runner registration fails, assigned runner offline, runner has not checked in, CI jobs stuck beyond threshold, or runner executor errors exceed threshold. | Notify platform CI owner; link to GitLab runner, jobs, and registration audit event. |
| Namespace quota exhaustion | Ticket at warning threshold, page if production deployments are blocked | CPU, memory, storage, pod, service, ingress, or secret usage exceeds configured warning or critical threshold. | Notify project owner and tenant admin; link to quota page, top workloads, and plan upgrade or limit-change workflow. |

Recommended thresholds:

- Failed deployment: alert immediately on failed production rollout; alert after two consecutive non-production failures for the same project and environment.
- Certificate failure: warning at 21 days to expiry, critical at 7 days to expiry, page on expired production certificate or failed renewal after retry budget.
- Runner failure: alert when runner is offline for 10 minutes, registration fails once, or queued jobs wait longer than the environment SLO.
- Namespace quota exhaustion: warning at 80%, critical at 90%, block and page production owner at 100% or when Kubernetes rejects resource creation.

## Runbooks and ownership

Each alert and admin action must link to a runbook that covers customer impact, diagnostic queries, rollback or mitigation, escalation path, and audit events to verify after the action. Platform operations owns shared infrastructure, tenant admins own plan and quota decisions, and project owners own application-level deployment failures unless the failure is caused by Divband infrastructure.
