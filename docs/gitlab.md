# GitLab project lifecycle and runner isolation

Divband provisions one GitLab repository and one runner boundary for every hosted project. The GitLab resources are treated as part of the project lifecycle, not as manually managed assets.

Related docs: [`deployments.md`](deployments.md), [`architecture.md`](architecture.md), [`operations.md`](operations.md), [`infra/k8s/README.md`](../infra/k8s/README.md), [`README.md`](../README.md#project-auto-provision-on-k3s).

## Tenant namespace model

GitLab mirrors divband tenancy:

```text
git.divband.ir/{tenant-path}/{project-path}
```

- **Tenant group**: represents a user account or organization. Group variables are allowed only for non-secret tenant metadata that can safely apply to all projects in that tenant.
- **Project repository**: represents one deployable website or application. Source code, registry images, CI/CD variables, deploy credentials, protected branches, and runner bindings are scoped to this project.
- **Kubernetes namespace**: runtime target named by the project variable `DIVBAND_NAMESPACE` (`project-{slug}`). Created automatically on project create when `KUBERNETES_APPLY=true`.
- **Runner tag**: immutable project scheduling selector named by `DIVBAND_RUNNER_TAG`, for example `divband-acme-marketing`.

The Terraform entry point in `infra/gitlab/terraform` accepts a `tenants` map so platform automation can create tenant groups and all nested projects idempotently.

## Provisioned resources

For each tenant, automation creates a GitLab group on `git.divband.ir`. For each project, it creates or manages:

1. A private project repository with a platform README and private container registry.
2. Shared runners disabled, so only explicitly assigned runners can execute jobs.
3. Project access tokens with least-privilege repository and registry scopes.
4. Optional deploy keys for external read-only or controlled push integrations.
5. Protected branch rules for `main` and any additional release branches.
6. Project variables and masked secrets, including deployment kubeconfig material.
7. A project runner registration with exactly one project tag and untagged jobs disabled.

Container registry access remains project-private. CI jobs push to `$CI_REGISTRY_IMAGE`, which resolves to the registry path for the current GitLab project.

## Project lifecycle

1. **Draft**: the dashboard records tenant, project slug, and owner metadata.
2. **Namespace provisioning (cluster backends)**: on `POST /projects` with `KUBERNETES_APPLY=true`, Kubernetes automation creates `project-{slug}`, RBAC, network policy, quotas, nginx welcome page, and platform ingress. See [`README.md`](../README.md#project-auto-provision-on-k3s).
3. **Repository provisioning**: the user or platform adds the project to GitLab/GitHub automation. The project enters `repository_provisioned` after the remote repository, branch protection, variables, and credentials exist.
4. **Runner installation**: the runner authentication token is stored in the platform secret store, then used to install a dedicated runner pod or VM with the assigned project tag.
5. **First pipeline**: the project includes the reusable GitLab CI template. The build job produces an artifact, the image job pushes to the project registry, and the deploy job replaces the welcome workload in `DIVBAND_NAMESPACE`.
6. **Operate**: changes merge through protected branches and merge requests. Production deploys run only from the default branch.
7. **Archive or delete**: disable CI, revoke project access tokens and deploy keys, pause or remove runners, retain audit data, and then archive or delete the repository according to retention policy.

All lifecycle transitions must be idempotent. If a step fails, rerun provisioning from the last known state instead of manually patching GitLab resources.

## Runner isolation

Runner isolation is mandatory because deployment jobs receive namespace-scoped credentials.

- Each project has a unique `divband-*` runner tag.
- The reusable pipeline sets every job's `tags` to `$DIVBAND_RUNNER_TAG`.
- Terraform registers project runners with `untagged = false`, preventing accidental execution of untagged jobs.
- Shared runners are disabled on managed projects.
- Protected projects should use protected runners, so deployment credentials run only for protected refs.
- Runner pods or VMs must not mount credentials for another project.
- Runner cache keys and object storage prefixes must include project ID or project path.
- Runner logs and metrics must include tenant ID, project ID, runner ID, and job ID for audit.

A runner tag must never be reused after a project is deleted. Reusing a tag can allow stale pipeline configuration to schedule onto the wrong runner.

## CI template usage

Projects include `infra/gitlab/ci-templates/static-site.gitlab-ci.yml` from the platform repository. The template expects these variables, all provisioned by GitLab automation:

- `DIVBAND_RUNNER_TAG`: project runner tag.
- `DIVBAND_NAMESPACE`: Kubernetes namespace for deployment.
- `KUBE_CONFIG_B64`: masked base64 kubeconfig for the namespace-scoped deployer service account.
- Optional overrides: `APP_DIR`, `ARTIFACT_DIR`, `KUBE_CONTEXT`, `KUBE_DEPLOYMENT`, and `KUBE_CONTAINER`.

The template runs three stages:

1. `build_artifact`: installs dependencies when `package.json` is present and produces a build artifact.
2. `build_and_push_image`: uses Kaniko to build the container image and push `$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA` plus `latest` to the project registry.
3. `deploy_kubernetes`: updates the configured deployment in `DIVBAND_NAMESPACE` and waits for rollout completion.

Image publishing and deployment run only for the default branch or tags, while every job is constrained to the assigned runner tag.

## Secret handling

Project secrets are stored as protected, masked GitLab project variables only when GitLab CI must read them directly. Long-lived platform secrets should live in the platform secret store and be synchronized into Kubernetes through External Secrets instead of being copied into repositories.

When rotating secrets:

1. Update the platform secret source.
2. Update the GitLab project variable through Terraform or the provisioning API.
3. Re-run the affected pipeline from a protected ref.
4. Revoke the previous token or key.
5. Record the rotation in the audit log.

Never place project access token values, deploy private keys, runner tokens, kubeconfigs, or registry credentials in source control.
