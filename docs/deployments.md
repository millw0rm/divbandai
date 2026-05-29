# Deployment lifecycle

1. A commit or merge request is pushed to the project's GitLab repository.
2. GitLab CI runs on the project's assigned runner tag.
3. CI builds the artifact or container image.
4. CI pushes the image to the GitLab container registry.
5. CI authenticates to Kubernetes using the project-scoped deploy identity.
6. CI updates the deployment in the project's namespace.
7. Kubernetes rolls out the new workload.
8. Readiness checks pass.
9. Backend records deployment status and exposes it in the dashboard.
10. Rollback uses the last known healthy image digest.

## Environments

- `production`: public traffic.
- `preview`: merge request-specific temporary route.
- `staging`: optional persistent pre-production environment.
- `sandbox`: non-production drafts and experiments.
