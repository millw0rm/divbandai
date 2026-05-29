variable "project_slug" { type = string }
variable "namespace" { type = string }

# Provisioning owner: backend service.
#
# The MVP renders infra/k8s/base templates and optionally applies them with
# kubectl in apps/backend/src/services/kubernetes.ts. Keeping application-owned
# provisioning avoids a second asynchronous Terraform queue for every project
# creation request while the templates are still iterating quickly.
#
# Root Terraform stacks should still install shared prerequisites such as the
# Kubernetes cluster, ingress/Gateway controller, cert-manager, External Secrets,
# ClusterSecretStore, and cluster-scoped issuers.

output "provisioning_owner" {
  value = "backend"
}

output "namespace" {
  value = var.namespace
}

output "project_slug" {
  value = var.project_slug
}
