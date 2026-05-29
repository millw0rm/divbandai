# Tenancy model

## Tenant entities

- **User**: an authenticated human or service account.
- **Organization**: optional grouping for teams and billing.
- **Project**: the deployable website/application unit.
- **Environment**: production, preview, staging, or sandbox.
- **Domain**: platform or custom hostname attached to a project.

## Namespace strategy

Every project receives a Kubernetes namespace named `project-{slug}`. The namespace is private to that project and contains only that project's workloads, secrets, services, routes, and service accounts.

Required namespace controls:

- `ResourceQuota` for CPU, memory, storage, pods, services, and ingresses/routes.
- `LimitRange` defaults to prevent unbounded containers.
- Default-deny `NetworkPolicy` for ingress and egress.
- Namespace-scoped service account used by the GitLab deploy job.
- Labels for project ID, organization ID, owner, environment, and lifecycle state.

## GitLab strategy

Each divband project maps to one GitLab project under `git.divband.ir`.

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

## Lifecycle states

- `draft`: metadata exists only in the dashboard.
- `repository_provisioned`: GitLab project exists.
- `namespace_provisioned`: Kubernetes namespace exists.
- `building`: GitLab CI is building artifacts.
- `deployed`: production route points to a healthy workload.
- `domain_pending_verification`: custom DNS ownership is not verified yet.
- `domain_active`: custom DNS and TLS are active.
- `failed`: provisioning, build, deploy, or domain setup failed.
- `archived`: project is disabled but retained.
