variable "gitlab_base_url" {
  description = "Base API URL for the divband GitLab instance."
  type        = string
  default     = "https://git.divband.ir/api/v4/"
}

variable "gitlab_token" {
  description = "Personal access token or admin token used by the provisioning controller."
  type        = string
  sensitive   = true
}

variable "parent_group_id" {
  description = "Optional numeric ID of a platform parent group that contains every tenant group."
  type        = number
  default     = null
}

variable "tenants" {
  description = "Tenant groups and the GitLab projects that belong to each tenant."
  type = map(object({
    name        = string
    path        = string
    description = optional(string, null)
    visibility  = optional(string, "private")
    variables = optional(map(object({
      value             = string
      protected         = optional(bool, true)
      masked            = optional(bool, false)
      raw               = optional(bool, true)
      environment_scope = optional(string, "*")
    })), {})
    projects = map(object({
      name                   = string
      path                   = string
      description            = optional(string, null)
      default_branch         = optional(string, "main")
      visibility             = optional(string, "private")
      kubernetes_namespace   = string
      # Terraform creates one project-scoped runner per project and exports its
      # authentication token through the sensitive runner_authentication_tokens
      # output for Ansible/Vault handoff. Keep runner_tag stable because jobs and
      # runner hosts use it as the project isolation boundary.
      runner_tag             = string
      runner_description     = optional(string, null)
      runner_protected_only  = optional(bool, true)
      deploy_key_title       = optional(string, null)
      deploy_key_public_key  = optional(string, null)
      deploy_key_can_push    = optional(bool, false)
      access_token_name      = optional(string, "divband-project-automation")
      access_token_scopes    = optional(list(string), ["read_repository", "read_registry", "write_registry"])
      access_token_level      = optional(string, "developer")
      access_token_expires_at = optional(string, null)
      protected_branches = optional(map(object({
        push_access_level             = optional(string, "maintainer")
        merge_access_level            = optional(string, "maintainer")
        unprotect_access_level        = optional(string, "maintainer")
        allow_force_push              = optional(bool, false)
        code_owner_approval_required  = optional(bool, true)
      })), {})
      variables = optional(map(object({
        value             = string
        protected         = optional(bool, true)
        masked            = optional(bool, false)
        raw               = optional(bool, true)
        environment_scope = optional(string, "*")
      })), {})
      secrets = optional(map(object({
        value             = string
        protected         = optional(bool, true)
        masked            = optional(bool, true)
        raw               = optional(bool, true)
        environment_scope = optional(string, "*")
      })), {})
    }))
  }))

  validation {
    condition = alltrue(flatten([
      for _, tenant in var.tenants : [
        for _, project in tenant.projects : can(regex("^divband-[a-z0-9][a-z0-9-]*$", project.runner_tag))
      ]
    ]))
    error_message = "Every project runner_tag must be a stable divband-* tag such as divband-acme-web."
  }
}
