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
  workspaceHostname: string;
  runnerTag: string;
  requiredSteps: string[];
}

export function normalizeUsername(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeProjectSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function createProjectLifecyclePlan(
  slug: string,
  ownerPath: string,
  username: string,
  platformDomain = 'divband.com',
): ProjectLifecyclePlan {
  const normalizedSlug = normalizeProjectSlug(slug);
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedSlug) {
    throw new Error('Project slug is required.');
  }
  if (!normalizedUsername) {
    throw new Error('Username is required.');
  }

  const platformHostname = `${normalizedSlug}.${normalizedUsername}.${platformDomain}`;

  return {
    slug: normalizedSlug,
    gitlabPath: `${ownerPath}/${normalizedSlug}`,
    namespace: `project-${normalizedSlug}`,
    platformHostname,
    workspaceHostname: `code.${normalizedSlug}.${normalizedUsername}.${platformDomain}`,
    runnerTag: `divband-${normalizedUsername}-${normalizedSlug}`,
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
