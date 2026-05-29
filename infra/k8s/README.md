# Kubernetes infrastructure

`infra/k8s` contains reusable Kubernetes manifests and future Helm chart templates for per-project runtime resources.

Base resources should include:

- Tenant namespace.
- Resource quota and limit range.
- Namespace-scoped RBAC and deploy service account.
- Default-deny network policy.
- Application deployment and service templates.
- Host-based HTTP routing for `{slug}.divband.ir` and verified custom domains.

All templates must be parameterized by project slug, immutable project ID, environment, image reference, hostnames, and service port.
