variable "environment" {
  description = "Shared platform environment name applied to labels and release metadata."
  type        = string
  default     = "production"
}

variable "platform_domain" {
  description = "Base DNS zone used for default project hostnames. Production defaults to divband.ir."
  type        = string
  default     = "divband.ir"
}

variable "dashboard_hostname" {
  description = "Dashboard/application hostname managed in the platform-owned DNS zone. Set to an empty string to skip."
  type        = string
  default     = "app.divband.ir"
}

variable "api_hostname" {
  description = "API hostname managed in the platform-owned DNS zone when the API is separate from the dashboard/app hostname. Set to an empty string to skip."
  type        = string
  default     = "api.divband.ir"
}

variable "gitlab_hostname" {
  description = "Self-hosted GitLab hostname managed in the platform-owned DNS zone. Set to an empty string when GitLab is not self-hosted."
  type        = string
  default     = "gitlab.divband.ir"
}

variable "observability_hostnames" {
  description = "Optional observability hostnames, such as Grafana, managed in the platform-owned DNS zone."
  type        = list(string)
  default     = ["grafana.divband.ir"]
}

variable "platform_hostnames" {
  description = "Additional shared platform hostnames that should resolve to the public ingress endpoint. Prefer dashboard_hostname, api_hostname, gitlab_hostname, and observability_hostnames for first-class platform services."
  type        = list(string)
  default     = []
}

variable "public_ingress_target" {
  description = "DNS target for platform A/AAAA/CNAME records, such as an ingress load balancer hostname or IP."
  type        = string
  default     = "REPLACE_WITH_INGRESS_LOAD_BALANCER"
}

variable "manage_platform_dns_records" {
  description = "When true, create platform-owned DNS records in the configured Cloudflare zone. Customer-owned custom domains remain in modules/dns-domain."
  type        = bool
  default     = false
}

variable "platform_dns_record_type" {
  description = "Cloudflare DNS record type used for apex, wildcard, and service hostnames. Use CNAME for load balancer hostnames, A for IPv4 targets, or AAAA for IPv6 targets. Cloudflare flattens apex CNAME records."
  type        = string
  default     = "CNAME"

  validation {
    condition     = contains(["A", "AAAA", "CNAME"], var.platform_dns_record_type)
    error_message = "platform_dns_record_type must be one of A, AAAA, or CNAME."
  }
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:DNS:Edit permissions for the platform_domain zone. May be omitted when CLOUDFLARE_API_TOKEN is set or manage_platform_dns_records is false."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for platform_domain. Required when manage_platform_dns_records is true unless dns_zone_id is used as a compatibility alias."
  type        = string
  default     = ""
}

variable "cloudflare_dns_ttl" {
  description = "TTL in seconds for managed Cloudflare platform DNS records. Use 1 for Cloudflare automatic TTL."
  type        = number
  default     = 1
}

variable "cloudflare_dns_proxied" {
  description = "Whether Cloudflare should proxy managed platform DNS records. Keep false for plain DNS or when wildcard proxying is unavailable for the zone."
  type        = bool
  default     = false
}

variable "dns_zone_id" {
  description = "Compatibility alias for the Cloudflare platform_domain zone ID. Prefer cloudflare_zone_id for new configurations."
  type        = string
  default     = ""
}

variable "kubeconfig_path" {
  description = "Path to the externally supplied kubeconfig for the shared Kubernetes cluster."
  type        = string
  default     = "~/.kube/config"
}

variable "kubeconfig_context" {
  description = "Optional kubeconfig context for the shared Kubernetes cluster."
  type        = string
  default     = null
}

variable "cluster_name" {
  description = "Name of the shared Kubernetes cluster, whether externally supplied or managed outside this provider-neutral stack."
  type        = string
  default     = "divband-production"
}

variable "cluster_endpoint" {
  description = "Optional API server endpoint for inventory and hand-off documentation."
  type        = string
  default     = ""
}

variable "cluster_ca_certificate" {
  description = "Optional cluster CA certificate used by automation that does not consume kubeconfig directly."
  type        = string
  default     = ""
  sensitive   = true
}

variable "apply_kubernetes_resources" {
  description = "When true, install shared cluster add-ons through the supplied kubeconfig. Keep false to use the outputs as an operator checklist only."
  type        = bool
  default     = true
}

variable "worker_node_pools" {
  description = "Shared worker pools or VM inventory groups available to tenant workloads and CI runners."
  type = map(object({
    role             = string
    size             = string
    min_nodes        = number
    max_nodes        = number
    taints           = optional(list(string), [])
    labels           = optional(map(string), {})
    inventory_group  = optional(string, "")
    provisioned_by   = optional(string, "external")
  }))
  default = {
    general = {
      role            = "tenant-workloads"
      size            = "standard"
      min_nodes       = 3
      max_nodes       = 12
      inventory_group = "kubernetes_workers"
      labels = {
        "divband.io/node-pool" = "general"
      }
    }
    ci = {
      role            = "gitlab-runner"
      size            = "cpu-optimized"
      min_nodes       = 1
      max_nodes       = 6
      inventory_group = "gitlab_runners"
      taints          = ["divband.io/workload=ci:NoSchedule"]
      labels = {
        "divband.io/node-pool" = "ci"
        "divband.io/workload"  = "ci"
      }
    }
  }
}

variable "ingress" {
  description = "Ingress or Gateway API controller settings for the shared public edge."
  type = object({
    controller          = string
    namespace           = string
    release_name        = string
    chart_repository    = string
    chart_name          = string
    chart_version       = string
    ingress_class       = string
    gateway_class       = string
    service_annotations = optional(map(string), {})
    values              = optional(list(string), [])
  })
  default = {
    controller          = "ingress-nginx"
    namespace           = "ingress-nginx"
    release_name        = "ingress-nginx"
    chart_repository    = "https://kubernetes.github.io/ingress-nginx"
    chart_name          = "ingress-nginx"
    chart_version       = "4.10.1"
    ingress_class       = "nginx"
    gateway_class       = ""
    service_annotations = {}
    values              = []
  }
}

variable "cert_manager" {
  description = "cert-manager installation and ACME prerequisite settings."
  type = object({
    namespace                         = string
    release_name                      = string
    chart_repository                  = string
    chart_name                        = string
    chart_version                     = string
    install_crds                      = bool
    acme_email                        = string
    acme_server                       = string
    http01_cluster_issuer             = string
    dns01_cluster_issuer              = string
    dns_provider_secret_name          = string
    dns_provider_secret_key           = string
    delegated_dns_zones               = list(string)
    dns01_webhook_group_name          = string
    dns01_webhook_solver_name         = string
    dns01_webhook_endpoint            = string
    dns01_webhook_token_secret_name   = string
    dns01_webhook_token_secret_key    = string
  })
  default = {
    namespace                        = "cert-manager"
    release_name                     = "cert-manager"
    chart_repository                 = "https://charts.jetstack.io"
    chart_name                       = "cert-manager"
    chart_version                    = "v1.14.5"
    install_crds                     = true
    acme_email                       = "ops@divband.ir"
    acme_server                      = "https://acme-v02.api.letsencrypt.org/directory"
    http01_cluster_issuer            = "letsencrypt-http01-production"
    dns01_cluster_issuer             = "letsencrypt-dns01-production"
    dns_provider_secret_name        = "divband-dns-provider"
    dns_provider_secret_key         = "api-token"
    delegated_dns_zones             = []
    dns01_webhook_group_name        = "acme.divband.io"
    dns01_webhook_solver_name       = "managed-dns"
    dns01_webhook_endpoint          = "https://api.divband.ir/internal/acme-challenges"
    dns01_webhook_token_secret_name = "divband-acme-dns01-automation"
    dns01_webhook_token_secret_key  = "token"
  }
}

variable "external_secrets" {
  description = "External Secrets Operator installation and ClusterSecretStore settings."
  type = object({
    namespace        = string
    release_name     = string
    chart_repository = string
    chart_name       = string
    chart_version    = string
    store_name       = string
    backend          = string
    vault_server     = string
    vault_path       = string
    vault_version    = string
    auth_secret_name = string
    auth_secret_key  = string
  })
  default = {
    namespace        = "external-secrets"
    release_name     = "external-secrets"
    chart_repository = "https://charts.external-secrets.io"
    chart_name       = "external-secrets"
    chart_version    = "0.9.18"
    store_name       = "divband-project-secrets"
    backend          = "vault"
    vault_server     = "https://vault.service.consul:8200"
    vault_path       = "secret"
    vault_version    = "v2"
    auth_secret_name = "vault-token"
    auth_secret_key  = "token"
  }
}

variable "observability" {
  description = "Shared observability primitives required for logs, metrics, dashboards, and alerts."
  type = object({
    namespace                         = string
    metrics_release_name      = string
    metrics_chart_repository  = string
    metrics_chart_name        = string
    metrics_chart_version     = string
    logs_release_name         = string
    logs_chart_repository     = string
    logs_chart_name           = string
    logs_chart_version        = string
    runbook_base_url          = string
    dashboard_base_url        = string
    alert_severities          = map(string)
    values                    = optional(list(string), [])
  })
  default = {
    namespace                = "observability"
    metrics_release_name     = "kube-prometheus-stack"
    metrics_chart_repository = "https://prometheus-community.github.io/helm-charts"
    metrics_chart_name       = "kube-prometheus-stack"
    metrics_chart_version    = "58.2.1"
    logs_release_name        = "opentelemetry-collector"
    logs_chart_repository    = "https://open-telemetry.github.io/opentelemetry-helm-charts"
    logs_chart_name          = "opentelemetry-collector"
    logs_chart_version       = "0.88.0"
    runbook_base_url         = "https://docs.divband.ir/runbooks"
    dashboard_base_url       = "https://grafana.divband.ir"
    alert_severities = {
      failed_deployment          = "page-production-ticket-nonproduction"
      certificate_failure        = "page-expired-production-ticket-renewal"
      runner_failure             = "ticket-page-if-production-blocked"
      namespace_quota_exhaustion = "ticket-warning-page-production-blocked"
    }
    values = []
  }
}

variable "create_dns_provider_secret" {
  description = "Create the cert-manager DNS provider token Secret from dns_provider_api_token. Prefer false when another secret pipeline owns it."
  type        = bool
  default     = false
}

variable "dns_provider_api_token" {
  description = "Optional DNS provider token stored in cert-manager namespace for DNS-01 wildcard certificate issuance when create_dns_provider_secret is true."
  type        = string
  default     = ""
  sensitive   = true
}

variable "create_external_secrets_vault_token_secret" {
  description = "Create the External Secrets Vault token Secret from external_secrets_vault_token. Prefer false when another secret pipeline owns it."
  type        = bool
  default     = false
}

variable "external_secrets_vault_token" {
  description = "Optional Vault token stored for the External Secrets Operator ClusterSecretStore. Prefer workload identity or a sealed secret pipeline in production."
  type        = string
  default     = ""
  sensitive   = true
}
