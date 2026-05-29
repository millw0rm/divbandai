# Security model

## Authorization roles

- `owner`: full project, member, domain, secret, deployment, and billing control.
- `admin`: manage domains, secrets, deployments, and members except ownership transfer and billing-critical actions.
- `developer`: push code, request deployments, view non-secret configuration, and use AI drafts.
- `viewer`: read project status, deployment history, logs, and non-secret configuration metadata.

## Project isolation

Every API, worker, CI, and runtime operation must enforce a project boundary before accessing GitLab, Kubernetes, DNS, logs, metrics, domains, secrets, or registry artifacts.

Required controls:

- One GitLab repository per project.
- One Kubernetes namespace per project.
- Namespace-scoped service account and RBAC.
- Default-deny network policy with explicit allow rules.
- Per-project container image names or tags.
- Per-project audit trail for lifecycle, domain, secret, and deployment actions.

## Secrets

Secrets must not be committed to Git or exposed through dashboard responses, logs, AI context, or build output.

Secret-handling requirements:

- Store production secrets in a secret manager or External Secrets provider.
- Synchronize only the minimum required secret values into project namespaces.
- Scope CI/CD variables to the owning GitLab project and environment.
- Redact secrets before sending logs, diffs, or repository context to AI systems.
- Rotate deploy tokens, runner credentials, and custom-domain verification tokens on compromise or project transfer.

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
