# divband

`divband` is a multi-tenant website platform for hosting separate customer projects on platform subdomains such as `project1.divband.ir` and verified custom domains such as `project2.com`.

The platform provisions a private GitLab project, isolated GitLab runner configuration, Kubernetes namespace, routing, TLS, and dashboard workspace for every hosted project.

## Product planning

- `docs/product.md` is the product source of truth for vision, MVP scope, user journeys, implementation status, backlog, open decisions, and release readiness. Start there when resuming product planning or prioritization.
- `docs/local-mvp.md` describes the repeatable smallest useful local run path, including root scripts, mocked dependencies, and a smoke scenario.
- `docs/tasks.md` tracks actionable backlog tasks for automated testing and delegated DNS/nameserver support.
- `docs/vm-reference-architecture.md` maps VM topologies to the Ansible inventory groups for persistent MVP infrastructure.
- `docs/mvp-business-readiness.md` explains the difference between an operator-run MVP pilot and a public paid business launch.

## Repository map

- `apps/backend` — platform API for project lifecycle, GitLab, Kubernetes, DNS, deployments, and AI-assisted change requests.
- `apps/frontend` — minimal customer dashboard and AI chat workspace.
- `packages/auth` — shared authentication and authorization policy definitions.
- `infra/ansible` — VM-IP based bootstrap playbooks for k3s, ingress, cert-manager, External Secrets, GitLab, runners, observability, and the Divband control plane.
- `infra/k8s` — Kubernetes namespace, routing, policy, quota, and deployment templates.
- `infra/gitlab` — GitLab CI templates and project/runner provisioning notes.
- `infra/terraform` — Terraform modules for GitLab projects, Kubernetes tenants, and DNS/custom-domain records.
- `docs` — architecture, tenancy, security, deployment, domains, AI workflow, and operational runbooks.
- `demo` — safe examples, demos, and walkthroughs that show how projects should behave before production hardening.
- `sandbox` — draft area for experiments and unshipped ideas; nothing here should be deployed automatically.

## Current status

This repository currently defines the initial platform skeleton, interfaces, infrastructure templates, and a VM-IP based Ansible bootstrap path for operator-run MVP pilots. Production integrations must replace placeholder values before deployment, and public-business readiness is tracked separately from infrastructure bootstrap readiness.
