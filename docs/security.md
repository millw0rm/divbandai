# Security model

Related docs: [`tenancy.md`](tenancy.md), [`operations.md`](operations.md), [`architecture.md`](architecture.md), [`product.md`](product.md).

Automatic Kubernetes provisioning on project create runs with the control-plane backend's cluster credentials (`KUBERNETES_APPLY=true`). Tenant isolation still depends on per-project namespaces (`project-{slug}`), RBAC, network policy, and host-based routing — see [`infra/k8s/README.md`](../infra/k8s/README.md).

## Identity model

The control plane has first-class records for:

- **Users**: human accounts identified by email and name.
- **Organizations/teams**: shared workspaces that own projects and hold organization membership.
- **Projects**: isolated hosting units that map to one GitLab repository, one Kubernetes namespace, DNS records, deployments, logs, and secrets.
- **Project memberships**: the source of truth for project-scoped authorization. Every project operation must resolve the caller to a membership before touching downstream systems.
- **Sessions**: short-lived bearer credentials created by local login or optional OAuth/OIDC login. Only keyed token hashes are persisted; session records track creation, expiry, last use, and revocation.
- **API tokens**: revocable bearer credentials owned by a user. Tokens can be scoped to a project and an effective project role, and only keyed token hashes are persisted.
- **OAuth/OIDC identities**: optional external identity links keyed by provider, issuer, and subject.
- **GitLab identity links**: optional user-to-GitLab links used when a user needs access to generated repositories.

## Authorization roles

Project roles are hierarchical for assignment purposes, but every API method checks explicit permissions rather than relying on hierarchy alone.

- `owner`: full project, member, token, domain, secret, deployment, GitLab, Kubernetes, and archive control.
- `admin`: manage domains, secrets, deployments, members, API tokens, GitLab repository provisioning, and Kubernetes namespace provisioning except owner-only archive/ownership-sensitive actions.
- `developer`: trigger deployments, view project status/logs/non-secret metadata, read masked environment variable metadata, and use AI-assisted change workflows.
- `viewer`: read project status, deployment history, logs, and non-secret configuration metadata.

## Permission matrix

| Permission | Owner | Admin | Developer | Viewer |
| --- | --- | --- | --- | --- |
| `project:read` | Yes | Yes | Yes | Yes |
| `project:admin` | Yes | Yes | No | No |
| `project:archive` | Yes | No | No | No |
| `project:provision_gitlab` | Yes | Yes | No | No |
| `project:provision_kubernetes` | Yes | Yes | No | No |
| `domain:manage` | Yes | Yes | No | No |
| `deployment:trigger` | Yes | Yes | Yes | No |
| `secret:read` | Yes | Yes | Yes | No |
| `secret:manage` | Yes | Yes | No | No |
| `member:manage` | Yes | Yes | No | No |
| `token:manage` | Yes | Yes | No | No |
| `ai:request_change` | Yes | Yes | Yes | No |

Assignment rules:

- Owners can assign `owner`, `admin`, `developer`, and `viewer` roles.
- Admins can assign `admin`, `developer`, and `viewer` roles.
- Developers and viewers cannot change memberships or create project API tokens.
- API tokens can only be minted with roles the current actor is allowed to assign.

## API enforcement requirements

Backend handlers must authenticate the request, resolve the target project, load the caller's project membership, and check the permission required for the route before invoking any integration boundary.

Required checks by integration:

- **GitLab**: require `project:provision_gitlab` and a linked GitLab identity before creating or reconciling repositories, runner tags, or generated-repository access.
- **Kubernetes**: require `project:provision_kubernetes` before namespace or RBAC provisioning.
- **DNS and TLS**: require `domain:manage` before adding a platform subdomain, creating a custom-domain challenge, verifying DNS, or requesting certificates.
- **Deployments**: require `deployment:trigger` before starting builds or deployments.
- **Secrets/environment variables**: require `secret:read` for masked metadata reads or explicit raw-value reveal, and `secret:manage` for writes/deletes.
- **Logs/status**: require `project:read` before returning project status, deployment details, or logs.
- **Memberships/API tokens**: require `member:manage` or `token:manage` respectively.
- **Project archival**: require `project:archive`.

If the user has no membership, a project-scoped API token targets a different project, or the role lacks the required permission, the API must fail before calling GitLab, Kubernetes, DNS, certificate, deployment, or secret-management services.

## Instant static hosting limits and abuse controls

Instant static hosting is intentionally safe-by-default so agents can publish previews without turning the platform into durable anonymous storage.

### Anonymous publishing tier

- Anonymous publishes expire after 24 hours and cannot request a longer TTL.
- Each anonymous publish is limited to 100 files, 10 MiB per file, and 50 MiB total uploaded bytes.
- Anonymous publishing is throttled per source IP to 10 publishes per hour, with stricter fallback limits when abuse signals are present.
- Slugs must include a cryptographically random, unguessable suffix; caller-supplied vanity slugs are not accepted for anonymous publishes.
- Anonymous publishes cannot attach custom domains, enable password protection, or access analytics beyond operational logs.

### Account and paid-tier gates

- Free accounts may keep permanent sites while they remain within the free storage cap, site count cap, and custom-domain allowance documented in pricing.
- Free analytics are disabled or limited to coarse aggregate counters so visitor-level analytics remain a paid feature.
- Paid tiers may raise storage, site, custom-domain, and publish-rate limits and may unlock password protection, analytics, vanity handles, and organization controls.
- Tier decisions must be enforced before accepting upload sessions, attaching domains, setting passwords, creating vanity handles, or exposing analytics exports.

### Abuse prevention requirements

- HTML uploads must be scanned for phishing patterns such as credential-collection forms, brand impersonation strings, suspicious external form actions, and obfuscated redirects.
- Uploaded file hashes must be checked against configured malware, phishing-kit, and known-bad content feeds before finalization.
- Dangerous executable or active-content MIME types must be blocked for static hosting, including native executables, shell scripts, server-side scripts, browser extensions, and ambiguous binary uploads not needed for static sites.
- Public pages must link to an abuse-report endpoint, and every report must create a tracked abuse case with reporter contact, URL, reason, evidence, timestamps, and current site owner or source IP metadata.
- The takedown workflow must support quarantine, owner notification, evidence preservation, reviewer decision, appeal, and permanent deletion after the retention window.
- Gateways and API handlers must apply both per-IP and per-ASN throttling so botnets and cloud-provider bursts cannot bypass single-IP limits.
- When abuse thresholds are exceeded but content is not yet confirmed malicious, the platform may fall back to a shorter one-hour TTL, disable custom-domain attachment, or require account verification before accepting more publishes.


## MVP authentication model

The MVP supports local email/password accounts, bearer sessions, optional OAuth/OIDC identity links, project-scoped API tokens, and GitLab identity links. Local passwords are hashed with Node's `scrypt` password-hashing primitive using per-password random salts and parameters encoded in the stored hash. Legacy demo hashes are accepted only long enough to verify a login and are rehashed immediately after successful authentication.

Session requirements:

- The API uses an explicit bearer-token policy for the MVP: clients send `Authorization: Bearer <token>` and the backend does not issue JavaScript-readable cookies. If a browser deployment later adopts cookies, they must be `HttpOnly`, `Secure`, `SameSite=Lax` or stricter, and protected by CSRF controls for unsafe methods.
- Session token secrets are returned once at register/login, then only an HMAC-SHA-256 token hash is stored.
- Bearer sessions expire after 14 days, can be revoked with `POST /auth/logout` for the current session or `DELETE /auth/sessions/{sessionId}` for another user-owned session, and expired sessions are deleted by authentication-time cleanup plus `POST /auth/sessions/cleanup`.
- Session storage tracks creation time, expiration time, last use, optional OAuth/OIDC provider metadata, and revocation time.
- Session validation must reject unknown, expired, or revoked tokens before any project authorization check.

API token and linked-token requirements:

- API token secrets are generated as high-entropy opaque bearer strings and returned only once at creation time.
- Store only keyed hashes for API tokens and GitLab access tokens; never persist the raw bearer string.
- Support project scoping, effective project role scoping, expiration, revocation, and last-used tracking.
- Apply the lower/effective scoped authorization at request time before project access.

Local-development exceptions:

- `DIVBAND_TOKEN_HASH_PEPPER` should be set in shared or production environments. If it is absent, the backend uses a documented local-development pepper so a single-process demo can run without extra setup.
- Local development may use bearer tokens over `http://localhost`; non-local deployments must terminate TLS before accepting bearer credentials.

## OAuth/OIDC integration

OAuth/OIDC is optional and additive to local authentication.

- Link identities by provider, issuer, and subject.
- Treat the issuer and subject tuple as stable identity material.
- Do not trust mutable claims such as display name for authorization.
- Map external groups to organizations/teams only through explicit provisioning rules.
- Continue to enforce divband project memberships after external authentication succeeds.

## GitLab identity linking

Generated repositories are project resources and GitLab access must stay aligned with divband membership.

- Users who provision or directly access generated repositories must link a GitLab identity.
- GitLab user IDs and usernames may be stored; GitLab access tokens must be stored hashed or in a secret manager.
- Repository membership reconciliation must derive access from divband project membership.
- Removing a divband project membership must revoke corresponding generated-repository access.
- GitLab runner and deploy credentials remain project-scoped service credentials, not user credentials.

## Project isolation

Every API, worker, CI, and runtime operation must enforce a project boundary before accessing GitLab, Kubernetes, DNS, logs, metrics, domains, secrets, or registry artifacts.

Required controls:

- One GitLab repository per project.
- One Kubernetes namespace per project.
- Namespace-scoped service account and RBAC.
- Default-deny network policy with explicit allow rules.
- Per-project container image names or tags.
- Per-project audit trail for lifecycle, domain, secret, member, token, and deployment actions.

## Secrets

Secrets must not be committed to Git or exposed through dashboard responses, logs, AI context, or build output.

Project environment variable requirements:

- Project environment variables are not stored on the in-memory `Project` object. The control plane stores encrypted records keyed by project ID and variable key.
- The MVP encrypted store uses AES-256-GCM before persistence. `DIVBAND_SECRET_ENCRYPTION_KEY` must be configured in shared or production environments; local development falls back to a documented static development key only to keep the demo runnable.
- `GET /projects/{projectId}/environment-variables` returns masked values only, even for callers with `secret:read`.
- Raw values may be returned only by the explicit reveal flow `GET /projects/{projectId}/environment-variables/{key}/value` with `secret:read` authorization and `X-Divband-Secret-Read: reveal`; every reveal is audited.
- Writes and deletes require `secret:manage`; write responses return masked values only.

Secret-handling requirements:

- Store production secrets in a secret manager or External Secrets provider when available; the encrypted MVP store is the minimum acceptable persistent fallback.
- Synchronize only the minimum required secret values into project namespaces or GitLab CI/CD variables.
- Scope CI/CD variables to the owning GitLab project and environment.
- Redact secrets before sending logs, diffs, or repository context to AI systems.
- Rotate deploy tokens, runner credentials, API tokens, session secrets, secret-encryption keys, and custom-domain verification tokens on compromise or project transfer.

## RBAC

RBAC is enforced in both the divband control plane and Kubernetes.

- The backend checks project membership and role before starting orchestration.
- Kubernetes deploy service accounts are namespace scoped.
- CI jobs receive only the credentials required for the target project and environment.
- Platform-admin access is separate from customer roles and must be audited.

## Custom domains and TLS

Custom domains can serve traffic only after DNS ownership is verified.

Security requirements:

- Require TXT-based ownership verification for apex and subdomain attachments.
- Prevent the same hostname from being active on two projects at once.
- Issue TLS certificates only after verification succeeds.
- Renew certificates automatically and alert before expiration.
- Disable routes quickly when verification is revoked, ownership changes, or abuse is detected.

## Runner boundaries

GitLab runners are a trust boundary because jobs can build images, access variables, and deploy to namespaces.

Runner requirements:

- Use project-specific runner tags for jobs that can access deploy credentials.
- Keep deploy credentials out of shared runners whenever possible.
- Run untrusted build steps without production deploy credentials.
- Prefer ephemeral runner environments and clean workspaces after every job.
- Limit registry, Kubernetes, and secret-manager permissions to the current project.

## Platform administrator model

Divband separates platform administration from tenant/project authorization. Project roles (`owner`, `admin`, `developer`, and `viewer`) only grant permissions within a project membership; they do not grant access to platform-wide support, security, operations, or abuse routes. Platform administrators are stored as a separate identity binding with a platform role (`support`, `security`, or `super_admin`) and are attached to an authenticated user session independently of project memberships.

The MVP bootstrap grants the first registered user `super_admin` when no platform administrator exists. After bootstrap, platform administrators can grant or revoke platform administrator bindings through audited `/admin/platform-admins` endpoints. API tokens remain scoped by user/project membership and do not create project access elevation: project authorization continues to call project membership checks, while `/admin/*` routes require an active platform administrator binding.

All `/admin/*` routes are admin-only and audit route access. Current audited surfaces include:

- `GET /admin/users` and `GET /admin/organizations` for support search.
- `GET /admin/projects` for lifecycle and suspension visibility.
- `GET /admin/domains` for DNS verification and certificate state.
- `GET /admin/runners/health` for runner health summaries.
- `GET /admin/deployments/failures` for deployment failure triage.
- `GET /admin/audit-events` for recent audit review.
- `GET/POST /admin/abuse-actions` for warning, suspension, unsuspension, and deployment restriction records.

Abuse and suspension actions are also stored independently from project roles. A platform administrator can suspend a user, organization, or project without becoming a project owner/admin and without mutating project memberships.

## Public signup production gate

Public self-service signup remains **invite-only by default**. The backend reads `DIVBAND_SIGNUP_MODE`; any value other than `public` requires a valid `inviteCode` from `DIVBAND_SIGNUP_INVITE_CODES` after the first bootstrap administrator has registered. Do not set `DIVBAND_SIGNUP_MODE=public` until the controls below are enabled, tested, monitored, and included in the on-call runbook.

Required controls now enforced by the backend:

- **Email verification**: registration creates an expiring verification challenge, login and authenticated platform features require `emailVerifiedAt`, and test/local environments can expose a token with `DIVBAND_EXPOSE_AUTH_TOKENS=1` for automated smoke tests.
- **Password reset**: reset requests create expiring, single-use challenges; confirmation rotates the password hash and revokes existing sessions.
- **Rate limiting**: auth routes, publish mutations, and deployment triggers consume per-client buckets before route handling.
- **Abuse controls**: static publishes are rejected for executable payloads, known phishing path patterns, and blocked binary content types; hosted app deployments are blocked for known abuse markers and platform-admin `restrict_deployments` actions.
- **Tenant quotas and billing state**: organizations default to the free trial tier, project/domain/deployment quotas are enforced, and `past_due` or `cancelled` tenants cannot create or mutate hosted resources.
- **Suspension boundaries**: user, organization, and project suspensions prevent authenticated actions or hosted resource mutations without changing project membership.

Operational rule: if any of these controls regress, immediately set `DIVBAND_SIGNUP_MODE=invite_only` or remove public invite codes, then use the abuse and billing admin endpoints to freeze affected tenants.
