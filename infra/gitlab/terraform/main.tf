locals {
  tenant_variables = merge({}, flatten([
    for tenant_key, tenant in var.tenants : [
      for variable_key, variable in tenant.variables : {
        "${tenant_key}/${variable_key}" = merge(variable, {
          tenant_key = tenant_key
          key        = variable_key
        })
      }
    ]
  ])...)

  projects = merge({}, flatten([
    for tenant_key, tenant in var.tenants : [
      for project_key, project in tenant.projects : {
        "${tenant_key}/${project_key}" = merge(project, {
          tenant_key   = tenant_key
          project_key  = project_key
          tenant_path  = tenant.path
          tenant_name  = tenant.name
        })
      }
    ]
  ])...)

  branch_protections = merge({}, flatten([
    for project_id, project in local.projects : [
      for branch_name, rule in merge(
        {
          (project.default_branch) = {
            push_access_level            = "maintainer"
            merge_access_level           = "maintainer"
            unprotect_access_level       = "maintainer"
            allow_force_push             = false
            code_owner_approval_required = true
          }
        },
        project.protected_branches
      ) : {
        "${project_id}/${branch_name}" = merge(rule, {
          project_id  = project_id
          branch_name = branch_name
        })
      }
    ]
  ])...)

  project_variables = merge({}, flatten([
    for project_id, project in local.projects : [
      for variable_key, variable in merge(
        {
          DIVBAND_NAMESPACE  = { value = project.kubernetes_namespace, protected = true, masked = false, raw = true, environment_scope = "*" }
          DIVBAND_RUNNER_TAG = { value = project.runner_tag, protected = true, masked = false, raw = true, environment_scope = "*" }
          DIVBAND_REGISTRY   = { value = "git.divband.ir", protected = true, masked = false, raw = true, environment_scope = "*" }
        },
        project.variables,
        project.secrets
      ) : {
        "${project_id}/${variable_key}" = merge(variable, {
          project_id = project_id
          key        = variable_key
        })
      }
    ]
  ])...)

  deploy_keys = {
    for project_id, project in local.projects : project_id => project
    if try(project.deploy_key_public_key, null) != null
  }
}

resource "gitlab_group" "tenant" {
  for_each = var.tenants

  name        = each.value.name
  path        = each.value.path
  description = coalesce(each.value.description, "divband tenant namespace for ${each.value.name}")
  parent_id   = var.parent_group_id
  visibility  = each.value.visibility
}

resource "gitlab_group_variable" "tenant" {
  for_each = local.tenant_variables

  group             = gitlab_group.tenant[each.value.tenant_key].id
  key               = each.value.key
  value             = each.value.value
  protected         = each.value.protected
  masked            = each.value.masked
  raw               = each.value.raw
  environment_scope = each.value.environment_scope
}

resource "gitlab_project" "project" {
  for_each = local.projects

  name                                  = each.value.name
  path                                  = each.value.path
  description                           = coalesce(each.value.description, "divband managed project ${each.value.tenant_path}/${each.value.path}")
  namespace_id                          = gitlab_group.tenant[each.value.tenant_key].id
  visibility_level                      = each.value.visibility
  default_branch                        = each.value.default_branch
  initialize_with_readme                = true
  container_registry_access_level       = "private"
  packages_enabled                      = true
  issues_enabled                        = true
  merge_requests_enabled                = true
  snippets_enabled                      = false
  wiki_enabled                          = false
  shared_runners_enabled                = false
  only_allow_merge_if_pipeline_succeeds = true
  remove_source_branch_after_merge      = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "gitlab_project_access_token" "automation" {
  for_each = local.projects

  project      = gitlab_project.project[each.key].id
  name         = each.value.access_token_name
  scopes       = each.value.access_token_scopes
  access_level = each.value.access_token_level
  expires_at   = each.value.access_token_expires_at
}

resource "gitlab_deploy_key" "project" {
  for_each = local.deploy_keys

  project  = gitlab_project.project[each.key].id
  title    = coalesce(each.value.deploy_key_title, "divband-${each.value.project_key}-deploy-key")
  key      = each.value.deploy_key_public_key
  can_push = each.value.deploy_key_can_push
}

resource "gitlab_branch_protection" "project" {
  for_each = local.branch_protections

  project                      = gitlab_project.project[each.value.project_id].id
  branch                       = each.value.branch_name
  push_access_level            = each.value.push_access_level
  merge_access_level           = each.value.merge_access_level
  unprotect_access_level       = each.value.unprotect_access_level
  allow_force_push             = each.value.allow_force_push
  code_owner_approval_required = each.value.code_owner_approval_required
}

resource "gitlab_project_variable" "project" {
  for_each = local.project_variables

  project           = gitlab_project.project[each.value.project_id].id
  key               = each.value.key
  value             = each.value.value
  protected         = each.value.protected
  masked            = each.value.masked
  raw               = each.value.raw
  environment_scope = each.value.environment_scope
}

resource "gitlab_user_runner" "project" {
  for_each = local.projects

  runner_type  = "project_type"
  project_id    = gitlab_project.project[each.key].id
  description   = coalesce(each.value.runner_description, "divband runner for ${each.value.tenant_path}/${each.value.path}")
  tag_list      = [each.value.runner_tag]
  untagged      = false
  access_level  = each.value.runner_protected_only ? "ref_protected" : "not_protected"
}
