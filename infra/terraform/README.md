# Terraform infrastructure

Terraform in this directory is split by ownership boundary so the same resource is not provisioned by two systems at the same time. See [`docs/infrastructure-orchestration.md`](../../docs/infrastructure-orchestration.md) and [`infra/orchestration/`](../orchestration/) for bootstrap phase order and when to run Terraform vs Ansible.

## Shared platform provisioning

Shared platform infrastructure is provisioned from root stacks under `infra/terraform/environments/`, starting with `environments/production`.

The production root stack wires the cluster-level platform layer that every tenant project depends on:

- Kubernetes cluster hand-off through an externally supplied kubeconfig, plus cluster name, endpoint, and CA outputs.
- Node pool or VM worker inventory for tenant workloads and GitLab runner capacity.
- Public ingress controller or Gateway API controller settings and shared ingress class outputs.
- cert-manager namespace, Helm release, CRD installation, HTTP-01 and DNS-01 ClusterIssuer prerequisites, and DNS provider secret wiring.
- External Secrets Operator namespace, Helm release, and ClusterSecretStore prerequisites.
- Secret backend configuration, currently modeled for Vault and exposed as outputs for other backends.
- Cloudflare-managed platform DNS records for `platform_domain`, `*.platform_domain`, dashboard, API, self-hosted GitLab, and observability hostnames, while customer custom domains stay out of the platform zone stack.
- Observability namespaces, metrics/log collection Helm releases, identity-label contracts, alert severities, runbook URLs, and dashboard URLs required by `docs/operations.md`.

Typical production workflow:

```bash
cd infra/terraform/environments/production
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Set `apply_kubernetes_resources = false` when a managed cluster, Ansible, or GitOps system installs cluster add-ons. In that mode, `terraform output` is still the shared platform contract that documents the kubeconfig, worker inventory, DNS records, cert-manager, External Secrets, secret backend, and observability prerequisites.

### Platform-owned DNS

The production root stack now includes a provider-specific managed-zone path for platform-owned records through the Cloudflare provider. Enable it with `manage_platform_dns_records = true`, set `cloudflare_zone_id`, and provide `cloudflare_api_token` through `TF_VAR_cloudflare_api_token`, `CLOUDFLARE_API_TOKEN`, Terraform Cloud, or a local `terraform.tfvars` file.

Managed platform records are built from:

- The apex `platform_domain` landing record.
- The wildcard `*.platform_domain` record used by default per-project hostnames.
- `dashboard_hostname`, for example `app.divband.ir`.
- `api_hostname` when the API is served from a separate hostname.
- `gitlab_hostname` when GitLab is self-hosted.
- `observability_hostnames`, such as `grafana.divband.ir`.
- Any extra names in `platform_hostnames`.

Set optional hostname variables to an empty string, or set `observability_hostnames = []`, to skip records that do not apply to an environment. The record type defaults to `CNAME`; use `A` or `AAAA` when `public_ingress_target` is an IP address. Cloudflare flattens apex CNAME records.

## Per-tenant/project provisioning contracts

Modules under `infra/terraform/modules/` describe typed contracts for resources that are scoped to one project or domain:

- `modules/k8s-tenant` documents the namespace and Kubernetes input boundary for a project.
- `modules/gitlab-project` documents GitLab project path and runner-tag expectations.
- `modules/dns-domain` documents custom-domain verification record names and values.

These modules are intentionally lightweight today. They are safe to use for inventory, planning, or a future asynchronous Terraform queue, but they should not duplicate resources that the backend already creates during a project lifecycle request.

## Backend-owned project lifecycle provisioning

The backend owns the MVP project lifecycle because it must run inside authenticated API transactions, emit audit events, and return actionable provisioning state to the caller.

Backend-owned provisioning includes:

- GitLab group/project setup, protected branches, CI/CD variables, deploy credentials, AI branches, merge requests, and pipeline triggers.
- Kubernetes tenant namespace rendering from `infra/k8s/base`, including quotas, LimitRanges, NetworkPolicies, RBAC, workloads, ingress or HTTPRoute objects, Certificates, and ExternalSecrets.
- Default platform hostname attachment after the shared wildcard DNS and ingress route are ready.
- Custom-domain TXT challenge creation, verification, and certificate-status tracking.

If a resource graduates from backend-owned lifecycle provisioning into Terraform, first update the ownership notes in the relevant module and backend service so exactly one controller owns create/update/delete for that resource.
