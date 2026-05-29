terraform {
  required_version = ">= 1.5.0"

  required_providers {
    gitlab = {
      source  = "gitlabhq/gitlab"
      version = "~> 18.0"
    }
  }
}

provider "gitlab" {
  base_url = var.gitlab_base_url
  token    = var.gitlab_token
}
