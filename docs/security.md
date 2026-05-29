# Security model

## Authorization roles

- `owner`: full project and billing control.
- `admin`: manage domains, secrets, deployments, and members.
- `developer`: push code, request deployments, and use AI drafts.
- `viewer`: read project status, logs, and configuration metadata.

## Mandatory controls

- Enforce project-scoped authorization before any GitLab, Kubernetes, DNS, or secret operation.
- Never expose one project's secrets, logs, namespaces, GitLab variables, or runner tokens to another project.
- Use namespace-scoped Kubernetes RBAC.
- Use default-deny network policy.
- Store secrets in a secret manager or External Secrets provider, not in Git.
- Redact secrets before sending context to AI systems.
- Require DNS ownership verification before serving custom domains.
- Prefer merge requests and CI checks over direct production writes.

## Runner isolation

Project jobs must use project-specific runner tags. Shared runners may be allowed only for untrusted build steps that cannot access production deploy credentials.
