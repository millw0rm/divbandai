# Tenancy model

## Tenant entities

- **User**: an authenticated human or service account.
- **Organization**: optional grouping for teams, billing, and shared ownership.
- **Project**: the deployable website or application unit.
- **Environment**: production, preview, staging, sandbox, or other project-scoped runtime.
- **Domain**: platform hostname or verified custom hostname attached to one project.
- **Namespace**: Kubernetes runtime boundary that contains a single project's workloads and secrets.

## Tenant isolation

Each project is treated as a separate tenant workload even when multiple projects belong to the same user or organization. The control plane must resolve the caller, organization membership, project role, and requested project before it touches GitLab, Kubernetes, DNS, secrets, logs, or billing metadata.

Isolation rules:

- Project metadata is keyed by immutable project ID, not only by mutable slug.
- Runtime resources are labeled with project ID, organization ID, environment, owner, and lifecycle state.
- Secrets, logs, build variables, runner tokens, and namespace objects are never shared across projects.
- Cross-project reads require explicit platform-admin tooling and audit logs.

## Per-project namespaces

Every project receives a Kubernetes namespace named `project-{slug}`. The namespace is private to that project and contains only that project's workloads, secrets, services, routes, and service accounts.

Required namespace controls:

- `ResourceQuota` for CPU, memory, storage, pods, services, and ingress or route objects.
- `LimitRange` defaults to prevent unbounded containers.
- Default-deny `NetworkPolicy` for ingress and egress, with explicit exceptions for ingress, DNS, registry pulls, telemetry, and approved platform services.
- Namespace-scoped service account used by the GitLab deploy job.
- Labels for project ID, organization ID, owner, environment, and lifecycle state.

## DNS ownership and domains

`{slug}.divband.ir` is reserved by the platform when the project is created. Custom domains, such as `project2.com`, require ownership verification before traffic is served.

Custom-domain process:

1. User adds a hostname in the dashboard.
2. Backend returns a TXT verification record and optional CNAME or A/AAAA target instructions.
3. Backend periodically checks DNS until the verification token is present.
4. Backend creates or updates routing and certificate resources only after ownership is verified.
5. Domain remains bound to exactly one active project until it is removed or released.

## Routing

Routing is host based. Platform subdomains and custom domains both point to the shared ingress or Gateway API layer, but the selected backend service must live in the target project's namespace.

Routing data should include:

- Hostname.
- Project ID.
- Namespace.
- Service name and port.
- Certificate status.
- Verification status.
- Last successful health check.

## GitLab integration

Each divband project maps to one GitLab project under a user or organization group.

Recommended path:

```text
git.divband.ir/{organization-or-user}/{project-slug}
```

Each project gets:

- Protected default branch.
- Container registry access.
- Project-scoped CI/CD variables.
- Runner tags such as `divband-{project-slug}`.
- Deploy token or project access token with minimum required permissions.
- Merge-request based deployment workflow for reviewed changes.

## Lifecycle states

- `draft`: metadata exists only in the dashboard.
- `repository_provisioned`: GitLab project exists.
- `namespace_provisioned`: Kubernetes namespace and base policy exist.
- `building`: GitLab CI is building artifacts.
- `deployed`: production route points to a healthy workload.
- `domain_pending_verification`: custom DNS ownership is not verified yet.
- `domain_active`: custom DNS, routing, and TLS are active.
- `failed`: provisioning, build, deploy, or domain setup failed.
- `archived`: project is disabled but retained for recovery, billing, or audit purposes.

State transitions must be idempotent so failed provisioning steps can be retried safely.
