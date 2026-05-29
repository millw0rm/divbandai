export type ProjectStatus =
  | 'draft'
  | 'repository_provisioned'
  | 'namespace_provisioned'
  | 'building'
  | 'deployed'
  | 'domain_pending_verification'
  | 'domain_active'
  | 'failed'
  | 'archived';

export interface ProjectLifecyclePlan {
  slug: string;
  gitlabPath: string;
  namespace: string;
  platformHostname: string;
  runnerTag: string;
  requiredSteps: string[];
}

export function createProjectLifecyclePlan(slug: string, ownerPath: string): ProjectLifecyclePlan {
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  return {
    slug: normalizedSlug,
    gitlabPath: `${ownerPath}/${normalizedSlug}`,
    namespace: `project-${normalizedSlug}`,
    platformHostname: `${normalizedSlug}.divband.ir`,
    runnerTag: `divband-${normalizedSlug}`,
    requiredSteps: [
      'create_gitlab_project',
      'configure_project_runner_tag',
      'provision_kubernetes_namespace',
      'apply_quota_rbac_and_network_policy',
      'attach_platform_subdomain',
      'run_initial_deployment',
    ],
  };
}
