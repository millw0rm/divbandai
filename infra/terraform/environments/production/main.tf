locals {
  common_labels = {
    "app.kubernetes.io/part-of" = "divband-platform"
    "divband.io/environment"    = var.environment
    "divband.io/managed-by"     = "terraform"
  }

  platform_wildcard_hostname = "*.${var.platform_domain}"
  required_dns_records = concat(
    [
      {
        name    = var.platform_domain
        type    = "A/AAAA-or-ALIAS"
        value   = var.public_ingress_target
        purpose = "Apex platform landing page and HTTP-01 reachability when supported by the DNS provider."
      },
      {
        name    = local.platform_wildcard_hostname
        type    = "CNAME-or-wildcard-A/AAAA"
        value   = var.public_ingress_target
        purpose = "Default per-project platform hostnames such as project-slug.${var.platform_domain}."
      }
    ],
    [for hostname in var.platform_hostnames : {
      name    = hostname
      type    = "CNAME-or-A/AAAA"
      value   = var.public_ingress_target
      purpose = "Shared platform service hostname."
    }]
  )

  worker_inventory = {
    for name, pool in var.worker_node_pools : name => {
      role            = pool.role
      size            = pool.size
      min_nodes       = pool.min_nodes
      max_nodes       = pool.max_nodes
      labels          = pool.labels
      taints          = pool.taints
      inventory_group = pool.inventory_group
      provisioned_by  = pool.provisioned_by
    }
  }

  observability_identity_labels = [
    "project_id",
    "project_slug",
    "tenant_id",
    "environment",
    "owner_id",
    "namespace",
    "workload",
    "service",
    "gitlab_project_id",
  ]

  observability_metric_families = [
    "deployment_health",
    "runtime_health",
    "certificate_and_domain_health",
    "gitlab_health",
    "quota_and_billing",
  ]

  cluster_secret_store_manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ClusterSecretStore"
    metadata = {
      name   = var.external_secrets.store_name
      labels = local.common_labels
    }
    spec = {
      provider = {
        vault = {
          server  = var.external_secrets.vault_server
          path    = var.external_secrets.vault_path
          version = var.external_secrets.vault_version
          auth = {
            tokenSecretRef = {
              name      = var.external_secrets.auth_secret_name
              key       = var.external_secrets.auth_secret_key
              namespace = var.external_secrets.namespace
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_namespace" "ingress" {
  count = var.apply_kubernetes_resources ? 1 : 0

  metadata {
    name   = var.ingress.namespace
    labels = local.common_labels
  }
}

resource "kubernetes_namespace" "cert_manager" {
  count = var.apply_kubernetes_resources ? 1 : 0

  metadata {
    name   = var.cert_manager.namespace
    labels = local.common_labels
  }
}

resource "kubernetes_namespace" "external_secrets" {
  count = var.apply_kubernetes_resources ? 1 : 0

  metadata {
    name   = var.external_secrets.namespace
    labels = local.common_labels
  }
}

resource "kubernetes_namespace" "observability" {
  count = var.apply_kubernetes_resources ? 1 : 0

  metadata {
    name   = var.observability.namespace
    labels = local.common_labels
  }
}

resource "helm_release" "ingress_controller" {
  count = var.apply_kubernetes_resources ? 1 : 0

  name       = var.ingress.release_name
  namespace  = var.ingress.namespace
  repository = var.ingress.chart_repository
  chart      = var.ingress.chart_name
  version    = var.ingress.chart_version
  values     = var.ingress.values

  set {
    name  = "controller.ingressClassResource.name"
    value = var.ingress.ingress_class
  }

  set {
    name  = "controller.ingressClass"
    value = var.ingress.ingress_class
  }

  dynamic "set" {
    for_each = var.ingress.service_annotations
    content {
      name  = "controller.service.annotations.${replace(set.key, ".", "\\.")}"
      value = set.value
    }
  }

  depends_on = [kubernetes_namespace.ingress]
}

resource "helm_release" "cert_manager" {
  count = var.apply_kubernetes_resources ? 1 : 0

  name       = var.cert_manager.release_name
  namespace  = var.cert_manager.namespace
  repository = var.cert_manager.chart_repository
  chart      = var.cert_manager.chart_name
  version    = var.cert_manager.chart_version

  set {
    name  = "installCRDs"
    value = tostring(var.cert_manager.install_crds)
  }

  depends_on = [kubernetes_namespace.cert_manager]
}

resource "kubernetes_secret" "cert_manager_dns_provider" {
  count = var.apply_kubernetes_resources && var.create_dns_provider_secret ? 1 : 0

  metadata {
    name      = var.cert_manager.dns_provider_secret_name
    namespace = var.cert_manager.namespace
    labels    = local.common_labels
  }

  data = {
    (var.cert_manager.dns_provider_secret_key) = var.dns_provider_api_token
  }

  type       = "Opaque"
  depends_on = [kubernetes_namespace.cert_manager]
}

resource "kubernetes_manifest" "http01_cluster_issuer" {
  count = var.apply_kubernetes_resources ? 1 : 0

  manifest = {
    apiVersion = "cert-manager.io/v1"
    kind       = "ClusterIssuer"
    metadata = {
      name   = var.cert_manager.http01_cluster_issuer
      labels = local.common_labels
    }
    spec = {
      acme = {
        email  = var.cert_manager.acme_email
        server = var.cert_manager.acme_server
        privateKeySecretRef = {
          name = "${var.cert_manager.http01_cluster_issuer}-account-key"
        }
        solvers = [
          {
            http01 = {
              ingress = {
                class = var.ingress.ingress_class
              }
            }
          }
        ]
      }
    }
  }

  depends_on = [helm_release.cert_manager]
}

resource "kubernetes_manifest" "dns01_cluster_issuer" {
  count = var.apply_kubernetes_resources ? 1 : 0

  manifest = {
    apiVersion = "cert-manager.io/v1"
    kind       = "ClusterIssuer"
    metadata = {
      name   = var.cert_manager.dns01_cluster_issuer
      labels = local.common_labels
    }
    spec = {
      acme = {
        email  = var.cert_manager.acme_email
        server = var.cert_manager.acme_server
        privateKeySecretRef = {
          name = "${var.cert_manager.dns01_cluster_issuer}-account-key"
        }
        solvers = [
          {
            selector = {
              dnsZones = [var.platform_domain]
            }
            dns01 = {
              cloudflare = {
                apiTokenSecretRef = {
                  name = var.cert_manager.dns_provider_secret_name
                  key  = var.cert_manager.dns_provider_secret_key
                }
              }
            }
          }
        ]
      }
    }
  }

  depends_on = [helm_release.cert_manager]
}

resource "helm_release" "external_secrets" {
  count = var.apply_kubernetes_resources ? 1 : 0

  name       = var.external_secrets.release_name
  namespace  = var.external_secrets.namespace
  repository = var.external_secrets.chart_repository
  chart      = var.external_secrets.chart_name
  version    = var.external_secrets.chart_version

  depends_on = [kubernetes_namespace.external_secrets]
}

resource "kubernetes_secret" "external_secrets_vault_token" {
  count = var.apply_kubernetes_resources && var.external_secrets.backend == "vault" && var.create_external_secrets_vault_token_secret ? 1 : 0

  metadata {
    name      = var.external_secrets.auth_secret_name
    namespace = var.external_secrets.namespace
    labels    = local.common_labels
  }

  data = {
    (var.external_secrets.auth_secret_key) = var.external_secrets_vault_token
  }

  type       = "Opaque"
  depends_on = [kubernetes_namespace.external_secrets]
}

resource "kubernetes_manifest" "cluster_secret_store" {
  count = var.apply_kubernetes_resources && var.external_secrets.backend == "vault" ? 1 : 0

  manifest   = local.cluster_secret_store_manifest
  depends_on = [helm_release.external_secrets]
}

resource "helm_release" "metrics" {
  count = var.apply_kubernetes_resources ? 1 : 0

  name       = var.observability.metrics_release_name
  namespace  = var.observability.namespace
  repository = var.observability.metrics_chart_repository
  chart      = var.observability.metrics_chart_name
  version    = var.observability.metrics_chart_version
  values     = var.observability.values

  depends_on = [kubernetes_namespace.observability]
}

resource "helm_release" "logs" {
  count = var.apply_kubernetes_resources ? 1 : 0

  name       = var.observability.logs_release_name
  namespace  = var.observability.namespace
  repository = var.observability.logs_chart_repository
  chart      = var.observability.logs_chart_name
  version    = var.observability.logs_chart_version
  values = concat([
    yamlencode({
      mode = "daemonset"
      presets = {
        logsCollection = {
          enabled             = true
          includeCollectorLogs = false
        }
        kubernetesAttributes = {
          enabled = true
        }
        kubeletMetrics = {
          enabled = true
        }
      }
    })
  ], var.observability.values)

  depends_on = [kubernetes_namespace.observability]
}

resource "kubernetes_config_map" "observability_contract" {
  count = var.apply_kubernetes_resources ? 1 : 0

  metadata {
    name      = "divband-observability-contract"
    namespace = var.observability.namespace
    labels    = local.common_labels
  }

  data = {
    identity_labels        = jsonencode(local.observability_identity_labels)
    metric_families        = jsonencode(local.observability_metric_families)
    alert_severities       = jsonencode(var.observability.alert_severities)
    runbook_base_url       = var.observability.runbook_base_url
    dashboard_base_url     = var.observability.dashboard_base_url
    required_log_enrichers = jsonencode(["kubernetes_namespace", "pod", "container", "image", "node", "divband_identity_labels"])
  }

  depends_on = [kubernetes_namespace.observability]
}
