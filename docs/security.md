# Security model

## Identity model

The control plane has first-class records for:

- **Users**: human accounts identified by email and name.
- **Organizations/teams**: shared workspaces that own projects and hold organization membership.
- **Projects**: isolated hosting units that map to one GitLab repository, one Kubernetes namespace, DNS records, deployments, logs, and secrets.
- **Project memberships**: the source of truth for project-scoped authorization. Every project operation must resolve the caller to a membership before touching downstream systems.
- **Sessions**: short-lived bearer credentials created by local login or optional OAuth/OIDC login. Sessions track creation, expiry, last use, and revocation.
- **API tokens**: revocable bearer credentials owned by a user. Tokens can be scoped to a project and an effective project role, and must never be stored in plaintext.
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
- **Secrets/environment variables**: require `secret:read` for masked reads and `secret:manage` for writes/deletes.
- **Logs/status**: require `project:read` before returning project status, deployment details, or logs.
- **Memberships/API tokens**: require `member:manage` or `token:manage` respectively.
- **Project archival**: require `project:archive`.

If the user has no membership, a project-scoped API token targets a different project, or the role lacks the required permission, the API must fail before calling GitLab, Kubernetes, DNS, certificate, deployment, or secret-management services.

## Sessions and API tokens

Session requirements:

- Bearer sessions expire and can be revoked.
- Session storage tracks creation time, expiration time, last use, and optional OAuth/OIDC provider metadata.
- Session validation must reject unknown, expired, or revoked tokens.

API token requirements:

- Store only token hashes.
- Return the token secret only once at creation time.
- Support project scoping, effective project role scoping, expiration, revocation, and last-used tracking.
- Apply the lower/effective scoped authorization at request time before project access.

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

Secret-handling requirements:

- Store production secrets in a secret manager or External Secrets provider.
- Synchronize only the minimum required secret values into project namespaces.
- Scope CI/CD variables to the owning GitLab project and environment.
- Redact secrets before sending logs, diffs, or repository context to AI systems.
- Rotate deploy tokens, runner credentials, API tokens, session secrets, and custom-domain verification tokens on compromise or project transfer.

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
