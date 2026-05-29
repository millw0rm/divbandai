# Deployment lifecycle

Divband deployments are GitLab-driven, namespace-scoped rollouts. The backend remains the source of truth for project state, while GitLab CI performs the build, registry, Kubernetes, ingress, health-check, status-reporting, and rollback work for each project.

## End-to-end production flow

1. **Commit pushed to GitLab** — A user pushes to the project repository on `git.divband.ir/{tenant}/{project}`. The project includes one of the reusable templates from `infra/gitlab/ci-templates/` and runs only on the project-scoped `DIVBAND_RUNNER_TAG`.
2. **GitLab runner builds artifact/container** — The assigned runner checks out the commit, installs dependencies, runs project tests/builds, and creates either a static artifact or a container build context.
3. **Image pushed to registry** — Kaniko publishes immutable images to the project container registry with `$CI_COMMIT_SHA` and branch/latest tags. Deployments should use the immutable SHA tag or digest.
4. **CI deploys to project namespace** — The deploy job decodes `KUBE_CONFIG_B64`, selects `KUBE_CONTEXT`, and updates only the configured workload in `DIVBAND_NAMESPACE`.
5. **Ingress route is updated** — CI applies or patches the project `Ingress`/`HTTPRoute` so the platform hostname or preview hostname points at the new service.
6. **Health checks run** — CI waits for `kubectl rollout status`, then calls the configured health endpoint (`HEALTHCHECK_URL` or the route URL) and fails if the route does not respond successfully.
7. **Deployment status is reported to the backend** — CI posts lifecycle transitions to `POST /projects/{projectId}/deployments/report` using `DIVBAND_API_BASE_URL`, `DIVBAND_PROJECT_ID`, and a project API token. Reports include state, commit, pipeline, image, route, and health-check metadata.
8. **Dashboard displays status** — The dashboard reads `/projects/{projectId}/status`, `/projects/{projectId}/deployments/{deploymentId}`, and `/projects/{projectId}/logs` to show latest state, build logs, image/commit data, active route, and rollback options.
9. **Rollback path to previous release** — Operators can request `POST /projects/{projectId}/deployments/{deploymentId}/rollback`. The backend creates a rollback deployment targeting the most recent successful image, and the CI rollback job can re-apply that image and report the result.

## Backend deployment status contract

CI templates report status with a JSON payload shaped like:

```json
{
  "state": "running",
  "gitRef": "main",
  "commitSha": "${CI_COMMIT_SHA}",
  "environment": "production",
  "image": "${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA}",
  "pipelineId": "${CI_PIPELINE_ID}",
  "jobUrl": "${CI_JOB_URL}",
  "ingressHostname": "example.divband.ir",
  "healthCheckUrl": "https://example.divband.ir/healthz",
  "logLine": "rollout started"
}
```

Valid states are `queued`, `running`, `succeeded`, `failed`, `cancelled`, and `rolling_back`. Valid environments are `production`, `staging`, `preview`, and `sandbox`.

## CI/CD template matrix

| Template | Use case | Main jobs |
| --- | --- | --- |
| `static-frontend.gitlab-ci.yml` | Static HTML/SPA/frontend projects | install/build artifact, package nginx image, deploy route, health check, report status |
| `full-stack-container.gitlab-ci.yml` | Projects that build one container containing web/API/runtime | test, container build/push, deploy workload, route, health check, report status |
| `backend-service.gitlab-ci.yml` | API/worker services exposed through ClusterIP or optional ingress | test, container build/push, deploy service, rollout/health, report status |
| `preview-environments.gitlab-ci.yml` | Merge-request preview apps | build preview image, deploy `review/$CI_COMMIT_REF_SLUG`, health check, auto-stop cleanup |

## Required CI/CD variables

Provisioning injects these variables per project:

- `DIVBAND_RUNNER_TAG` — the only runner tag allowed for the project.
- `DIVBAND_NAMESPACE` — the Kubernetes namespace owned by the project.
- `KUBE_CONFIG_B64` — base64 kubeconfig scoped to the namespace.
- `DIVBAND_PROJECT_ID` — backend project identifier for status reporting.
- `DIVBAND_API_BASE_URL` — platform API base URL.
- `DIVBAND_API_TOKEN` — project API token with deployment reporting permission.

Templates also support project-owned overrides such as `APP_DIR`, `DOCKERFILE`, `KUBE_DEPLOYMENT`, `KUBE_CONTAINER`, `KUBE_SERVICE`, `PRODUCTION_HOST`, and `HEALTHCHECK_PATH`.

## Rollback operations

Rollback is intentionally image-based rather than branch-based:

1. The backend locates the most recent successful deployment with an image.
2. A rollback deployment is recorded with `state=rolling_back`, `rollbackOfDeploymentId`, and `previousDeploymentId`.
3. The rollback CI/manual job sets the Kubernetes deployment image to `ROLLBACK_IMAGE` or the image from the backend response.
4. CI waits for rollout status and re-runs the same health check used by the forward deploy.
5. CI reports `succeeded` or `failed` back to the backend so the dashboard shows the rollback result.

This keeps emergency recovery independent of mutable branch heads and allows the dashboard to explain exactly which release was restored.


## Instant static site publish and serving path

Instant static sites use a separate deployment and request path from GitLab-driven Kubernetes workloads. They are intended for prebuilt static output, agent-created previews, documentation, and SPAs that do not require server-side execution.

### Publish flow

1. A client creates or updates a static publish session through the backend publish API with a file manifest, checksums, content types, and optional `spaMode`.
2. The backend allocates an immutable version ID and upload plan without creating a GitLab repository, container image, Kubernetes namespace, service, or ingress route.
3. The client uploads files to object storage using scoped upload URLs. Final object keys use the production shape `sites/{slug}/versions/{versionId}/{path}` after finalize.
4. Finalize validates the uploaded files and atomically updates routing metadata from `slug -> currentVersionId`.
5. Previously finalized versions remain immutable so rollback can be modeled as repointing `currentVersionId` instead of rebuilding or redeploying a workload.

### Request path

1. A request arrives for `{slug}.divband.ir` or an assigned custom domain.
2. The static serving edge resolves the `Host` header to a published static site record, not a Kubernetes workload.
3. Routing metadata maps `slug -> currentVersionId`.
4. The normalized URL path maps to an object storage key such as `sites/{slug}/versions/{versionId}/{path}`.
5. Serving rules are deterministic:
   - `/` serves `index.html`.
   - Direct file paths serve exact objects.
   - Subdirectories prefer `index.html` inside that directory.
   - Unknown paths optionally fall back to `index.html` when `spaMode` is enabled.
   - Missing paths return a generated directory listing or `404` depending on configuration.

The current backend includes static-serving scaffolding for host resolution, version lookup, object-key construction, SPA fallback, and optional directory listings. Production can run that logic in the backend, a CDN worker, or a dedicated edge worker as long as it preserves the same metadata contract and object key layout.
