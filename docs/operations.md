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

## MVP provisioning runbook: API request to live hostname

This runbook describes the concrete MVP path for one project. The backend owns
per-project provisioning; Terraform owns shared infrastructure prerequisites and
keeps per-project modules as contracts to avoid duplicate ownership. Platform
bootstrap order and automation are defined in
[`docs/infrastructure-orchestration.md`](infrastructure-orchestration.md).

### Prerequisites

- `GITLAB_URL`, `GITLAB_TOKEN` or `GITLAB_ACCESS_TOKEN`, and optionally
  `GITLAB_NAMESPACE_ID` are configured for the backend service account.
- Shared Kubernetes infrastructure exists: cluster credentials for `kubectl`, an
  ingress or Gateway controller, cert-manager, External Secrets, and the
  `ClusterSecretStore` referenced by `EXTERNAL_SECRET_STORE_NAME`.
- `KUBERNETES_TEMPLATE_DIR` points at `infra/k8s/base` or an equivalent rendered
  template directory. Set `KUBERNETES_APPLY=true` only in environments where the
  API worker should apply manifests directly.
- DNS verification uses public TXT lookups. The `.test` and manual observed-token
  shortcuts are disabled unless `DIVBAND_ALLOW_TEST_DNS_VERIFICATION=true` is set
  in a non-production test environment. Delegated managed DNS uses the configured
  `DNS_PROVIDER` adapter; credentials such as `DNS_PROVIDER_TOKEN` must come from
  backend secrets, not tenant input or domain business logic.

### Flow

1. **Create the project record.** `POST /projects` validates the organization,
   normalizes the slug, and stores the lifecycle plan: GitLab path, Kubernetes
   namespace, platform hostname, and runner tag.
2. **Provision GitLab.** `POST /projects/{id}/gitlab-repository` calls the
   GitLab adapter. The adapter creates or reuses the GitLab project, configures
   Divband CI/CD variables and protected project secrets, protects the default
   branch, and creates either a deploy token or project access token for runtime
   pulls. AI workflows use the same adapter to create branches, open merge
   requests, and trigger GitLab pipelines.
3. **Provision Kubernetes.** `POST /projects/{id}/kubernetes-namespace` renders
   the `infra/k8s/base` templates with project ID, slug, tenant, owner,
   environment, quota, image, hostname, ingress, TLS, and External Secrets
   values. When `KUBERNETES_APPLY=true`, the backend runs `kubectl apply -f -`;
   otherwise the response includes the rendered manifest bundle for an operator
   or GitOps controller to apply.
4. **Attach the platform hostname.** `POST /projects/{id}/platform-subdomain`
   marks the default platform hostname active after the shared wildcard DNS and
   ingress route are available. The rendered ingress points at the public service
   in the tenant namespace and requests TLS through the configured cluster issuer.
5. **Deploy application code.** `POST /projects/{id}/deployments` records a
   deployment and GitLab CI builds/publishes images. Deployment jobs update
   `/projects/{id}/deployments/report` with pipeline IDs, commit SHAs, image
   digests, ingress hostname, health-check URL, and rollout state.
6. **Verify custom domains.** `POST /projects/{id}/domains` returns a TXT record
   named `_divband.<hostname>` with value `divband-verification=<token>`. For
   delegated zones, the managed-DNS adapter creates that TXT record and later
   creates hostname, wildcard, and DNS-01 records through the same provider
   abstraction. `POST /projects/{id}/domains/{domainId}/verify` performs a real
   TXT lookup before marking the domain verified and requesting certificate
   issuance.
7. **Track certificate readiness.** Certificate status is read from cert-manager
   `Certificate` resources or ingress/Gateway readiness labels when Kubernetes is
   the provider. If `CERTIFICATE_STATUS_PROVIDER=dns_provider`, the configured
   DNS-provider status command supplies `issued`, `pending`, or `failed` state.
8. **Confirm live traffic.** Operators verify the hostname resolves to the shared
   ingress, TLS is issued, the latest deployment is `succeeded`, and project logs
   and metrics include `divband.io/project-id`, `divband.io/tenant-id`, and
   `divband.io/environment` labels.

### Rollback and failure handling

- If GitLab provisioning fails, retry the GitLab step after validating token
  scopes and namespace permissions. The adapter is idempotent for existing
  projects and variables.
- If Kubernetes rendering fails, inspect unresolved `REPLACE_WITH_*` tokens and
  template changes before enabling `KUBERNETES_APPLY` again.
- If Kubernetes apply fails, run the rendered manifest through `kubectl apply
  --dry-run=server -f -` and check admission, quota, External Secrets, and
  cert-manager prerequisites.
- If DNS verification fails, query the TXT record with `dig TXT
  _divband.<hostname>` and wait for DNS propagation before retrying. Legacy
  `_divband-challenge.<hostname>` records are still accepted during migration.
- If certificate issuance stays pending, inspect cert-manager `Certificate`,
  `CertificateRequest`, `Order`, and `Challenge` resources and confirm the
  ingress or Gateway route references the expected hostname and TLS secret.

## Platform administration operations

Platform operations are performed through audited `/admin/*` API routes and the dashboard pages prefixed with `Admin:`. Operators must authenticate as normal users and have an active platform administrator binding; project owners or project admins are intentionally denied unless they also hold a platform administrator binding.

Recommended operational workflow:

1. Bootstrap the first `super_admin` by registering the initial account in a fresh environment, then grant named platform administrators with `POST /admin/platform-admins`.
2. Use **Admin: user/org search** for support lookup before changing tenant state.
3. Use **Admin: project lifecycle** to inspect archived, failed, or suspended projects across organizations.
4. Use **Admin: DNS/certificates** and **Admin: runner status** during incident response for certificate issuance, DNS verification, and runner health.
5. Use **Admin: failed deployments** to triage failed jobs before contacting a tenant.
6. Use **Admin: audit events** to verify operator actions and project changes.
7. Use **Admin: abuse actions** to record warnings, suspensions, unsuspensions, or deployment restrictions. Every action should include a human-readable reason suitable for support review.

Admin route reads and writes are audit-recorded with the actor ID and route path. Suspension state is stored on the target record while the abuse action remains immutable history, so incident reviews can reconstruct who acted, what changed, and why.

## Backup and restore runbook

Use this runbook before enabling public signup and after every persistence-schema change.

1. Capture a database snapshot from the production persistence adapter and store it in the encrypted backup bucket with date, git SHA, and environment labels.
2. Capture object-storage metadata for the `staging` and `sites` prefixes and verify that lifecycle policies do not delete live versions.
3. Restore the database snapshot into an isolated restore environment with production secrets replaced by restore-only credentials.
4. Run the automated restore check:

   ```sh
   npm run smoke:restore --workspace @divband/backend
   ```

5. Run a control-plane smoke test against the restored environment: register or invite a test user, verify email, create a project, attach the platform subdomain, and trigger a deployment.
6. Compare restored counts for users, organizations, projects, domains, deployments, published sites, audit events, and abuse actions against the source snapshot.
7. Record the restore duration, snapshot age, object-storage consistency result, and any skipped resources in the incident log.

Restore tests must run on a schedule and after every production migration. A failed restore test blocks public signup and paid-plan upgrades.

## Monitoring and alerting

The platform-admin monitoring surface is `GET /admin/monitoring/signals`. Alerts must page or ticket on these components:

### Auth monitoring

Track registration spikes, login failures, email verification failures, password reset volume, rate-limit blocks, suspended-user access attempts, and session revocations. Page security for sustained credential-stuffing signals or reset-token abuse.

### Deployment monitoring

Track queued/running deployment age, failed deployments, rollback attempts, abuse-restricted projects, deployment rate-limit blocks, and monthly quota exhaustion. Page operations when production deployments fail repeatedly or remain queued beyond the SLO.

### DNS monitoring

Track unverified custom domains, duplicate hostname attempts, failed TXT verification, and verified domains whose records no longer point at the expected ingress. Ticket tenant-facing DNS drift and page for platform wildcard DNS failures.

### Certificate monitoring

Track requested, issued, failed, and near-expiry certificates. Page before expiration reaches the renewal SLO and immediately for issuance failures on active verified domains.

### Runner monitoring

Track runner registration, active job count, stale runners, failed jobs, untagged runner use, and projects without their expected runner tag. Page for degraded runner pools or deployment jobs running on unexpected tags.

### Storage monitoring

Track upload-plan expiry, missing objects, checksum mismatches, scanner failures, object-copy failures, bucket policy drift, backup completion, and restore-test success. Page for scanner bypass attempts, live object loss, or failed scheduled restore tests.

## End-to-end public-signup smoke test

Before switching `DIVBAND_SIGNUP_MODE=public`, run:

```sh
npm run smoke:controls --workspace @divband/backend
```

The smoke test covers invite-gated signup, email verification, login, project creation, platform-hostname attachment, deployment trigger, project-status live access, password reset, and post-reset login. Public signup remains invite-only until this smoke test and the restore smoke test pass in the target environment.
