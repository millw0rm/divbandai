output "tenant_groups" {
  description = "GitLab tenant group IDs and paths."
  value = {
    for key, group in gitlab_group.tenant : key => {
      id       = group.id
      full_path = group.full_path
      web_url  = group.web_url
    }
  }
}

output "projects" {
  description = "Provisioned GitLab projects and isolation settings."
  value = {
    for key, project in gitlab_project.project : key => {
      id                   = project.id
      path_with_namespace  = project.path_with_namespace
      web_url              = project.web_url
      ssh_url_to_repo      = project.ssh_url_to_repo
      http_url_to_repo     = project.http_url_to_repo
      container_registry   = project.container_registry_access_level
      runner_tag           = local.projects[key].runner_tag
      kubernetes_namespace = local.projects[key].kubernetes_namespace
    }
  }
}

output "project_access_tokens" {
  description = "Project access tokens generated for automation. Store these in the platform secret store immediately."
  value = {
    for key, token in gitlab_project_access_token.automation : key => token.token
  }
  sensitive = true
}

output "runner_authentication_tokens" {
  description = "Runner authentication tokens for installing dedicated runner pods or VMs."
  value = {
    for key, runner in gitlab_user_runner.project : key => runner.token
  }
  sensitive = true
}
