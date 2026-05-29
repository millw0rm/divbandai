# divband architecture

## Platform purpose

`divband` is a multi-tenant website hosting platform for isolated customer projects. Each project can be published on a managed platform subdomain such as `project1.divband.ir` and can also attach a verified custom domain such as `project2.com`.

The platform owns the control plane for users, projects, GitLab repositories, CI/CD, Kubernetes namespaces, routing, DNS verification, certificates, audit events, and billing-facing lifecycle state. Customer code runs in project-scoped runtime boundaries rather than directly in the shared control plane.

## Monorepo layout

```text
divband/
├── apps/
│   ├── frontend/        # User dashboard
│   └── backend/         # Platform API and orchestration service
├── packages/
│   └── auth/            # Shared authentication and authorization logic
├── infra/
│   ├── k8s/             # Kubernetes manifests or Helm chart templates
│   ├── terraform/       # Cloud, DNS, GitLab, runner, registry, and cluster resources
│   └── gitlab/          # GitLab project, group, CI/CD, and runner templates
└── docs/                # Architecture, tenancy, security, operations, domains, and workflows
```

## Core services

1. **Frontend dashboard (`apps/frontend`)**: lets users create projects, connect domains, inspect deployments, manage secrets, invite members, and ask an AI assistant to draft reviewed changes.
2. **Backend platform API (`apps/backend`)**: orchestrates users, projects, GitLab repositories, GitLab runners, Kubernetes namespaces, routes, DNS verification, deployments, certificates, and audit logs.
3. **Auth package (`packages/auth`)**: centralizes identities, organizations, project roles, permissions, and project-scoped access checks that can be reused by the API and future workers.
4. **GitLab integration (`infra/gitlab`)**: creates one GitLab project per divband project, configures CI/CD variables, and assigns project-specific runner tags.
5. **Kubernetes runtime (`infra/k8s`)**: creates one private namespace per project with resource quotas, network policies, service accounts, workloads, services, and host-based routes.
6. **Terraform stacks (`infra/terraform`)**: provision durable resources such as cloud primitives, DNS zones and records, GitLab groups/projects, runners, registries, and Kubernetes clusters.

## Request flow

### GitLab/Kubernetes workload path

1. A browser requests `project1.divband.ir` or `project2.com`.
2. DNS points the hostname to the divband ingress or Gateway API layer.
3. The ingress routes by HTTP `Host` header after TLS termination.
4. The route selects the service in the matching project namespace.
5. The service serves the deployed version for that project.
6. Logs, metrics, and audit events are tagged with the project ID and namespace.

### Instant static serving path

1. A browser requests `{slug}.divband.ir` or an assigned custom domain for an instant static site.
2. DNS points the hostname to the divband static serving edge rather than a project namespace ingress.
3. The serving layer resolves the HTTP `Host` header to a published static site record, not a Kubernetes workload.
4. Routing metadata maps `slug -> currentVersionId` so the active version can change atomically without moving files.
5. The request path maps to an object storage key using `sites/{slug}/versions/{versionId}/{path}`.
6. The static serving layer applies file resolution rules before reading object storage:
   - `/` serves `index.html`.
   - Direct file paths serve exact objects.
   - Subdirectories prefer their own `index.html`.
   - Unknown paths optionally fall back to `index.html` when `spaMode` is enabled.
   - Missing paths return a generated directory listing or a `404` response depending on site configuration.
7. Logs, metrics, and audit/abuse events are tagged with the static site ID, slug, host, and version ID.

## Provisioning flow

1. User creates a project in the dashboard.
2. Backend stores project metadata and validates the globally unique slug.
3. Backend creates a GitLab project under the owning user or organization path.
4. Backend provisions a Kubernetes namespace named `project-{slug}`.
5. Backend applies quota, RBAC, network policy, service account, deployment, service, and route templates.
6. Backend attaches the platform hostname `{slug}.divband.ir`.
7. GitLab CI builds and deploys the first version using the project runner tag.
8. User can add custom domains after DNS ownership verification succeeds.

## Isolation boundaries

- One GitLab repository per divband project.
- One Kubernetes namespace per project.
- Namespace-scoped service account and RBAC for deployment.
- Default-deny network policies for ingress and egress.
- Per-project secrets and CI/CD variables.
- Project-specific runner tags for jobs that can deploy.
- Per-project audit events and operational logs.
