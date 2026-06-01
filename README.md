# divband

`divband` is a multi-tenant website platform for hosting separate customer projects on platform subdomains such as `project1.divband.ir` and verified custom domains such as `project2.com`.

The platform provisions a private GitLab project, isolated GitLab runner configuration, Kubernetes namespace, routing, TLS, and dashboard workspace for every hosted project.

## Product planning

- `docs/product.md` is the product source of truth for vision, MVP scope, user journeys, implementation status, backlog, open decisions, and release readiness. Start there when resuming product planning or prioritization.
- `docs/mvp-scope.md` defines the minimal workable MVP: auth, projects, git + CI deploy, Kubernetes ingress, domain management, and agent instant publish — plus what to defer (multi-role RBAC, admin tooling, AI assistant).
- `docs/architecture.md` describes the monorepo layout, control-plane services, request and provisioning flows, agent publish path, infrastructure bootstrap, and current implementation maturity.
- `docs/local-mvp.md` describes the repeatable smallest useful local run path, including root scripts, mocked dependencies, and a smoke scenario.
- `docs/development-vs-production.md` contrasts the local development run path (`npm run dev:mvp`) with infrastructure and production deployment (`make deploy-production`, Ansible, Kubernetes, CI).
- [`Project auto-provision on k3s`](#project-auto-provision-on-k3s) (below) summarizes automatic tenant provisioning after the control plane is deployed.
- `infra/k8s/README.md` documents the welcome profile and full tenant manifest bundle applied per project.
- `docs/design-system.md` and `docs/design-tokens.json` capture the reusable design language extracted from the imported Divband Studio bundle.
- `docs/tasks.md` tracks actionable backlog tasks for automated testing and delegated DNS/nameserver support.
- `docs/vm-reference-architecture.md` maps VM topologies to the Ansible inventory groups for persistent MVP infrastructure.
- `docs/infrastructure-orchestration.md` defines Ansible vs Terraform ownership, bootstrap phase order, and the planner automation contract.
- `docs/mvp-business-readiness.md` explains the difference between an operator-run MVP pilot and a public paid business launch.

## Repository map

- `apps/backend` — platform API for project lifecycle, GitLab, Kubernetes, DNS, deployments, and AI-assisted change requests.
- `apps/frontend` — minimal customer dashboard and AI chat workspace.
- `packages/auth` — shared authentication and authorization policy definitions.
- `infra/ansible` — VM-IP based bootstrap playbooks for k3s, ingress, cert-manager, External Secrets, GitLab, runners, observability, and the Divband control plane.
- `infra/k8s` — Kubernetes namespace, routing, policy, quota, and deployment templates.
- `infra/gitlab` — GitLab CI templates and project/runner provisioning notes.
- `infra/terraform` — Terraform modules for platform DNS, optional shared Kubernetes add-ons, and GitLab catalog contracts.
- `infra/orchestration/` — bootstrap phase plan, state file, and planner CLI ([`docs/infrastructure-orchestration.md`](docs/infrastructure-orchestration.md))
- `docs` — architecture, tenancy, security, deployment, domains, AI workflow, and operational runbooks.
- `demo` — safe examples, demos, and walkthroughs that show how projects should behave before production hardening.
- `sandbox` — draft area for experiments and unshipped ideas; nothing here should be deployed automatically.

## Project auto-provision on k3s

After the control plane is running on k3s (Ansible bootstrap or VPS deploy), **creating a project in the dashboard automatically provisions Kubernetes resources** — no manual “provision namespace” step.

When a user calls `POST /projects` and the backend has `KUBERNETES_APPLY=true` (set by [`infra/ansible/roles/divband_app`](infra/ansible/roles/divband_app/defaults/main.yml) on cluster-backed deployments):

1. Namespace `project-{slug}` is created with quota, RBAC, and network policy.
2. A **nginx welcome page** is deployed (`infra/k8s/base/welcome-deployment.yaml`).
3. **Platform ingress** routes `{slug}.{username}.{platformDomain}` to that welcome service (`ingress-platform.yaml`).
4. A successful welcome deployment is recorded and the platform hostname is marked live.

GitLab/GitHub repo setup remains optional for first traffic; CI later replaces the welcome page with the customer's application in the same namespace.

| Path | Auto-provision? |
| --- | --- |
| Local dev (`npm run dev:mvp`) | No — Kubernetes is mocked (`KUBERNETES_CONFIG_MODE=disabled`) |
| k3s / VPS control plane | Yes — when `KUBERNETES_APPLY=true` and `DIVBAND_AUTO_PROVISION_PROJECTS` is not disabled |

Retry a failed apply with `POST /projects/{id}/kubernetes-namespace`. Disable auto-provision with `DIVBAND_AUTO_PROVISION_PROJECTS=0` on the backend.

Further reading: [`docs/development-vs-production.md`](docs/development-vs-production.md), [`docs/operations.md`](docs/operations.md#mvp-provisioning-runbook-api-request-to-live-hostname), [`infra/k8s/README.md`](infra/k8s/README.md).

## Production deployment wrapper

Use `make infra-preflight` from the repository root before starting infrastructure work. It checks that `gh` is installed, verifies the authenticated GitHub account defaults to `millw0rm`, confirms the GitHub repository and deployment workflow are visible, checks the required GitHub Actions secret and variables, parses the Ansible inventory for at least one VM/control-plane host, and verifies the configured SSH key can log in to each VM and is present in `authorized_keys`.

```bash
make infra-preflight
```

Use `make deploy-production` from the repository root to build the backend and frontend Docker images, push them to a registry, install the Ansible collections, and run the full VM bootstrap playbook through `scripts/deploy-production.sh`. The Make target passes through `REGISTRY`, `TAG`, `ANSIBLE_INVENTORY`, and `ANSIBLE_EXTRA_ARGS`; the wrapper requires `REGISTRY`, defaults `TAG` to `git rev-parse --short HEAD`, defaults `ANSIBLE_INVENTORY` to `infra/ansible/inventory.yml`, runs the infrastructure preflight first, and accepts optional `DIVBAND_BACKEND_IMAGE_REPOSITORY` and `DIVBAND_FRONTEND_IMAGE_REPOSITORY` overrides.

```bash
make deploy-production REGISTRY=registry.gitlab.com/divband/control-plane TAG=v1.0.0
```

By default the wrapper builds and pushes `${REGISTRY}/backend:${TAG}` and `${REGISTRY}/frontend:${TAG}` from the repository root, then runs `infra/ansible/playbooks/site.yml` with `DIVBAND_IMAGE_TAG` set to the selected tag. Set the repository override variables when the backend and frontend images live outside the default `/backend` and `/frontend` paths. Set `DIVBAND_SKIP_INFRA_PREFLIGHT=1` only when you intentionally need to bypass the readiness gate.

## Current status

This repository currently defines the initial platform skeleton, interfaces, infrastructure templates, and a VM-IP based Ansible bootstrap path for operator-run MVP pilots. Production integrations must replace placeholder values before deployment, and public-business readiness is tracked separately from infrastructure bootstrap readiness.
