# divband architecture

## Purpose

`divband` hosts many independently owned websites and applications on shared infrastructure while keeping each project isolated. A project can be reached through a platform subdomain such as `project1.divband.ir` or through a verified custom domain such as `project2.com`.

## Core services

1. **Frontend dashboard**: lets users create projects, connect domains, inspect deployments, manage secrets, and ask an AI assistant to draft features.
2. **Backend platform API**: orchestrates users, projects, GitLab repositories, GitLab runners, Kubernetes namespaces, routes, DNS verification, deployments, and audit logs.
3. **Auth package**: centralizes users, organizations, project roles, permissions, and project-scoped access checks.
4. **GitLab integration**: creates one GitLab project per divband project under `git.divband.ir`, configures CI/CD variables, and assigns project-specific runner tags.
5. **Kubernetes runtime**: creates one private namespace per project with resource quotas, network policies, service accounts, and host-based routing.
6. **DNS and routing**: maps `{project}.divband.ir` and verified custom hostnames to the ingress or Gateway API layer.
7. **AI workflow**: turns chat requests into draft branches and merge requests instead of direct production edits.

## Request flow

1. A browser requests `project2.com` or `project2.divband.ir`.
2. DNS points the hostname to divband ingress infrastructure.
3. The ingress/Gateway routes by HTTP `Host` header.
4. The route selects the service in the project namespace.
5. The service serves the deployed version for that project.

## Provisioning flow

1. User creates a project in the dashboard.
2. Backend stores project metadata and validates the slug.
3. Backend creates a GitLab project under `git.divband.ir`.
4. Backend provisions a Kubernetes namespace named `project-{slug}`.
5. Backend applies quota, RBAC, network policy, service account, deployment, service, and route templates.
6. Backend attaches `{slug}.divband.ir`.
7. CI builds and deploys the first version.
8. User can add custom domains after DNS ownership verification.

## Isolation boundaries

- GitLab repository per project.
- GitLab runner tags per project.
- Kubernetes namespace per project.
- Namespace-scoped service account and RBAC.
- Default-deny network policy.
- Per-project secrets and CI/CD variables.
- Per-project audit events.
