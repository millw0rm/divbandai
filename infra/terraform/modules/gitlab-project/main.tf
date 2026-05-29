variable "project_slug" { type = string }
variable "namespace_path" { type = string }
variable "runner_tag" { type = string }

# Provisioning owner: backend service.
#
# The MVP now creates and configures GitLab projects through
# apps/backend/src/services/gitlab.ts so project creation can happen inside the
# authenticated API transaction that records audit events. That adapter owns:
# - project creation under the configured GitLab namespace
# - CI/CD variables, including DIVBAND_* metadata and protected secrets
# - protected default branch setup
# - deploy tokens or project access tokens for deployment pulls
# - AI branches, merge requests, and pipeline triggers
#
# Keep this module as a typed contract for future root stacks that want to
# inventory project inputs without creating duplicate GitLab resources.

output "provisioning_owner" {
  value = "backend"
}

output "expected_project_path" {
  value = "${var.namespace_path}/${var.project_slug}"
}

output "runner_tag" {
  value = var.runner_tag
}
