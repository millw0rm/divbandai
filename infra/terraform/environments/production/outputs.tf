output "shared_platform_provisioning_owner" {
  description = "The production shared platform layer is owned by this Terraform root stack; per-tenant resources remain backend-owned unless promoted later."
  value       = "terraform:infra/terraform/environments/production"
}

output "kubernetes_cluster" {
  description = "Shared cluster hand-off details. The kubeconfig is externally supplied through kubeconfig_path/context."
  value = {
    name               = var.cluster_name
    endpoint           = var.cluster_endpoint
    kubeconfig_path    = var.kubeconfig_path
    kubeconfig_context = var.kubeconfig_context
    apply_resources    = var.apply_kubernetes_resources
  }
}

output "worker_inventory" {
  description = "Node pool or VM inventory contract for tenant workloads, GitLab runners, schedulers, and Ansible inventory integration."
  value       = local.worker_inventory
}

output "ingress_gateway" {
  description = "Shared public ingress or Gateway API controller contract consumed by tenant manifests."
  value = {
    controller        = var.ingress.controller
    namespace         = var.ingress.namespace
    release_name      = var.ingress.release_name
    ingress_class     = var.ingress.ingress_class
    gateway_class     = var.ingress.gateway_class
    public_dns_target = var.public_ingress_target
  }
}

output "cert_manager_prerequisites" {
  description = "cert-manager prerequisites for platform and custom-domain certificate issuance."
  value = {
    namespace                = var.cert_manager.namespace
    release_name             = var.cert_manager.release_name
    install_crds             = var.cert_manager.install_crds
    acme_server              = var.cert_manager.acme_server
    acme_email               = var.cert_manager.acme_email
    http01_cluster_issuer    = var.cert_manager.http01_cluster_issuer
    dns01_cluster_issuer     = var.cert_manager.dns01_cluster_issuer
    dns_provider_secret_name = var.cert_manager.dns_provider_secret_name
    dns_provider_secret_key  = var.cert_manager.dns_provider_secret_key
    dns_provider_secret_managed = var.create_dns_provider_secret
  }
}

output "external_secrets_prerequisites" {
  description = "External Secrets Operator prerequisites and ClusterSecretStore contract consumed by infra/k8s/base/external-secret.yaml."
  value = {
    namespace             = var.external_secrets.namespace
    release_name          = var.external_secrets.release_name
    cluster_secret_store  = var.external_secrets.store_name
    backend               = var.external_secrets.backend
    auth_secret_name      = var.external_secrets.auth_secret_name
    auth_secret_key       = var.external_secrets.auth_secret_key
    vault_token_secret_managed = var.create_external_secrets_vault_token_secret
    tenant_secret_pattern = "projects/{project_id}/{environment}"
  }
}

output "secret_backend_configuration" {
  description = "Provider-neutral secret backend configuration. Vault backends are applied as a ClusterSecretStore when apply_kubernetes_resources is true."
  value = {
    backend      = var.external_secrets.backend
    vault_server = var.external_secrets.vault_server
    vault_path   = var.external_secrets.vault_path
    vault_version = var.external_secrets.vault_version
    store_name   = var.external_secrets.store_name
  }
}

output "dns_zone_and_records" {
  description = "DNS zone inventory and records required for *.divband.ir or the configured platform_domain. Bind these outputs to a provider-specific DNS stack when credentials are available."
  value = {
    zone_name        = var.platform_domain
    zone_id          = var.dns_zone_id
    required_records = local.required_dns_records
  }
}

output "observability_primitives" {
  description = "Shared logs, metrics, alerting, runbook, and dashboard primitives required by docs/operations.md."
  value = {
    namespace             = var.observability.namespace
    metrics_release_name  = var.observability.metrics_release_name
    logs_release_name     = var.observability.logs_release_name
    identity_labels       = local.observability_identity_labels
    metric_families       = local.observability_metric_families
    alert_severities      = var.observability.alert_severities
    runbook_base_url      = var.observability.runbook_base_url
    dashboard_base_url    = var.observability.dashboard_base_url
    config_map_name       = "divband-observability-contract"
  }
}
