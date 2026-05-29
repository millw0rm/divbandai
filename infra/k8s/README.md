# Kubernetes infrastructure

`infra/k8s` contains reusable Kubernetes manifests for per-project runtime resources. The base manifests are intentionally plain YAML with `REPLACE_WITH_*` placeholders so they can be rendered by Terraform, the backend provisioner, Helm, Kustomize replacements, or CI before apply.

## Tenant namespace bundle

The reusable namespace bundle lives under `infra/k8s/base` and is parameterized by project slug, immutable project ID, organization ID, owner ID, environment, image references, hostnames, service ports, quota sizes, and secret backend names.

Core resources:

- `tenant-namespace.yaml` creates the `project-{slug}` namespace plus `ResourceQuota` and `LimitRange` defaults for CPU, memory, storage, pods, services, ingress objects, and secrets.
- `network-policy.yaml` starts with a default-deny ingress/egress policy and only opens public app ingress from the ingress namespace, DNS egress, and approved platform-service egress.
- `rbac.yaml` creates the `project-deployer` `ServiceAccount`, namespace-scoped `Role`, and `RoleBinding` used by deploy automation.
- `external-secret.yaml` maps per-project secret material from External Secrets Operator into the namespace-local `project-secrets` Kubernetes Secret.
- `frontend-deployment.yaml`, `backend-deployment.yaml`, and `static-site-deployment.yaml` provide role-specific workload and service templates.
- `ingress.yaml` serves `REPLACE_WITH_SLUG.divband.ir` and a verified custom domain such as `project2.com`, and integrates with cert-manager through both ingress annotations and an explicit `Certificate`.
- `httproute.yaml` is a Gateway API alternative for clusters where TLS and host attachment are managed by the shared gateway layer.
- `certificate-issuers.yaml` provides cert-manager ACME ClusterIssuer templates for HTTP-01 and DNS-01 validation.
- `kustomization.yaml` lists the default Ingress-based bundle; switch `ingress.yaml` for `httproute.yaml` when using Gateway API routing, and install `certificate-issuers.yaml` once per cluster rather than once per tenant namespace.

## Required render-time values

At minimum, provisioning must replace:

- Identity: `REPLACE_WITH_PROJECT_ID`, `REPLACE_WITH_SLUG`, `REPLACE_WITH_ORGANIZATION_ID`, `REPLACE_WITH_OWNER_ID`, `REPLACE_WITH_ENVIRONMENT`.
- Quotas and limits: all `REPLACE_WITH_QUOTA_*`, `REPLACE_WITH_DEFAULT_*`, `REPLACE_WITH_MAX_*`, and `REPLACE_WITH_MIN_*` placeholders.
- Routing and TLS: `REPLACE_WITH_INGRESS_CLASS`, `REPLACE_WITH_CLUSTER_ISSUER`, `REPLACE_WITH_PUBLIC_SERVICE_NAME`, `REPLACE_WITH_PUBLIC_SERVICE_PORT`, and `REPLACE_WITH_VERIFIED_CUSTOM_DOMAIN` after DNS ownership is verified.
- Gateway API alternative: `REPLACE_WITH_GATEWAY_NAME` and `REPLACE_WITH_GATEWAY_NAMESPACE` when rendering `httproute.yaml`.
- ACME issuers: `REPLACE_WITH_ACME_HTTP01_CLUSTER_ISSUER`, `REPLACE_WITH_ACME_DNS01_CLUSTER_ISSUER`, `REPLACE_WITH_ACME_ACCOUNT_EMAIL`, `REPLACE_WITH_ACME_SERVER_URL`, ACME account secret names, `REPLACE_WITH_MANAGED_DNS_ZONE`, and DNS provider token secret names when installing `certificate-issuers.yaml`.
- Workloads: image, replica, port, health path, and resource placeholders for each enabled role.
- Secrets: `REPLACE_WITH_CLUSTER_SECRET_STORE`; secret payloads are read from `projects/{project_id}/{environment}`.

Do not render an unverified custom domain into `ingress.yaml`, `httproute.yaml`, or `Certificate` resources. If a project has no custom domain yet, render only the platform hostname or remove the custom-domain host entries during templating.
