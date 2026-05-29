variable "project_slug" { type = string }
variable "namespace_path" { type = string }
variable "runner_tag" { type = string }

# Placeholder for the GitLab provider resource. Enable after configuring the provider.
# resource "gitlab_project" "project" {
#   name             = var.project_slug
#   namespace_id     = var.namespace_path
#   visibility_level = "private"
# }
