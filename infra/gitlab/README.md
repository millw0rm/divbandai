# GitLab integration

`infra/gitlab` contains GitLab group, project, CI/CD, and runner automation for divband-hosted projects on `git.divband.ir`.

## Tenant and project model

Every divband tenant receives a GitLab group. Every deployable divband project receives one private GitLab project inside its tenant group:

```text
git.divband.ir/{tenant-path}/{project-path}
```

The Terraform configuration in `infra/gitlab/terraform` models this hierarchy as a `tenants` map. Tenant groups can optionally be created under a platform parent group by setting `parent_group_id`.

For each project, Terraform provisions:

- A private repository with the container registry enabled and shared runners disabled.
- A project access token for registry/repository automation.
- An optional deploy key when a public key is supplied.
- Protected branch rules for the default branch and any additional configured branches.
- Project variables and masked secrets, including `DIVBAND_NAMESPACE` and `DIVBAND_RUNNER_TAG`.
- A project-scoped GitLab runner registration with a single `divband-*` tag and untagged jobs disabled.

## Files

- `terraform/` — GitLab provider configuration and resources for tenant groups, projects, branch protection, variables, deploy keys, project access tokens, registry access, and project runners.
- `terraform/projects.auto.tfvars.example` — Example tenant/project input document for platform operators.
- `ci-templates/static-frontend.gitlab-ci.yml` — Reusable static frontend pipeline that builds an artifact, publishes an immutable image, deploys to the project namespace, updates the route, checks health, and reports status.
- `ci-templates/full-stack-container.gitlab-ci.yml` — Reusable full-stack container pipeline for applications that ship as one web/API image.
- `ci-templates/backend-service.gitlab-ci.yml` — Reusable backend-service pipeline for APIs and workers with optional ingress exposure.
- `ci-templates/preview-environments.gitlab-ci.yml` — Merge-request preview environment pipeline with auto-stop cleanup.
- `ci-templates/static-site.gitlab-ci.yml` — Backward-compatible include alias for the static frontend template.

## Applying the automation

1. Copy `terraform/projects.auto.tfvars.example` to `terraform/projects.auto.tfvars`.
2. Replace placeholder tokens and secrets with values from the platform secret store.
3. Run `terraform init` and `terraform plan` from `infra/gitlab/terraform`.
4. Store sensitive Terraform outputs, especially project access tokens and runner authentication tokens, in the platform secret store immediately.
5. Install each dedicated runner pod or VM with the matching runner authentication token and tag.

Do not reuse runner tags, runner tokens, deploy keys, or project access tokens between divband projects.
