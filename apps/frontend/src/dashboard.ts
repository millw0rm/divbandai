import { clearAuthToken, getAuthToken, getStoredAuthUser, setAuthSession } from './auth-session';

export type ProjectLifecycleState =
  | 'created'
  | 'repository_provisioned'
  | 'namespace_provisioned'
  | 'building'
  | 'deployed'
  | 'domain_pending_verification'
  | 'domain_active'
  | 'failed';

export type BackendProjectStatus = ProjectLifecycleState | 'draft' | 'archived';

export type DashboardPageId =
  | 'agent-quickstart'
  | 'project-list'
  | 'create-project'
  | 'project-overview'
  | 'gitlab-repository-status'
  | 'deployment-status'
  | 'domain-management'
  | 'environment-variables'
  | 'logs-build-history'
  | 'ai-assistant'
  | 'admin-user-org-search'
  | 'admin-project-lifecycle'
  | 'admin-dns-certificates'
  | 'admin-runner-status'
  | 'admin-failed-deployments'
  | 'admin-audit-events'
  | 'admin-abuse-actions';

export interface DashboardPage {
  id: DashboardPageId;
  title: string;
  description: string;
  requiresProject: boolean;
}

export interface DashboardSection {
  id: string;
  title: string;
  description: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  username: string;
  createdAt: string;
  suspendedAt?: string;
  suspensionReason?: string;
  platformAdminRole?: 'support' | 'security' | 'super_admin';
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  suspendedAt?: string;
  suspensionReason?: string;
}

export interface PlatformAuditEvent {
  id: string;
  actorId: string;
  action: string;
  projectId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AbuseAction {
  id: string;
  targetType: 'user' | 'organization' | 'project' | 'domain';
  targetId: string;
  action: 'warn' | 'suspend' | 'unsuspend' | 'restrict_deployments';
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface RunnerHealth {
  projectId: string;
  projectSlug: string;
  runnerTag: string;
  status: 'idle' | 'active' | 'degraded';
  latestDeploymentState?: Deployment['state'];
  checkedAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  session: AuthSession;
  token: string;
  tokenType: 'Bearer';
}

export type DomainDnsMode = 'none' | 'custom_cname' | 'apex' | 'delegated_sub_zone' | 'delegated_full_zone';
export type DomainStatus = 'pending_dns' | 'verified' | 'provisioning' | 'active' | 'failed' | 'disabled' | 'removing';
export type DomainVerificationStatus = 'pending' | 'verified' | 'failed';
export type DomainDelegationStatus = 'not_applicable' | 'pending' | 'verified' | 'failed';

export interface DomainDnsInstruction {
  type: 'TXT' | 'CNAME' | 'A' | 'AAAA' | 'ALIAS' | 'ANAME' | 'NS';
  name: string;
  value: string | string[];
  purpose: 'ownership_verification' | 'traffic_routing' | 'zone_delegation';
  required: boolean;
}

export interface ProjectDomain {
  id: string;
  hostname: string;
  dnsMode: DomainDnsMode;
  status: DomainStatus;
  verificationStatus: DomainVerificationStatus;
  verificationToken: string;
  verificationName: string;
  verificationValue: string;
  verificationRecord: string;
  verified: boolean;
  dnsTarget?: string | string[];
  assignedNameservers: string[];
  delegationStatus: DomainDelegationStatus;
  providerZoneId?: string;
  dnsInstructions: DomainDnsInstruction[];
  certificateStatus: 'not_requested' | 'pending' | 'issued' | 'failed';
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  verifiedAt?: string;
  disabledAt?: string;
  failureReason?: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'rolling_back';
  gitRef: string;
  commitSha?: string;
  environment?: 'production' | 'staging' | 'preview' | 'sandbox';
  image?: string;
  imageDigest?: string;
  pipelineId?: string;
  jobUrl?: string;
  ingressHostname?: string;
  healthCheckUrl?: string;
  previousDeploymentId?: string;
  rollbackOfDeploymentId?: string;
  startedAt?: string;
  finishedAt?: string;
  logs: string[];
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  protected: boolean;
  updatedAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  ownerId: string;
  slug: string;
  name: string;
  status: BackendProjectStatus;
  gitlabPath: string;
  namespace: string;
  platformHostname: string;
  workspaceHostname: string;
  runnerTag: string;
  repositoryUrl?: string;
  repository?: ProjectRepository;
  namespaceProvisioned: boolean;
  platformSubdomainAttached: boolean;
  domains: ProjectDomain[];
  deployments: Deployment[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  suspendedAt?: string;
  suspensionReason?: string;
}

export interface ProjectRepository {
  provider: 'github' | 'gitlab';
  path: string;
  webUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  connectedAt: string;
  offline?: boolean;
}

export interface RepositoryFile {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size?: number;
  webUrl: string;
}

export interface ProjectStatusSummary {
  status: BackendProjectStatus;
  repositoryUrl?: string;
  namespaceProvisioned: boolean;
  platformSubdomainAttached: boolean;
  activeDomains: string[];
  domains?: Array<Pick<ProjectDomain, 'id' | 'hostname' | 'status' | 'verificationStatus' | 'delegationStatus' | 'certificateStatus' | 'failureReason'>>;
  latestDeployment?: Deployment;
}

export interface GitHubConnectionStatus {
  configured: boolean;
  connected: boolean;
  username?: string;
  clientIdSource?: 'custom' | 'bundled';
  clientIdPreview?: string;
  callbackUrl?: string;
  usingCustomCredentials?: boolean;
  serverReachable?: boolean;
}

export interface GitHubRepositorySummary {
  name: string;
  fullName: string;
  webUrl: string;
  private: boolean;
  defaultBranch: string;
}

export interface DashboardState {
  currentPage: DashboardPageId;
  user?: AuthUser;
  session?: AuthSession;
  projects: Project[];
  selectedProjectId?: string;
  statusSummary?: ProjectStatusSummary;
  githubStatus?: GitHubConnectionStatus;
  githubRepositories: GitHubRepositorySummary[];
  repositoryFiles: RepositoryFile[];
  logs: Array<Pick<Deployment, 'id' | 'state' | 'logs'>>;
  environmentVariables: EnvironmentVariable[];
  adminUsers: AuthUser[];
  adminOrganizations: Organization[];
  adminProjects: Project[];
  adminDomains: Array<ProjectDomain & { projectId: string; projectSlug: string; organizationId: string }>;
  adminRunnerHealth: RunnerHealth[];
  adminFailedDeployments: Array<Deployment & { projectSlug: string; organizationId: string }>;
  adminAuditEvents: PlatformAuditEvent[];
  adminAbuseActions: AbuseAction[];
  assistantMessages: AssistantMessage[];
  aiChangeRequests: AiChangeRequest[];
  loading: boolean;
  error?: string;
  notice?: string;
  noticeVariant?: 'success' | 'error';
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type AiChangeStatus =
  | 'requested'
  | 'context_attached'
  | 'patch_generated'
  | 'awaiting_confirmation'
  | 'branch_created'
  | 'merge_request_opened'
  | 'ci_running'
  | 'ci_succeeded'
  | 'ci_failed'
  | 'deploy_ready';

export interface AiChangeRequest {
  id: string;
  projectId: string;
  requesterId: string;
  prompt: string;
  status: AiChangeStatus;
  targetBranch: string;
  context: Array<{ id: string; summary: string; files: string[]; redactedSecrets: string[]; createdAt: string }>;
  patch?: { id: string; summary: string; requiresConfirmation: boolean; confirmedAt?: string; files: Array<{ path: string; action: 'create' | 'update' | 'delete'; diff: string }> };
  branch?: { name: string; webUrl: string; commitSha?: string; createdAt: string };
  mergeRequest?: { iid: number; title: string; webUrl: string; sourceBranch: string; targetBranch: string; state: 'opened' | 'merged' | 'closed'; createdAt: string };
  ciStatus?: { pipelineId: string; status: 'created' | 'pending' | 'running' | 'success' | 'failed' | 'canceled'; webUrl: string; deploymentReady: boolean; updatedAt: string };
  createdAt: string;
  updatedAt: string;
}

export interface AssistantChangeRequestInput {
  prompt: string;
  projectId: string;
  targetBranch?: string;
}

export interface ApiClientOptions {
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
}

export interface DashboardControllerOptions extends ApiClientOptions {
  root: HTMLElement;
  initialState?: Partial<DashboardState>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export interface DashboardActionResult {
  state: DashboardState;
  html: string;
}


const agentQuickstartCurl = `curl -sS -X POST "$DIVBAND_API_BASE_URL/api/v1/publish" \\
  -H "authorization: Bearer $DIVBAND_API_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{
    "slug": "negar-portfolio",
    "anonymous": false,
    "spaMode": true,
    "files": [
      { "path": "index.html", "size": 2048, "sha256": "..." }
    ]
  }'`;

const agentQuickstartMcp = `{
  "mcpServers": {
    "divband": {
      "command": "npx",
      "args": ["-y", "@divband/mcp-server"],
      "env": {
        "DIVBAND_API_BASE_URL": "https://api.divband.local",
        "DIVBAND_API_TOKEN": "dvb_live_..."
      }
    }
  }
}`;

const agentRoadmapPhases = [
  { id: 'P0', name: 'Skeleton', status: 'done', description: 'Routes, models, local persistence, infra templates, MCP, OpenAPI, and agent docs are present.' },
  { id: 'P1', name: 'Runnable instant static hosting', status: 'active', description: 'Presigned upload sessions, checksum validation, scanner gate, publish-to-serve promotion, hardened auth, and local stack.' },
  { id: 'P2', name: 'Custom domains and TLS', status: 'next', description: 'DNS verification, certificate issuance, renewal, and serving-layer domain routing.' },
  { id: 'P3', name: 'Reviewed AI changes', status: 'later', description: 'Real repository context, generated diffs, branches, merge requests, CI, and deploy previews.' },
  { id: 'P4', name: 'Full project hosting', status: 'later', description: 'Production GitLab, Kubernetes, Terraform, runner, namespace, and route adapters.' },
];

const mvpHiddenPages = new Set<DashboardPageId>([
  'admin-user-org-search',
  'admin-project-lifecycle',
  'admin-dns-certificates',
  'admin-runner-status',
  'admin-failed-deployments',
  'admin-audit-events',
  'admin-abuse-actions',
  'ai-assistant',
  'environment-variables',
  'agent-quickstart',
]);

const sidebarMainNav: Array<{ id: DashboardPageId; label: string }> = [
  { id: 'project-list', label: 'Projects' },
];

const sidebarProjectNav: Array<{ id: DashboardPageId; label: string }> = [];

const sidebarAdminNav: Array<{ id: DashboardPageId; label: string }> = [
  { id: 'admin-user-org-search', label: 'Users & orgs' },
  { id: 'admin-project-lifecycle', label: 'All projects' },
  { id: 'admin-dns-certificates', label: 'DNS & certs' },
  { id: 'admin-runner-status', label: 'Runners' },
  { id: 'admin-failed-deployments', label: 'Failed deploys' },
  { id: 'admin-audit-events', label: 'Audit log' },
  { id: 'admin-abuse-actions', label: 'Abuse actions' },
];

function isProjectsArea(page: DashboardPageId): boolean {
  return page === 'project-list' || page === 'create-project';
}

function navProject(state: DashboardState): Project | undefined {
  if (isProjectsArea(state.currentPage)) {
    return undefined;
  }
  return state.projects.find((project) => project.id === state.selectedProjectId);
}

export const dashboardSections: DashboardSection[] = [
  {
    id: 'projects',
    title: 'Projects',
    description: 'Create and manage hosted websites and applications.',
  },
  {
    id: 'domains',
    title: 'Domains',
    description: 'Attach platform subdomains and verified custom domains.',
  },
  {
    id: 'deployments',
    title: 'Deployments',
    description: 'Track builds, rollouts, logs, previews, and rollbacks.',
  },
  {
    id: 'assistant',
    title: 'AI assistant preview',
    description: 'Preview/mock post-MVP workflow for reviewed AI change requests.',
  },
  {
    id: 'platform-admin',
    title: 'Platform admin',
    description: 'Audited support, operations, security, and abuse controls separated from project roles.',
  },
];

export const dashboardPages: DashboardPage[] = [
  {
    id: 'agent-quickstart',
    title: 'Agent quickstart',
    description: 'Machine-drivable publish flow, MCP setup, and MVP roadmap imported from the Divband Studio bundle.',
    requiresProject: false,
  },
  {
    id: 'admin-user-org-search',
    title: 'Admin: user/org search',
    description: 'Search users and organizations across the platform.',
    requiresProject: false,
  },
  {
    id: 'admin-project-lifecycle',
    title: 'Admin: project lifecycle',
    description: 'Review lifecycle, suspension, and ownership state for all projects.',
    requiresProject: false,
  },
  {
    id: 'admin-dns-certificates',
    title: 'Admin: DNS/certificates',
    description: 'Inspect domain verification and certificate status.',
    requiresProject: false,
  },
  {
    id: 'admin-runner-status',
    title: 'Admin: runner status',
    description: 'Inspect runner health derived from project runner tags and deployments.',
    requiresProject: false,
  },
  {
    id: 'admin-failed-deployments',
    title: 'Admin: failed deployments',
    description: 'Triage failed deployments across projects.',
    requiresProject: false,
  },
  {
    id: 'admin-audit-events',
    title: 'Admin: audit events',
    description: 'Review recent platform and project audit events.',
    requiresProject: false,
  },
  {
    id: 'admin-abuse-actions',
    title: 'Admin: abuse actions',
    description: 'Record warnings, suspensions, unsuspensions, and deployment restrictions.',
    requiresProject: false,
  },
  {
    id: 'project-list',
    title: 'Project list',
    description: 'Review all active projects and their lifecycle states.',
    requiresProject: false,
  },
  {
    id: 'create-project',
    title: 'Create project',
    description: 'Create a project and queue provisioning work.',
    requiresProject: false,
  },
  {
    id: 'project-overview',
    title: 'Project overview',
    description: 'Summarize the selected project lifecycle, URLs, and metadata.',
    requiresProject: true,
  },
  {
    id: 'gitlab-repository-status',
    title: 'GitLab repository status',
    description: 'Provision the GitLab repository and check runner configuration.',
    requiresProject: true,
  },
  {
    id: 'deployment-status',
    title: 'Deployment status',
    description: 'Trigger builds and inspect the latest deployment state.',
    requiresProject: true,
  },
  {
    id: 'domain-management',
    title: 'Domain management',
    description: 'Attach platform hostnames and verify custom domains.',
    requiresProject: true,
  },
  {
    id: 'environment-variables',
    title: 'Environment variables',
    description: 'Manage masked build and runtime configuration.',
    requiresProject: true,
  },
  {
    id: 'logs-build-history',
    title: 'Logs and build history',
    description: 'Read grouped deployment logs across builds.',
    requiresProject: true,
  },
  {
    id: 'ai-assistant',
    title: 'AI assistant preview',
    description: 'Preview/mock post-MVP workflow for project change requests.',
    requiresProject: true,
  },
];

export const lifecycleStates: Array<{ id: ProjectLifecycleState; label: string; description: string }> = [
  {
    id: 'created',
    label: 'Created',
    description: 'Project metadata exists and provisioning can begin.',
  },
  {
    id: 'repository_provisioned',
    label: 'Repository provisioned',
    description: 'The GitLab project and runner tag have been configured.',
  },
  {
    id: 'namespace_provisioned',
    label: 'Namespace provisioned',
    description: 'The Kubernetes tenant namespace, quota, RBAC, and policies are ready.',
  },
  {
    id: 'building',
    label: 'Building',
    description: 'A build or deployment is queued or running.',
  },
  {
    id: 'deployed',
    label: 'Deployed',
    description: 'The latest deployment completed successfully.',
  },
  {
    id: 'domain_pending_verification',
    label: 'Domain pending verification',
    description: 'A custom domain is waiting for DNS verification.',
  },
  {
    id: 'domain_active',
    label: 'Domain active',
    description: 'A verified domain and certificate are active.',
  },
  {
    id: 'failed',
    label: 'Failed',
    description: 'Provisioning, build, deployment, DNS, or certificate work failed.',
  },
];

export class DivbandApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token?: string;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api';
    this.token = options.token;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  setToken(token?: string): void {
    this.token = token;
  }

  register(input: { email: string; name: string; username?: string; password: string }): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/register', { method: 'POST', body: input, authenticated: false });
  }

  login(input: { email: string; password: string }): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/login', { method: 'POST', body: input, authenticated: false });
  }


  async adminSearchUsers(q = ''): Promise<AuthUser[]> {
    const response = await this.request<{ users: AuthUser[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    return response.users;
  }

  async adminSearchOrganizations(q = ''): Promise<Organization[]> {
    const response = await this.request<{ organizations: Organization[] }>(`/admin/organizations${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    return response.organizations;
  }

  async adminListProjects(): Promise<Project[]> {
    const response = await this.request<{ projects: Project[] }>('/admin/projects');
    return response.projects;
  }

  async adminListDomains(): Promise<Array<ProjectDomain & { projectId: string; projectSlug: string; organizationId: string }>> {
    const response = await this.request<{ domains: Array<ProjectDomain & { projectId: string; projectSlug: string; organizationId: string }> }>('/admin/domains');
    return response.domains;
  }

  async adminRunnerHealth(): Promise<RunnerHealth[]> {
    const response = await this.request<{ runners: RunnerHealth[] }>('/admin/runners/health');
    return response.runners;
  }

  async adminFailedDeployments(): Promise<Array<Deployment & { projectSlug: string; organizationId: string }>> {
    const response = await this.request<{ deployments: Array<Deployment & { projectSlug: string; organizationId: string }> }>('/admin/deployments/failures');
    return response.deployments;
  }

  async adminAuditEvents(): Promise<PlatformAuditEvent[]> {
    const response = await this.request<{ auditEvents: PlatformAuditEvent[] }>('/admin/audit-events');
    return response.auditEvents;
  }

  async adminAbuseActions(): Promise<AbuseAction[]> {
    const response = await this.request<{ abuseActions: AbuseAction[] }>('/admin/abuse-actions');
    return response.abuseActions;
  }

  async createAbuseAction(input: Pick<AbuseAction, 'targetType' | 'targetId' | 'action' | 'reason'>): Promise<AbuseAction> {
    const response = await this.request<{ abuseAction: AbuseAction }>('/admin/abuse-actions', { method: 'POST', body: input });
    return response.abuseAction;
  }

  async listProjects(): Promise<Project[]> {
    const response = await this.request<{ projects: Project[] }>('/projects');
    return response.projects;
  }

  async createProject(input: { name: string; slug?: string }): Promise<Project> {
    const response = await this.request<{ project: Project }>('/projects', { method: 'POST', body: input });
    return response.project;
  }

  async updateProject(projectId: string, input: { name?: string; slug?: string }): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: input });
    return response.project;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  }

  async openWorkspace(projectId: string): Promise<{ url: string; hostname: string; namespace: string; applied: boolean; mode: 'local' | 'kubernetes' }> {
    return this.request<{ url: string; hostname: string; namespace: string; applied: boolean; mode: 'local' | 'kubernetes' }>(
      `/projects/${encodeURIComponent(projectId)}/workspace`,
      { method: 'POST' },
    );
  }

  async getProject(projectId: string): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}`);
    return response.project;
  }

  getProjectStatus(projectId: string): Promise<ProjectStatusSummary> {
    return this.request<ProjectStatusSummary>(`/projects/${encodeURIComponent(projectId)}/status`);
  }

  getRepositoryContents(projectId: string): Promise<{ repository?: ProjectRepository; files: RepositoryFile[] }> {
    return this.request<{ repository?: ProjectRepository; files: RepositoryFile[] }>(`/projects/${encodeURIComponent(projectId)}/repository/contents`);
  }

  async provisionGitLabRepository(projectId: string): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}/github-repository`, { method: 'POST' });
    return response.project;
  }

  async linkGitHubRepository(projectId: string, fullName: string): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}/github-repository`, {
      method: 'POST',
      body: { fullName },
    });
    return response.project;
  }

  async listGitHubRepositories(): Promise<GitHubRepositorySummary[]> {
    const response = await this.request<{ repositories: GitHubRepositorySummary[] }>('/auth/github/repositories');
    return response.repositories;
  }

  async startGitHubOAuth(returnTo: string, projectId?: string, publicOrigin?: string): Promise<string> {
    const response = await this.request<{ authorizationUrl: string }>('/auth/github/oauth/start', {
      method: 'POST',
      body: { returnTo, projectId, publicOrigin },
    });
    return response.authorizationUrl;
  }

  async getGitHubStatus(): Promise<GitHubConnectionStatus> {
    return this.request<GitHubConnectionStatus>('/auth/github/status');
  }

  async linkGitHubIdentity(input: { username: string; accessToken: string; githubUserId?: string }): Promise<void> {
    await this.request('/auth/github-identity', {
      method: 'POST',
      body: {
        username: input.username,
        accessToken: input.accessToken,
        githubUserId: input.githubUserId ?? input.username,
      },
    });
  }

  async provisionNamespace(projectId: string): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}/kubernetes-namespace`, { method: 'POST' });
    return response.project;
  }

  async attachPlatformSubdomain(projectId: string): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}/platform-subdomain`, { method: 'POST' });
    return response.project;
  }

  async addDomain(projectId: string, input: { hostname: string; dnsMode?: DomainDnsMode }): Promise<ProjectDomain> {
    const response = await this.request<{ domain: ProjectDomain }>(`/projects/${encodeURIComponent(projectId)}/domains`, {
      method: 'POST',
      body: input,
    });
    return response.domain;
  }

  async verifyDomain(projectId: string, domainId: string, observedToken?: string): Promise<ProjectDomain> {
    const response = await this.request<{ domain: ProjectDomain }>(
      `/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domainId)}/verify`,
      { method: 'POST', body: observedToken ? { observedToken } : {} },
    );
    return response.domain;
  }

  async triggerDeployment(projectId: string, input: { gitRef?: string; commitSha?: string } = {}): Promise<Deployment> {
    const response = await this.request<{ deployment: Deployment }>(`/projects/${encodeURIComponent(projectId)}/deployments`, {
      method: 'POST',
      body: input,
    });
    return response.deployment;
  }

  async reportDeploymentStatus(projectId: string, input: Partial<Deployment> & { state: Deployment['state']; logLine?: string }): Promise<Deployment> {
    const response = await this.request<{ deployment: Deployment }>(`/projects/${encodeURIComponent(projectId)}/deployments/report`, {
      method: 'POST',
      body: input,
    });
    return response.deployment;
  }

  async rollbackDeployment(projectId: string, deploymentId: string): Promise<Deployment> {
    const response = await this.request<{ deployment: Deployment }>(
      `/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/rollback`,
      { method: 'POST' },
    );
    return response.deployment;
  }

  async getDeployment(projectId: string, deploymentId: string): Promise<Deployment> {
    const response = await this.request<{ deployment: Deployment }>(
      `/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}`,
    );
    return response.deployment;
  }

  async getLogs(projectId: string): Promise<Array<Pick<Deployment, 'id' | 'state' | 'logs'>>> {
    const response = await this.request<{ deployments: Array<Pick<Deployment, 'id' | 'state' | 'logs'>> }>(
      `/projects/${encodeURIComponent(projectId)}/logs`,
    );
    return response.deployments;
  }

  async listEnvironmentVariables(projectId: string): Promise<EnvironmentVariable[]> {
    const response = await this.request<{ environmentVariables: EnvironmentVariable[] }>(
      `/projects/${encodeURIComponent(projectId)}/environment-variables`,
    );
    return response.environmentVariables;
  }

  async saveEnvironmentVariables(projectId: string, variables: Array<{ key: string; value: string; protected?: boolean }>): Promise<EnvironmentVariable[]> {
    const response = await this.request<{ environmentVariables: EnvironmentVariable[] }>(
      `/projects/${encodeURIComponent(projectId)}/environment-variables`,
      { method: 'PUT', body: { variables } },
    );
    return response.environmentVariables;
  }

  async deleteEnvironmentVariable(projectId: string, key: string): Promise<EnvironmentVariable[]> {
    const response = await this.request<{ environmentVariables: EnvironmentVariable[] }>(
      `/projects/${encodeURIComponent(projectId)}/environment-variables/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
    return response.environmentVariables;
  }

  async createAiChangeRequest(input: AssistantChangeRequestInput): Promise<AiChangeRequest> {
    const response = await this.request<{ changeRequest: AiChangeRequest }>(
      `/projects/${encodeURIComponent(input.projectId)}/ai/change-requests`,
      { method: 'POST', body: { prompt: input.prompt, targetBranch: input.targetBranch } },
    );
    return response.changeRequest;
  }

  async listAiChangeRequests(projectId: string): Promise<AiChangeRequest[]> {
    const response = await this.request<{ changeRequests: AiChangeRequest[] }>(`/projects/${encodeURIComponent(projectId)}/ai/change-requests`);
    return response.changeRequests;
  }

  async attachAiContext(projectId: string, changeRequestId: string, input: { summary: string; files: string[] }): Promise<AiChangeRequest> {
    const response = await this.request<{ changeRequest: AiChangeRequest }>(
      `/projects/${encodeURIComponent(projectId)}/ai/change-requests/${encodeURIComponent(changeRequestId)}/context`,
      { method: 'POST', body: input },
    );
    return response.changeRequest;
  }

  async generateAiPatch(projectId: string, changeRequestId: string): Promise<AiChangeRequest> {
    const response = await this.request<{ changeRequest: AiChangeRequest }>(
      `/projects/${encodeURIComponent(projectId)}/ai/change-requests/${encodeURIComponent(changeRequestId)}/patch`,
      { method: 'POST', body: {} },
    );
    return response.changeRequest;
  }

  async createAiBranch(projectId: string, changeRequestId: string, confirmApply: boolean): Promise<AiChangeRequest> {
    const response = await this.request<{ changeRequest: AiChangeRequest }>(
      `/projects/${encodeURIComponent(projectId)}/ai/change-requests/${encodeURIComponent(changeRequestId)}/branch`,
      { method: 'POST', body: { confirmApply } },
    );
    return response.changeRequest;
  }

  async openAiMergeRequest(projectId: string, changeRequestId: string): Promise<AiChangeRequest> {
    const response = await this.request<{ changeRequest: AiChangeRequest }>(
      `/projects/${encodeURIComponent(projectId)}/ai/change-requests/${encodeURIComponent(changeRequestId)}/merge-request`,
      { method: 'POST' },
    );
    return response.changeRequest;
  }

  async getAiChangeRequest(projectId: string, changeRequestId: string): Promise<AiChangeRequest> {
    const response = await this.request<{ changeRequest: AiChangeRequest }>(
      `/projects/${encodeURIComponent(projectId)}/ai/change-requests/${encodeURIComponent(changeRequestId)}`,
    );
    return response.changeRequest;
  }

  async triggerAiCi(projectId: string, changeRequestId: string): Promise<AiChangeRequest> {
    const response = await this.request<{ changeRequest: AiChangeRequest }>(
      `/projects/${encodeURIComponent(projectId)}/ai/change-requests/${encodeURIComponent(changeRequestId)}/ci`,
      { method: 'POST' },
    );
    return response.changeRequest;
  }

  async reportAiStatus(projectId: string, changeRequestId: string, input: { status: string; deploymentReady?: boolean }): Promise<AiChangeRequest> {
    const response = await this.request<{ changeRequest: AiChangeRequest }>(
      `/projects/${encodeURIComponent(projectId)}/ai/change-requests/${encodeURIComponent(changeRequestId)}/status`,
      { method: 'PUT', body: input },
    );
    return response.changeRequest;
  }

  async requestAssistantChange(input: AssistantChangeRequestInput): Promise<AssistantMessage> {
    const changeRequest = await this.createAiChangeRequest(input);
    return {
      id: changeRequest.id,
      role: 'assistant',
      content: `Created AI change request ${changeRequest.id}. Attach context, generate a patch, confirm the branch, and review the merge request before deployment.`,
      createdAt: changeRequest.createdAt,
    };
  }

  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' });
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown; authenticated?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.authenticated !== false && this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => undefined) as { error?: { message?: string } } | T | undefined;

    if (!response.ok) {
      const message = isErrorPayload(payload) ? payload.error.message : undefined;
      throw new Error(message ?? `API request failed with ${response.status}`);
    }

    return payload as T;
  }
}

export function createInitialDashboardState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    currentPage: 'project-list',
    projects: [],
    githubRepositories: [],
    repositoryFiles: [],
    logs: [],
    environmentVariables: [],
    adminUsers: [],
    adminOrganizations: [],
    adminProjects: [],
    adminDomains: [],
    adminRunnerHealth: [],
    adminFailedDeployments: [],
    adminAuditEvents: [],
    adminAbuseActions: [],
    assistantMessages: [],
    aiChangeRequests: [],
    loading: false,
    ...overrides,
  };
}

export function getProjectLifecycleState(status: BackendProjectStatus): ProjectLifecycleState {
  if (status === 'draft' || status === 'archived') {
    return 'created';
  }
  return status;
}

export function getLifecycleLabel(status: BackendProjectStatus): string {
  const state = lifecycleStates.find((item) => item.id === getProjectLifecycleState(status));
  return state?.label ?? 'Created';
}

export function selectProject(state: DashboardState): Project | undefined {
  return state.projects.find((project) => project.id === state.selectedProjectId) ?? state.projects[0];
}


export class DashboardController {
  readonly api: DivbandApiClient;
  state: DashboardState;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private readonly preferInitialRoute: boolean;

  constructor(private readonly options: DashboardControllerOptions) {
    this.storage = options.storage ?? safeLocalStorage();
    const storedToken = options.token ?? getAuthToken();
    const storedUser = getStoredAuthUser<AuthUser>();
    this.api = new DivbandApiClient({ baseUrl: options.baseUrl, token: storedToken, fetch: options.fetch });
    this.state = createInitialDashboardState({
      session: storedToken ? { id: 'stored-session', userId: storedUser?.id ?? 'stored-session', expiresAt: '' } : undefined,
      user: storedUser,
      ...options.initialState,
    });
    this.preferInitialRoute = Boolean(options.initialState?.selectedProjectId);
  }

  async start(): Promise<void> {
    this.options.root.addEventListener('submit', (event) => void this.handleSubmit(event));
    this.options.root.addEventListener('click', (event) => void this.handleClick(event));
    globalThis.addEventListener?.('hashchange', () => void this.navigateFromHash());
    const notice = parseDashboardNotice(globalThis.location?.search);
    if (notice) {
      this.state = { ...this.state, notice: notice.message, noticeVariant: notice.variant };
      clearDashboardNoticeQuery();
    }
    await this.navigateFromHash();
  }

  async navigate(page: DashboardPageId, selectedProjectId = this.state.selectedProjectId): Promise<DashboardActionResult> {
    if (isProjectsArea(page)) {
      selectedProjectId = undefined;
    }
    selectedProjectId ??= projectIdFromHash(globalThis.location?.hash);
    this.state = { ...this.state, currentPage: page, selectedProjectId, loading: true, error: undefined };
    this.render();
    try {
      await this.loadPageData(page, selectedProjectId);
      this.state = { ...this.state, loading: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dashboard request failed.';
      if (isAuthFailure(message)) {
        clearAuthToken();
        globalThis.location.replace('/');
        return { state: this.state, html: this.render() };
      }
      this.state = { ...this.state, loading: false, error: message };
    }
    return { state: this.state, html: this.render() };
  }

  render(): string {
    const html = renderDashboard(this.state);
    this.options.root.innerHTML = html;
    return html;
  }

  private async navigateFromHash(): Promise<DashboardActionResult> {
    if (this.preferInitialRoute && !globalThis.location?.hash) {
      return this.navigate(this.state.currentPage, this.state.selectedProjectId);
    }
    const page = pageFromHash(globalThis.location?.hash) ?? this.state.currentPage;
    return this.navigate(page, projectIdFromHash(globalThis.location?.hash) ?? this.state.selectedProjectId);
  }

  private async loadPageData(page: DashboardPageId, selectedProjectId?: string): Promise<void> {
    if (!this.state.session && !getAuthToken()) {
      globalThis.location.replace('/');
      return;
    }

    if (page === 'admin-user-org-search') {
      const [adminUsers, adminOrganizations] = await Promise.all([this.api.adminSearchUsers(), this.api.adminSearchOrganizations()]);
      this.state = { ...this.state, adminUsers, adminOrganizations };
      return;
    }

    if (page === 'admin-project-lifecycle') {
      this.state = { ...this.state, adminProjects: await this.api.adminListProjects() };
      return;
    }

    if (page === 'admin-dns-certificates') {
      this.state = { ...this.state, adminDomains: await this.api.adminListDomains() };
      return;
    }

    if (page === 'admin-runner-status') {
      this.state = { ...this.state, adminRunnerHealth: await this.api.adminRunnerHealth() };
      return;
    }

    if (page === 'admin-failed-deployments') {
      this.state = { ...this.state, adminFailedDeployments: await this.api.adminFailedDeployments() };
      return;
    }

    if (page === 'admin-audit-events') {
      this.state = { ...this.state, adminAuditEvents: await this.api.adminAuditEvents() };
      return;
    }

    if (page === 'admin-abuse-actions') {
      this.state = { ...this.state, adminAbuseActions: await this.api.adminAbuseActions() };
      return;
    }

    if (page === 'project-list' || page === 'create-project') {
      this.state = { ...this.state, projects: await this.api.listProjects() };
      return;
    }

    const project = selectedProjectId
      ? await this.api.getProject(selectedProjectId)
      : selectProject(this.state) ?? (await this.api.listProjects())[0];
    if (!project) {
      this.state = { ...this.state, projects: await this.api.listProjects() };
      return;
    }

    const projects = upsertById(this.state.projects, project);
    const [statusSummary, githubStatus] = await Promise.all([
      this.api.getProjectStatus(project.id),
      this.api.getGitHubStatus(),
    ]);
    const repositoryReady = Boolean(statusSummary.repositoryUrl ?? project.repositoryUrl);
    let githubRepositories: GitHubRepositorySummary[] = [];
    if (githubStatus.connected && !repositoryReady && (page === 'project-overview' || page === 'gitlab-repository-status')) {
      try {
        githubRepositories = await this.api.listGitHubRepositories();
      } catch {
        githubRepositories = [];
      }
    }
    const baseState = { ...this.state, projects, selectedProjectId: project.id, statusSummary, githubStatus, githubRepositories };

    if (page === 'environment-variables') {
      this.state = { ...baseState, environmentVariables: await this.api.listEnvironmentVariables(project.id) };
    } else if (page === 'project-overview' || page === 'gitlab-repository-status') {
      if (project.repositoryUrl) {
        const repositoryContents = await this.api.getRepositoryContents(project.id);
        const updatedProject = repositoryContents.repository ? { ...project, repository: repositoryContents.repository } : project;
        this.state = {
          ...baseState,
          projects: upsertById(projects, updatedProject),
          repositoryFiles: repositoryContents.files,
        };
      } else {
        this.state = { ...baseState, repositoryFiles: [] };
      }
    } else if (page === 'logs-build-history') {
      this.state = { ...baseState, logs: await this.api.getLogs(project.id) };
    } else if (page === 'ai-assistant') {
      this.state = { ...baseState, aiChangeRequests: await this.api.listAiChangeRequests(project.id) };
    } else {
      this.state = baseState;
    }
  }

  private async handleSubmit(event: Event): Promise<void> {
    const form = event.target instanceof HTMLFormElement ? event.target : undefined;
    if (!form?.dataset.action) return;
    event.preventDefault();
    await this.runAction(async () => {
      const data = new FormData(form);
      switch (form.dataset.action) {
        case 'create-project': {
          const project = await this.api.createProject({ name: String(data.get('name') ?? ''), slug: optionalString(data.get('slug')) });
          this.state = { ...this.state, projects: upsertById(this.state.projects, project), selectedProjectId: project.id };
          globalThis.location.assign(`/projects/${encodeURIComponent(project.id)}`);
          return undefined;
        }
        case 'edit-project': {
          const projectId = requiredProjectId(form);
          const project = await this.api.updateProject(projectId, {
            name: String(data.get('name') ?? ''),
            slug: optionalString(data.get('slug')),
          });
          this.state = { ...this.state, projects: upsertById(this.state.projects, project), selectedProjectId: project.id };
          return this.navigate('project-overview', project.id);
        }
        case 'trigger-deployment':
          await this.api.triggerDeployment(requiredProjectId(form), { gitRef: optionalString(data.get('gitRef')) });
          return this.navigate('deployment-status', requiredProjectId(form));
        case 'add-domain':
          await this.api.addDomain(requiredProjectId(form), {
            hostname: String(data.get('hostname') ?? ''),
            dnsMode: optionalDomainDnsMode(data.get('dnsMode')),
          });
          return this.navigate('domain-management', requiredProjectId(form));
        case 'save-environment-variable':
          await this.api.saveEnvironmentVariables(requiredSelectedProjectId(this.state), [{ key: String(data.get('key') ?? ''), value: String(data.get('value') ?? ''), protected: data.get('protected') === 'on' }]);
          return this.navigate('environment-variables', requiredSelectedProjectId(this.state));
        case 'admin-abuse-action':
          await this.api.createAbuseAction({
            targetType: String(data.get('targetType') ?? '') as AbuseAction['targetType'],
            targetId: String(data.get('targetId') ?? ''),
            action: String(data.get('abuseAction') ?? '') as AbuseAction['action'],
            reason: String(data.get('reason') ?? ''),
          });
          return this.navigate('admin-abuse-actions');
        case 'assistant-request': {
          const message = await this.api.requestAssistantChange({ projectId: requiredProjectId(form), prompt: String(data.get('prompt') ?? ''), targetBranch: optionalString(data.get('targetBranch')) });
          this.state = { ...this.state, assistantMessages: [...this.state.assistantMessages, message] };
          return this.navigate('ai-assistant', requiredProjectId(form));
        }
        case 'link-github-token': {
          const projectId = requiredProjectId(form);
          await this.api.linkGitHubIdentity({
            username: String(data.get('username') ?? ''),
            accessToken: String(data.get('accessToken') ?? ''),
          });
          this.state = {
            ...this.state,
            notice: 'GitHub token linked. Choose a repository or create a new one.',
            noticeVariant: 'success',
          };
          return this.navigate('project-overview', projectId);
        }
      }
      return undefined;
    });
  }

  private async handleClick(event: Event): Promise<void> {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('a[data-action], button[data-action], [role="button"][data-action], a[data-project-id], button[data-project-id], [role="button"][data-project-id]')
      : undefined;
    if (!target) return;
    const action = target.dataset.action;
    const projectId = target.dataset.projectId;
    if (!action && projectId) {
      this.state = { ...this.state, selectedProjectId: projectId };
      return;
    }
    if (!action) return;
    event.preventDefault();
    if (action === 'copy-to-clipboard') {
      await copyToClipboard(requiredDataset(target, 'copyValue'));
      return;
    }
    await this.runAction(async () => {
      switch (action) {
        case 'open-create-project':
          return this.redirect('create-project');
        case 'cancel-create-project':
          return this.redirect('project-list');
        case 'provision-gitlab': {
          const projectId = requiredProjectId(target);
          const project = await this.api.provisionGitLabRepository(projectId);
          this.state = {
            ...this.state,
            projects: upsertById(this.state.projects, project),
            selectedProjectId: projectId,
            notice: project.repository?.offline
              ? 'Offline repository created locally. GitHub API is unreachable from this server — repo links are placeholders until DNS/network is fixed.'
              : 'GitHub repository linked successfully.',
            noticeVariant: 'success',
          };
          return this.navigate('project-overview', projectId);
        }
        case 'link-github-repo': {
          const projectId = requiredProjectId(target);
          const fullName = requiredDataset(target, 'fullName');
          const project = await this.api.linkGitHubRepository(projectId, fullName);
          this.state = {
            ...this.state,
            projects: upsertById(this.state.projects, project),
            selectedProjectId: projectId,
            notice: `Linked GitHub repository ${fullName}.`,
            noticeVariant: 'success',
          };
          return this.navigate('project-overview', projectId);
        }
        case 'connect-github': {
          const projectId = requiredProjectId(target);
          const authorizationUrl = await this.api.startGitHubOAuth(
            `/projects/${encodeURIComponent(projectId)}?notice=github_connected`,
            projectId,
            globalThis.location?.origin,
          );
          globalThis.location.assign(authorizationUrl);
          this.state = { ...this.state, selectedProjectId: projectId };
          return undefined;
        }
        case 'sign-out':
          try {
            await this.api.logout();
          } catch {
            // Clear local session even if logout request fails.
          }
          clearAuthToken();
          globalThis.location.assign('/');
          return undefined;
        case 'provision-namespace':
          await this.api.provisionNamespace(requiredProjectId(target));
          return this.navigate('project-overview', requiredProjectId(target));
        case 'open-workspace': {
          const projectId = requiredProjectId(target);
          const workspace = await this.api.openWorkspace(projectId);
          globalThis.open?.(workspace.url, '_blank', 'noopener,noreferrer');
          this.state = { ...this.state, selectedProjectId: projectId };
          return this.navigate('project-overview', projectId);
        }
        case 'delete-project': {
          const projectId = requiredProjectId(target);
          const project = this.state.projects.find((item) => item.id === projectId) ?? selectProject(this.state);
          const label = project?.name ?? 'this project';
          if (!globalThis.confirm(`Delete "${label}"? This removes Kubernetes resources, the GitHub repository, domains, secrets, and deployments.`)) {
            return undefined;
          }
          await this.api.deleteProject(projectId);
          this.state = {
            ...this.state,
            projects: this.state.projects.filter((item) => item.id !== projectId),
            selectedProjectId: undefined,
            statusSummary: undefined,
          };
          globalThis.history?.replaceState?.(null, '', '/dashboard');
          return this.navigate('project-list');
        }
        case 'attach-platform-subdomain':
          await this.api.attachPlatformSubdomain(requiredProjectId(target));
          return this.navigate('domain-management', requiredProjectId(target));
        case 'verify-domain':
          await this.api.verifyDomain(requiredProjectId(target), requiredDataset(target, 'domainId'));
          return this.navigate('domain-management', requiredProjectId(target));
        case 'ai-attach-context':
          await this.api.attachAiContext(requiredProjectId(target), requiredDataset(target, 'changeRequestId'), { summary: 'Dashboard attached current project metadata.', files: ['README.md'] });
          return this.navigate('ai-assistant', requiredProjectId(target));
        case 'ai-generate-patch':
          await this.api.generateAiPatch(requiredProjectId(target), requiredDataset(target, 'changeRequestId'));
          return this.navigate('ai-assistant', requiredProjectId(target));
        case 'ai-create-branch':
          await this.api.createAiBranch(requiredProjectId(target), requiredDataset(target, 'changeRequestId'), target.dataset.confirmApply === 'true');
          return this.navigate('ai-assistant', requiredProjectId(target));
        case 'ai-open-merge-request':
          await this.api.openAiMergeRequest(requiredProjectId(target), requiredDataset(target, 'changeRequestId'));
          return this.navigate('ai-assistant', requiredProjectId(target));
        case 'ai-trigger-ci':
          await this.api.triggerAiCi(requiredProjectId(target), requiredDataset(target, 'changeRequestId'));
          return this.navigate('ai-assistant', requiredProjectId(target));
      }
      return undefined;
    });
  }

  private async applyAuth(response: AuthResponse): Promise<void> {
    this.api.setToken(response.token);
    setAuthSession(response.token, response.user);
    this.state = { ...this.state, user: response.user, session: response.session };
  }

  private redirect(page: DashboardPageId, selectedProjectId = this.state.selectedProjectId): Promise<DashboardActionResult> {
    const hash = page === 'project-list'
      ? ''
      : selectedProjectId
        ? `#${page}?projectId=${encodeURIComponent(selectedProjectId)}`
        : `#${page}`;
    globalThis.history?.replaceState?.(null, '', `/dashboard${hash}`);
    return this.navigate(page, selectedProjectId);
  }

  private async runAction(action: () => Promise<DashboardActionResult | undefined>): Promise<void> {
    this.state = { ...this.state, loading: true, error: undefined };
    this.render();
    try {
      await action();
    } catch (error) {
      this.state = { ...this.state, loading: false, error: error instanceof Error ? error.message : 'Dashboard action failed.' };
      this.render();
    }
  }
}

export function mountDashboard(options: DashboardControllerOptions): DashboardController {
  const controller = new DashboardController(options);
  void controller.start();
  return controller;
}

export function renderDashboard(state: DashboardState): string {
  const selectedProject = selectProject(state);
  const sidebarProject = navProject(state);
  return `
    <main class="dashboard-shell">
      <aside class="dashboard-sidebar">
        <div class="brand-lockup">
          <p class="eyebrow">divband</p>
          <h1>Ship projects fast</h1>
          <p class="brand-tagline">GitHub, Kubernetes, and live URLs on <strong>${escapeHtml(state.user?.username ? `${state.user.username}.divband.com` : 'yourname.divband.com')}</strong></p>
        </div>
        ${state.user ? `<div class="user-chip"><span>Signed in as</span><strong>@${escapeHtml(state.user.username || state.user.name)}</strong><button type="button" class="button-secondary" data-action="sign-out">Sign out</button></div>` : ''}
        ${renderNavigation(state, sidebarProject)}
      </aside>
      <section class="dashboard-content">
        ${state.notice ? `<div class="alert ${state.noticeVariant === 'error' ? 'alert-error' : 'alert-success'}">${escapeHtml(state.notice)}</div>` : ''}
        ${state.error ? `<div class="alert alert-error">${escapeHtml(state.error)}</div>` : ''}
        ${state.loading ? '<div class="alert">Loading latest backend API data…</div>' : ''}
        ${renderCurrentPage(state, selectedProject)}
      </section>
    </main>`;
}

function renderNavigation(state: DashboardState, selectedProject?: Project): string {
  const isPlatformAdmin = Boolean(state.user?.platformAdminRole);
  const mainNav = sidebarMainNav.map((item) => {
    const active = isProjectsArea(state.currentPage) && item.id === 'project-list';
    return `<a class="${active ? 'active' : ''}" href="${escapeHtml(pageHref('project-list'))}">${escapeHtml(item.label)}</a>`;
  }).join('');

  const projectNav = selectedProject && sidebarProjectNav.length
    ? `
      <div class="nav-group">
        <p class="nav-group-label">${escapeHtml(selectedProject.name)}</p>
        ${sidebarProjectNav.map((item) => {
          const active = state.currentPage === item.id;
          return `<a class="${active ? 'active' : ''}" href="${escapeHtml(pageHref(item.id, selectedProject.id))}">${escapeHtml(item.label)}</a>`;
        }).join('')}
      </div>`
    : selectedProject
      ? `<div class="nav-group"><p class="nav-group-label">${escapeHtml(selectedProject.name)}</p></div>`
      : '';

  const adminNav = isPlatformAdmin
    ? `
      <div class="nav-group nav-group-admin">
        <p class="nav-group-label">Admin</p>
        ${sidebarAdminNav.map((item) => {
          const active = state.currentPage === item.id;
          return `<a class="${active ? 'active' : ''}" href="${escapeHtml(pageHref(item.id))}">${escapeHtml(item.label)}</a>`;
        }).join('')}
      </div>`
    : '';

  return `<nav>${mainNav}${projectNav}${adminNav}</nav>`;
}

function renderCurrentPage(state: DashboardState, selectedProject?: Project): string {
  switch (state.currentPage) {
    case 'create-project':
    case 'project-list':
      return renderProjectsPage(state.projects, state.user?.username, state.currentPage === 'create-project');
    case 'agent-quickstart':
      return renderAgentQuickstartPage();
    case 'project-overview':
    case 'gitlab-repository-status':
      return renderProjectOverviewPage(selectedProject, state.statusSummary, state.githubStatus, state.githubRepositories);
    case 'deployment-status':
      return renderDeploymentStatusPage(selectedProject, state.statusSummary, state.githubStatus);
    case 'domain-management':
      return renderDomainManagementPage(selectedProject, state.statusSummary);
    case 'environment-variables':
      return renderEnvironmentVariablesPage(selectedProject, state.environmentVariables);
    case 'logs-build-history':
      return renderLogsPage(selectedProject, state.logs);
    case 'ai-assistant':
      return renderAssistantPage(selectedProject, state.assistantMessages, state.aiChangeRequests);
    case 'admin-user-org-search':
      return renderAdminUserOrgSearchPage(state.adminUsers, state.adminOrganizations);
    case 'admin-project-lifecycle':
      return renderAdminProjectLifecyclePage(state.adminProjects);
    case 'admin-dns-certificates':
      return renderAdminDnsCertificatesPage(state.adminDomains);
    case 'admin-runner-status':
      return renderAdminRunnerStatusPage(state.adminRunnerHealth);
    case 'admin-failed-deployments':
      return renderAdminFailedDeploymentsPage(state.adminFailedDeployments);
    case 'admin-audit-events':
      return renderAdminAuditEventsPage(state.adminAuditEvents);
    case 'admin-abuse-actions':
      return renderAdminAbuseActionsPage(state.adminAbuseActions);
    default:
      return renderProjectsPage(state.projects, state.user?.username, false);
  }
}


function renderAdminUserOrgSearchPage(users: AuthUser[], organizations: Organization[]): string {
  const userRows = users.length ? users.map((user) => `<tr><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.platformAdminRole ?? 'none')}</td><td>${escapeHtml(user.suspendedAt ?? 'active')}</td></tr>`).join('') : '<tr><td colspan="4">No users visible or admin access denied.</td></tr>';
  const orgRows = organizations.length ? organizations.map((org) => `<tr><td>${escapeHtml(org.name)}</td><td>${escapeHtml(org.slug)}</td><td>${escapeHtml(org.suspendedAt ?? 'active')}</td><td>${escapeHtml(org.updatedAt)}</td></tr>`).join('') : '<tr><td colspan="4">No organizations visible or admin access denied.</td></tr>';
  return `<article class="card"><h2>Admin user/org search</h2><p>Uses audited <code>GET /admin/users</code> and <code>GET /admin/organizations</code>.</p><h3>Users</h3><table><thead><tr><th>Email</th><th>Name</th><th>Platform role</th><th>Status</th></tr></thead><tbody>${userRows}</tbody></table><h3>Organizations</h3><table><thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Updated</th></tr></thead><tbody>${orgRows}</tbody></table></article>`;
}

function renderAdminProjectLifecyclePage(projects: Project[]): string {
  const rows = projects.length ? projects.map((project) => `<tr><td>${escapeHtml(project.name)}</td><td>${escapeHtml(project.slug)}</td><td>${escapeHtml(getLifecycleLabel(project.status))}</td><td>${escapeHtml(project.suspendedAt ?? 'active')}</td><td>${escapeHtml(project.updatedAt)}</td></tr>`).join('') : '<tr><td colspan="5">No projects.</td></tr>';
  return `<article class="card"><h2>Project lifecycle overview</h2><p>Uses audited <code>GET /admin/projects</code>.</p><table><thead><tr><th>Name</th><th>Slug</th><th>Lifecycle</th><th>Status</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table></article>`;
}

function renderAdminDnsCertificatesPage(domains: Array<ProjectDomain & { projectId: string; projectSlug: string; organizationId: string }>): string {
  const rows = domains.length ? domains.map((domain) => `<tr><td>${escapeHtml(domain.hostname)}</td><td>${escapeHtml(domain.projectSlug)}</td><td>${domain.verified ? 'verified' : 'pending'}</td><td>${escapeHtml(domain.certificateStatus)}</td><td>${escapeHtml(domain.verifiedAt ?? 'not verified')}</td></tr>`).join('') : '<tr><td colspan="5">No domains.</td></tr>';
  return `<article class="card"><h2>DNS/certificate status</h2><p>Uses audited <code>GET /admin/domains</code>.</p><table><thead><tr><th>Hostname</th><th>Project</th><th>DNS</th><th>Certificate</th><th>Verified at</th></tr></thead><tbody>${rows}</tbody></table></article>`;
}

function renderAdminRunnerStatusPage(runners: RunnerHealth[]): string {
  const rows = runners.length ? runners.map((runner) => `<tr><td>${escapeHtml(runner.runnerTag)}</td><td>${escapeHtml(runner.projectSlug)}</td><td>${escapeHtml(runner.status)}</td><td>${escapeHtml(runner.latestDeploymentState ?? 'none')}</td><td>${escapeHtml(runner.checkedAt)}</td></tr>`).join('') : '<tr><td colspan="5">No runner tags.</td></tr>';
  return `<article class="card"><h2>Runner status</h2><p>Uses audited <code>GET /admin/runners/health</code>.</p><table><thead><tr><th>Runner tag</th><th>Project</th><th>Health</th><th>Latest deployment</th><th>Checked</th></tr></thead><tbody>${rows}</tbody></table></article>`;
}

function renderAdminFailedDeploymentsPage(deployments: Array<Deployment & { projectSlug: string; organizationId: string }>): string {
  const rows = deployments.length ? deployments.map((deployment) => `<tr><td>${escapeHtml(deployment.id)}</td><td>${escapeHtml(deployment.projectSlug)}</td><td>${escapeHtml(deployment.gitRef)}</td><td>${escapeHtml(deployment.finishedAt ?? 'unfinished')}</td><td>${escapeHtml(deployment.jobUrl ?? 'n/a')}</td></tr>`).join('') : '<tr><td colspan="5">No failed deployments.</td></tr>';
  return `<article class="card"><h2>Failed deployments</h2><p>Uses audited <code>GET /admin/deployments/failures</code>.</p><table><thead><tr><th>Deployment</th><th>Project</th><th>Git ref</th><th>Finished</th><th>Job</th></tr></thead><tbody>${rows}</tbody></table></article>`;
}

function renderAdminAuditEventsPage(events: PlatformAuditEvent[]): string {
  const rows = events.length ? events.map((event) => `<tr><td>${escapeHtml(event.createdAt)}</td><td>${escapeHtml(event.actorId)}</td><td>${escapeHtml(event.action)}</td><td>${escapeHtml(event.projectId ?? 'platform')}</td></tr>`).join('') : '<tr><td colspan="4">No audit events.</td></tr>';
  return `<article class="card"><h2>Audit events</h2><p>Uses audited <code>GET /admin/audit-events</code>; route access is also written back to audit logs.</p><table><thead><tr><th>Created</th><th>Actor</th><th>Action</th><th>Scope</th></tr></thead><tbody>${rows}</tbody></table></article>`;
}

function renderAdminAbuseActionsPage(actions: AbuseAction[]): string {
  const rows = actions.length ? actions.map((action) => `<tr><td>${escapeHtml(action.createdAt)}</td><td>${escapeHtml(action.targetType)}</td><td>${escapeHtml(action.targetId)}</td><td>${escapeHtml(action.action)}</td><td>${escapeHtml(action.reason)}</td></tr>`).join('') : '<tr><td colspan="5">No abuse actions.</td></tr>';
  return `<article class="card"><h2>Abuse/suspension actions</h2><p>Uses audited <code>GET/POST /admin/abuse-actions</code>.</p><form data-action="admin-abuse-action"><label>Target type <select name="targetType"><option>user</option><option>organization</option><option>project</option><option>domain</option></select></label><label>Target ID <input name="targetId" required></label><label>Action <select name="abuseAction"><option>warn</option><option>suspend</option><option>unsuspend</option><option>restrict_deployments</option></select></label><label>Reason <input name="reason" required></label><button type="submit">Record abuse action</button></form><table><thead><tr><th>Created</th><th>Type</th><th>Target</th><th>Action</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></article>`;
}


function renderAgentQuickstartPage(): string {
  const phases = agentRoadmapPhases
    .map((phase) => `<li><strong>${escapeHtml(phase.id)} · ${escapeHtml(phase.name)}</strong><span class="badge badge-${escapeHtml(phase.status)}">${escapeHtml(phase.status)}</span><p>${escapeHtml(phase.description)}</p></li>`)
    .join('');

  return `
    <article class="card hero-card">
      <p class="eyebrow">Agent-first instant hosting</p>
      <h2>Publish static output from agents, CI, or the dashboard.</h2>
      <p>The imported Divband Studio bundle frames the platform around one wedge: build a site locally, create a publish session, upload validated files, finalize an immutable version, and serve it at a Divband URL before graduating to domains or full project hosting.</p>
      <div class="quickstart-grid">
        <div>
          <h3>REST publish session</h3>
          <p>Agents should publish only build output directories, never source roots, secrets, dependency folders, or local home directories.</p>
          <pre><code>${escapeHtml(agentQuickstartCurl)}</code></pre>
        </div>
        <div>
          <h3>MCP setup</h3>
          <p>Use the MCP server for tool-driven publish, update, claim, inspect, list, and delete flows with the same validation as REST.</p>
          <pre><code>${escapeHtml(agentQuickstartMcp)}</code></pre>
        </div>
      </div>
    </article>
    <article class="card">
      <h2>Imported roadmap emphasis</h2>
      <p>These phases keep the dashboard aligned with the extracted product/design bundle while preserving this repository's current implementation status.</p>
      <ol class="roadmap-list">${phases}</ol>
    </article>`;
}

function renderProjectsPage(projects: Project[], username?: string, showCreateForm = false): string {
  const hostExample = username ? `${'{slug}'}.${username}.divband.com` : '{slug}.{username}.divband.com';
  const createPanel = showCreateForm
    ? `
      <article class="card">
        <header class="page-header">
          <div>
            <h2>New project</h2>
            <p>Your project will live at <code>${escapeHtml(hostExample)}</code> in namespace <code>user-${escapeHtml(username ?? '{username}')}</code>.</p>
          </div>
          <button type="button" class="button-secondary" data-action="cancel-create-project">Cancel</button>
        </header>
        <form data-action="create-project">
          <label>Project name <input name="name" placeholder="Marketing site" required></label>
          <label>Slug <input name="slug" placeholder="marketing-site"><span class="muted">Used in the URL and GitHub repo name.</span></label>
          <button type="submit">Create project</button>
        </form>
      </article>`
    : '';

  const header = `
    <header class="page-header">
      <div>
        <h2>Projects</h2>
        <p>Pick a project to connect GitHub and choose a repository${username ? ` under <strong>*.${escapeHtml(username)}.divband.com</strong>` : ''}.</p>
      </div>
      ${showCreateForm ? '' : '<button type="button" data-action="open-create-project">New project</button>'}
    </header>`;

  if (projects.length) {
    const cards = projects.map((project) => `
      <a class="project-card project-card-link" href="${escapeHtml(pageHref('project-overview', project.id))}">
        <div class="project-card-head">
          <div>
            <h3>${escapeHtml(project.name)}</h3>
            <p class="muted">${escapeHtml(project.platformHostname)}</p>
          </div>
          <span class="status status-${escapeHtml(getProjectLifecycleState(project.status))}">${escapeHtml(getLifecycleLabel(project.status))}</span>
        </div>
        ${project.repositoryUrl ? `<p class="muted project-card-repo">${escapeHtml(project.repository?.path ?? project.repositoryUrl)}</p>` : '<p class="muted">GitHub not connected yet</p>'}
      </a>`).join('');

    return `
      ${createPanel}
      <article class="card">
        ${header}
        <div class="project-grid">${cards}</div>
      </article>`;
  }

  return `
    ${createPanel}
    <article class="card hero-card">
      ${header}
      <p class="muted">You do not have any projects yet. Create one to connect GitHub, provision Kubernetes, and get a live URL like <code>my-app.${escapeHtml(username ?? 'you')}.divband.com</code>.</p>
    </article>`;
}

function renderProjectListPage(projects: Project[], selectedProjectId?: string, username?: string): string {
  return renderProjectsPage(projects, username, false);
}

function renderCreateProjectPage(username?: string): string {
  return renderProjectsPage([], username, true);
}

function isLocalDashboard(): boolean {
  const host = globalThis.location?.hostname ?? '';
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

function projectDeployment(project: Project, summary?: ProjectStatusSummary): Deployment | undefined {
  return summary?.latestDeployment ?? project.deployments.at(-1);
}

function projectLiveUrlState(project: Project, summary?: ProjectStatusSummary): {
  hostname: string;
  canOpen: boolean;
  statusLabel: string;
  statusDetail: string;
  statusClass: string;
} {
  const hostname = project.platformHostname;
  const deployment = projectDeployment(project, summary);
  const repositoryReady = Boolean(summary?.repositoryUrl ?? project.repositoryUrl);
  const namespaceReady = summary?.namespaceProvisioned ?? project.namespaceProvisioned;
  const subdomainAttached = summary?.platformSubdomainAttached ?? project.platformSubdomainAttached;
  const deployed = deployment?.state === 'succeeded'
    || summary?.status === 'deployed'
    || summary?.status === 'domain_active';

  if (deployed && subdomainAttached && !isLocalDashboard()) {
    return {
      hostname,
      canOpen: true,
      statusLabel: 'Live',
      statusDetail: 'Your site is published at this URL.',
      statusClass: 'status-deployed',
    };
  }

  if (deployed && subdomainAttached && isLocalDashboard()) {
    return {
      hostname,
      canOpen: false,
      statusLabel: 'Deployed locally',
      statusDetail: 'Deployment succeeded in local dev, but this divband.com URL only works in production once DNS and Kubernetes are configured.',
      statusClass: 'status-building',
    };
  }

  if (deployment && deployment.state !== 'succeeded' && deployment.state !== 'failed') {
    return {
      hostname,
      canOpen: false,
      statusLabel: 'Deploying',
      statusDetail: 'Your latest deployment is still running.',
      statusClass: 'status-building',
    };
  }

  if (!repositoryReady) {
    return {
      hostname,
      canOpen: false,
      statusLabel: 'Not set up yet',
      statusDetail: 'Connect GitHub and push your first deployment to make this URL live.',
      statusClass: 'status-created',
    };
  }

  if (!namespaceReady) {
    return {
      hostname,
      canOpen: false,
      statusLabel: 'Waiting on infrastructure',
      statusDetail: 'Provision Kubernetes for this project, then deploy to publish your site.',
      statusClass: 'status-created',
    };
  }

  if (!deployment || deployment.state === 'failed') {
    return {
      hostname,
      canOpen: false,
      statusLabel: 'Not published',
      statusDetail: 'Trigger a deployment from the Deployments tab to publish your site to this URL.',
      statusClass: 'status-created',
    };
  }

  if (!subdomainAttached) {
    return {
      hostname,
      canOpen: false,
      statusLabel: 'DNS not attached',
      statusDetail: 'Attach the platform subdomain from the Domains tab after your first deployment.',
      statusClass: 'status-created',
    };
  }

  return {
    hostname,
    canOpen: false,
    statusLabel: 'Not live yet',
    statusDetail: 'Finish deploying your project to publish content to this URL.',
    statusClass: 'status-created',
  };
}

function projectPipelineReadiness(project: Project, summary?: ProjectStatusSummary, githubStatus?: GitHubConnectionStatus) {
  const githubConnected = Boolean(githubStatus?.connected);
  const repositoryReady = Boolean(summary?.repositoryUrl ?? project.repositoryUrl);
  const namespaceReady = summary?.namespaceProvisioned ?? project.namespaceProvisioned;
  const deployment = projectDeployment(project, summary);
  const deploymentReady = deployment?.state === 'succeeded';
  return { githubConnected, repositoryReady, namespaceReady, deploymentReady, deployment };
}

function renderGitHubSetupDiagnostics(githubStatus?: GitHubConnectionStatus): string {
  if (!githubStatus?.configured) {
    return `
      <div class="github-setup-diagnostics">
        <p class="muted">GitHub OAuth is not configured. Copy <code>apps/frontend/.env.local.example</code> to <code>apps/frontend/.env.local</code> and add your OAuth app credentials.</p>
      </div>`;
  }

  const credentialLine = githubStatus.usingCustomCredentials
    ? `Using your OAuth app (<code>${escapeHtml(githubStatus.clientIdPreview ?? 'custom')}</code>).`
    : `Using the bundled local OAuth app (<code>${escapeHtml(githubStatus.clientIdPreview ?? 'bundled')}</code>). Add your own app via <code>apps/frontend/.env.local</code>.`;

  const networkLine = githubStatus.serverReachable === false
    ? '<p class="local-dev-note">This server cannot reach GitHub right now (DNS/network). OAuth authorize works in the browser, but completing the connection requires the server to call GitHub. Fix DNS or use a GitHub personal access token below.</p>'
    : '<p class="muted">Server can reach GitHub.</p>';

  return `
    <div class="github-setup-diagnostics">
      <p class="muted">${credentialLine}</p>
      <p class="muted">Callback URL registered in GitHub must match: <code>${escapeHtml(githubStatus.callbackUrl ?? 'http://localhost:3000/api/auth/callback/github')}</code></p>
      ${networkLine}
    </div>`;
}

function renderGitHubRepositoryPicker(project: Project, repositories: GitHubRepositorySummary[]): string {
  if (!repositories.length) {
    return `
      <section class="github-repo-picker">
        <h4>Your GitHub repositories</h4>
        <p class="muted">No repositories were returned from GitHub. Create a new repository for this project below.</p>
      </section>`;
  }

  const rows = repositories.map((repo) => `
    <li class="github-repo-option">
      <div>
        <strong>${escapeHtml(repo.fullName)}</strong>
        <p class="muted">${repo.private ? 'Private' : 'Public'} · ${escapeHtml(repo.defaultBranch)}</p>
      </div>
      <div class="github-repo-option-actions">
        <a class="button-secondary" href="${escapeHtml(repo.webUrl)}" target="_blank" rel="noreferrer">View</a>
        <button type="button" data-action="link-github-repo" data-project-id="${escapeHtml(project.id)}" data-full-name="${escapeHtml(repo.fullName)}">Use this repo</button>
      </div>
    </li>`).join('');

  return `
    <section class="github-repo-picker">
      <h4>Your GitHub repositories</h4>
      <p class="muted">Choose an existing repository for <strong>${escapeHtml(project.name)}</strong>, or create a new one below.</p>
      <ul class="github-repo-list">${rows}</ul>
    </section>`;
}

function renderGitHubConnectPanel(
  project: Project,
  summary?: ProjectStatusSummary,
  githubStatus?: GitHubConnectionStatus,
  githubRepositories: GitHubRepositorySummary[] = [],
): string {
  const { githubConnected, repositoryReady } = projectPipelineReadiness(project, summary, githubStatus);
  const githubUsername = githubStatus?.username;
  const diagnostics = renderGitHubSetupDiagnostics(githubStatus);

  if (!githubStatus?.configured) {
    return `
      <article class="card github-connect-card">
        <h3>GitHub is not configured</h3>
        ${diagnostics}
      </article>`;
  }

  if (repositoryReady && project.repositoryUrl) {
    const repository = project.repository;
    const offlineNote = repository?.offline
      ? '<p class="local-dev-note">This is an offline placeholder repository. It was not created on GitHub because this server cannot reach the GitHub API.</p>'
      : '';
    return `
      <article class="card github-connect-card github-connect-card-success">
        <div class="github-connect-header">
          <div class="github-mark" aria-hidden="true">${githubMarkSvg()}</div>
          <div>
            <p class="eyebrow">${repository?.offline ? 'Offline repository ready' : 'GitHub connected'}</p>
            <h3>Repository ready</h3>
            <p class="muted">${repository?.offline ? `Local repo record for @${escapeHtml(githubUsername ?? 'github-user')}.` : `Code for this project lives in a private GitHub repo under ${githubUsername ? `@${escapeHtml(githubUsername)}` : 'your account'}.`}</p>
          </div>
        </div>
        ${offlineNote}
        <div class="github-repo-summary">
          <a class="github-repo-link" href="${escapeHtml(project.repositoryUrl)}" target="_blank" rel="noreferrer">${escapeHtml(repository?.path ?? project.repositoryUrl)}</a>
          ${repository?.cloneUrl && !repository.offline ? `<button type="button" class="button-secondary" data-action="copy-to-clipboard" data-copy-value="${escapeHtml(repository.cloneUrl)}">Copy clone URL</button>` : ''}
        </div>
        <p class="muted github-safe-note">${repository?.offline ? 'Fix server DNS/network to create the real GitHub repo later.' : `Divband only uses this repo for deployments and CI for <strong>${escapeHtml(project.name)}</strong>.`}</p>
        <button type="button" data-action="open-workspace" data-project-id="${escapeHtml(project.id)}">Open VS Code</button>
      </article>`;
  }

  if (githubConnected) {
    const offlineHint = githubStatus?.serverReachable === false
      ? '<p class="local-dev-note">GitHub API is unreachable from this server. You can still create a local offline repository record to continue testing.</p>'
      : '';
    const createButtonLabel = githubStatus?.serverReachable === false ? 'Create offline repository' : 'Create new repository';
    return `
      <article class="card github-connect-card">
        <div class="github-connect-header">
          <div class="github-mark" aria-hidden="true">${githubMarkSvg()}</div>
          <div>
            <p class="eyebrow">GitHub account linked</p>
            <h3>@${escapeHtml(githubUsername ?? 'github-user')}</h3>
            <p class="muted">Select one of your GitHub repositories or create a new private repo for this project.</p>
          </div>
        </div>
        ${renderGitHubRepositoryPicker(project, githubRepositories)}
        ${offlineHint}
        <div class="github-create-repo">
          <button type="button" data-action="provision-gitlab" data-project-id="${escapeHtml(project.id)}">${createButtonLabel}</button>
        </div>
      </article>`;
  }

  return `
    <article class="card github-connect-card">
      ${diagnostics}
      <div class="github-connect-header">
        <div class="github-mark" aria-hidden="true">${githubMarkSvg()}</div>
        <div>
          <p class="eyebrow">Step 1</p>
          <h3>Connect GitHub</h3>
          <p class="muted">Authorize Divband to create and manage one private repo for <strong>${escapeHtml(project.name)}</strong>. This unlocks provisioning, deployments, and your live URL.</p>
        </div>
      </div>
      <ul class="github-permissions">
        <li>Read your GitHub profile (<code>read:user</code>)</li>
        <li>Create and update the project repository (<code>repo</code>)</li>
        <li>No access to your other repositories unless you connect them separately</li>
      </ul>
      <button type="button" data-action="connect-github" data-project-id="${escapeHtml(project.id)}" ${githubStatus.serverReachable === false ? 'disabled title="Server cannot reach GitHub — fix DNS/network or use a token below"' : ''}>Connect GitHub account</button>
      <details class="github-token-fallback">
        <summary>Or link a GitHub personal access token</summary>
        <form data-action="link-github-token" data-project-id="${escapeHtml(project.id)}">
          <label>GitHub username <input name="username" placeholder="your-login" required></label>
          <label>Personal access token <input name="accessToken" type="password" placeholder="github_pat_..." required autocomplete="off"></label>
          <button type="submit">Link token</button>
        </form>
        <p class="muted">Create a classic token with <code>repo</code> scope at GitHub → Settings → Developer settings → Personal access tokens.</p>
      </details>
      <p class="muted github-safe-note">You will be redirected to GitHub to approve access, then returned here automatically.</p>
    </article>`;
}

function renderProjectPipelineActions(project: Project, summary?: ProjectStatusSummary, githubStatus?: GitHubConnectionStatus): string {
  const { githubConnected, repositoryReady, namespaceReady, deploymentReady } = projectPipelineReadiness(project, summary, githubStatus);

  return `
    <section class="pipeline-actions">
      <h3>Next steps</h3>
      <div class="pipeline-action-grid">
        <div class="pipeline-action ${namespaceReady ? 'done' : ''}">
          <strong>Provision infrastructure</strong>
          <p class="muted">${namespaceReady ? 'Kubernetes namespace is ready.' : 'Creates the isolated namespace for this project.'}</p>
          <button type="button" data-action="provision-namespace" data-project-id="${escapeHtml(project.id)}" ${repositoryReady ? '' : 'disabled title="Connect GitHub and create a repository first"'}>${namespaceReady ? 'Re-provision namespace' : 'Provision namespace'}</button>
        </div>
        <div class="pipeline-action ${deploymentReady ? 'done' : ''}">
          <strong>Deploy</strong>
          <p class="muted">${deploymentReady ? 'Latest deployment succeeded.' : 'Build and publish your site from GitHub.'}</p>
          ${namespaceReady && repositoryReady
            ? `<a class="button" href="${escapeHtml(pageHref('deployment-status', project.id))}">Open deployments</a>`
            : '<span class="button button-disabled" title="Connect GitHub, create a repo, and provision infrastructure first">Open deployments</span>'}
        </div>
        <div class="pipeline-action">
          <strong>Go live</strong>
          <p class="muted">${deploymentReady ? 'Attach DNS after a successful deployment.' : 'Available after your first successful deployment.'}</p>
          ${deploymentReady
            ? `<a class="button button-secondary" href="${escapeHtml(pageHref('domain-management', project.id))}">Manage domains</a>`
            : '<span class="button button-secondary button-disabled" title="Deploy successfully before attaching your live URL">Manage domains</span>'}
        </div>
      </div>
      ${!githubConnected ? '<p class="muted pipeline-hint">Connect GitHub above before provisioning or deploying.</p>' : ''}
      ${githubConnected && !repositoryReady ? '<p class="muted pipeline-hint">Create the project repository before provisioning infrastructure.</p>' : ''}
    </section>`;
}

function githubMarkSvg(): string {
  return '<svg viewBox="0 0 98 96" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.436-5.787-16.436-5.787-2.22-5.623-5.418-7.112-5.418-7.112-4.404-3.01.334-2.952.334-2.952 4.872.322 7.436 5.012 7.436 5.012 4.331 7.425 11.364 5.282 14.125 4.039.436-3.138 1.699-5.282 3.093-6.497-10.839-1.225-22.243-5.414-22.243-24.106 0-5.326 1.903-9.678 5.008-13.095-.502-1.225-2.173-6.16 0.477-12.85 0 0 4.086-1.303 13.386 4.992 3.878-1.078 8.037-1.617 12.172-1.636 4.135.019 8.296.558 12.183 1.636 9.298-6.295 13.382-4.992 13.382-4.992 2.652 6.69 0.981 11.625 0.479 12.85 3.107 3.417 5.006 7.769 5.006 13.095 0 18.718-11.423 22.875-22.286 24.085 1.753 1.512 3.315 4.481 3.315 9.605 0 6.935-.063 12.517-.063 14.229 0 1.385 1.011 2.848 3.317 2.365 19.396-6.528 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"/></svg>';
}

function renderProjectSetupSteps(project: Project, summary?: ProjectStatusSummary, githubStatus?: GitHubConnectionStatus): string {
  const { githubConnected, repositoryReady, namespaceReady, deploymentReady } = projectPipelineReadiness(project, summary, githubStatus);
  const liveReady = projectLiveUrlState(project, summary).canOpen;

  const steps = [
    {
      label: 'Connect GitHub',
      detail: repositoryReady
        ? 'Repository connected.'
        : githubConnected
          ? 'GitHub linked — create the project repository next.'
          : 'Link your GitHub account to start.',
      done: repositoryReady,
    },
    {
      label: 'Provision infrastructure',
      detail: namespaceReady ? 'Kubernetes namespace is ready.' : 'Create the namespace for this project.',
      done: namespaceReady,
    },
    {
      label: 'Deploy your site',
      detail: deploymentReady ? 'Latest deployment succeeded.' : 'Run your first deployment from GitHub.',
      done: deploymentReady,
    },
    {
      label: 'Go live',
      detail: liveReady ? 'Your site is reachable at the live URL.' : 'Attach DNS after a successful deployment.',
      done: liveReady,
    },
  ];

  return `
    <section class="setup-steps">
      <h3>Getting started</h3>
      <ol class="setup-step-list">
        ${steps.map((step) => `
          <li class="setup-step ${step.done ? 'done' : ''}">
            <span class="setup-step-marker" aria-hidden="true">${step.done ? '✓' : '○'}</span>
            <div>
              <strong>${escapeHtml(step.label)}</strong>
              <p class="muted">${escapeHtml(step.detail)}</p>
            </div>
          </li>`).join('')}
      </ol>
    </section>`;
}

function renderProjectOverviewPage(
  project?: Project,
  summary?: ProjectStatusSummary,
  githubStatus?: GitHubConnectionStatus,
  githubRepositories: GitHubRepositorySummary[] = [],
): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  const { repositoryReady } = projectPipelineReadiness(project, summary, githubStatus);

  return `
    <article class="card">
      <header class="page-header">
        <div>
          <h2>${escapeHtml(project.name)}</h2>
          <p class="muted">${escapeHtml(project.platformHostname)}</p>
        </div>
        <div class="quick-actions">
          ${repositoryReady ? `<button type="button" data-action="open-workspace" data-project-id="${escapeHtml(project.id)}">Open VS Code</button>` : ''}
        </div>
      </header>
    </article>
    ${renderGitHubConnectPanel(project, summary, githubStatus, githubRepositories)}`;
}

function renderGitLabStatusPage(
  project?: Project,
  summary?: ProjectStatusSummary,
  githubStatus?: GitHubConnectionStatus,
  repositoryFiles: RepositoryFile[] = [],
): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  return `
    ${renderGitHubConnectPanel(project, summary, githubStatus)}
    ${project.repositoryUrl ? renderRepositoryPanel(project, repositoryFiles) : ''}
    ${renderProjectPipelineActions(project, summary, githubStatus)}`;
}

function renderRepositoryPanel(project: Project, files: RepositoryFile[]): string {
  if (!project.repositoryUrl) {
    return '';
  }

  const repository = project.repository;
  const rows = files.length
    ? files.map((file) => `<tr><td>${file.type === 'dir' ? 'dir' : 'file'}</td><td><a href="${escapeHtml(file.webUrl)}">${escapeHtml(file.path || file.name)}</a></td><td>${escapeHtml(file.size === undefined ? '' : `${file.size} bytes`)}</td></tr>`).join('')
    : '<tr><td colspan="3">No repository contents loaded yet.</td></tr>';

  return `
    <article class="card">
      <header class="page-header">
        <div>
          <h2>Repository files</h2>
          <p class="muted">Latest contents from GitHub.</p>
        </div>
        <a class="button button-secondary" href="${escapeHtml(project.repositoryUrl)}" target="_blank" rel="noreferrer">Open on GitHub</a>
      </header>
      <table>
        <thead><tr><th>Type</th><th>Path</th><th>Size</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </article>`;
}

function renderDeploymentStatusPage(project?: Project, summary?: ProjectStatusSummary, githubStatus?: GitHubConnectionStatus): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  const { repositoryReady, namespaceReady } = projectPipelineReadiness(project, summary, githubStatus);
  const deployment = summary?.latestDeployment ?? project.deployments.at(-1);
  const canDeploy = repositoryReady && namespaceReady;

  return `
    ${!canDeploy ? renderGitHubConnectPanel(project, summary, githubStatus) : ''}
    <article class="card">
      <h2>Deployment status</h2>
      ${canDeploy
        ? `<form data-action="trigger-deployment" data-project-id="${escapeHtml(project.id)}">
            <label>Git ref <input name="gitRef" value="main"></label>
            <button type="submit">Trigger deployment</button>
          </form>`
        : '<p class="muted">Connect GitHub, create a repository, and provision infrastructure before triggering a deployment.</p>'}
      ${deployment ? `
        <dl class="metadata-grid">
          <div><dt>State</dt><dd>${escapeHtml(deployment.state)}</dd></div>
          <div><dt>Git ref</dt><dd>${escapeHtml(deployment.gitRef)}</dd></div>
          <div><dt>Finished</dt><dd>${escapeHtml(deployment.finishedAt ?? 'In progress')}</dd></div>
        </dl>` : '<p>No deployments have been triggered yet.</p>'}
    </article>
    ${canDeploy ? renderProjectPipelineActions(project, summary, githubStatus) : ''}`;
}

function renderDomainManagementPage(project?: Project, summary?: ProjectStatusSummary): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  const deployment = projectDeployment(project, summary);
  const canAttachLiveUrl = deployment?.state === 'succeeded';
  const domains = project.domains.length
    ? project.domains.map((domain) => `
      <li>
        <div class="domain-heading">
          <div>
            <strong>${escapeHtml(domain.hostname)}</strong>
            <span>${domain.verified ? 'Domain active' : `Domain ${domain.status}`}</span>
          </div>
          <button data-action="verify-domain" data-project-id="${escapeHtml(project.id)}" data-domain-id="${escapeHtml(domain.id)}">Verify DNS</button>
        </div>
        <dl class="metadata-grid domain-status-grid">
          <div><dt>DNS mode</dt><dd>${escapeHtml(domain.dnsMode)}</dd></div>
          <div><dt>Verification status</dt><dd>${escapeHtml(domain.verificationStatus)}</dd></div>
          <div><dt>Delegation status</dt><dd>${escapeHtml(domain.delegationStatus)}</dd></div>
          <div><dt>Certificate status</dt><dd>${escapeHtml(domain.certificateStatus)}</dd></div>
          <div><dt>Last checked</dt><dd>${escapeHtml(domain.lastCheckedAt ?? 'Not checked yet')}</dd></div>
        </dl>
        ${domain.failureReason ? `<div class="alert alert-error domain-failure"><strong>Failure reason:</strong> ${escapeHtml(domain.failureReason)}</div>` : ''}
        ${renderDomainInstructions(domain)}
      </li>`).join('')
    : '<li>No custom domains configured.</li>';

  return `
    <article class="card">
      <h2>Domain management</h2>
      <p>Your reserved live URL is <strong>${escapeHtml(project.platformHostname)}</strong>.</p>
      ${canAttachLiveUrl
        ? `<button data-action="attach-platform-subdomain" data-project-id="${escapeHtml(project.id)}">${project.platformSubdomainAttached ? 'Platform URL attached' : 'Attach platform URL'}</button>`
        : '<p class="muted">Complete a successful deployment before attaching your live URL.</p>'}
      <form data-action="add-domain" data-project-id="${escapeHtml(project.id)}">
        <label>Custom domain <input name="hostname" placeholder="www.example.com" required></label>
        <label>DNS setup mode
          <select name="dnsMode">
            <option value="">Auto-detect from hostname</option>
            <option value="custom_cname">Custom CNAME</option>
            <option value="apex">Apex / ALIAS</option>
            <option value="delegated_full_zone">Delegated full zone</option>
            <option value="delegated_sub_zone">Delegated sub-zone</option>
            <option value="none">No DNS automation</option>
          </select>
        </label>
        <button type="submit">Add domain</button>
      </form>
      <ul class="domain-list">${domains}</ul>
    </article>`;
}

function renderDomainInstructions(domain: ProjectDomain): string {
  if (isDelegatedDomain(domain)) {
    return renderDelegatedDomainInstructions(domain);
  }

  const instructions = domain.dnsInstructions.length ? domain.dnsInstructions : [{ type: 'TXT', name: domain.verificationName, value: domain.verificationValue, purpose: 'ownership_verification', required: true } satisfies DomainDnsInstruction];
  return `
    <section class="dns-instructions">
      <h3>DNS records to publish</h3>
      <ul>${instructions.map((instruction) => renderDnsInstruction(instruction)).join('')}</ul>
    </section>`;
}

function renderDelegatedDomainInstructions(domain: ProjectDomain): string {
  const nameservers = domain.assignedNameservers;
  const instructions = domain.dnsInstructions.length ? domain.dnsInstructions : [{ type: 'TXT', name: domain.verificationName, value: domain.verificationValue, purpose: 'ownership_verification', required: true } satisfies DomainDnsInstruction];
  const nonNsInstructions = instructions.filter((instruction) => instruction.type !== 'NS');

  return `
    <section class="dns-instructions delegated-dns-instructions">
      <h3>Delegated DNS launch instructions</h3>
      <p>At your current DNS registrar or parent-zone provider, delegate <strong>${escapeHtml(domain.hostname)}</strong> to the exact managed-provider nameservers assigned by the backend. Do not use vanity nameservers unless Divband explicitly implements them later.</p>
      <div class="delegated-nameservers">
        <h4>Assigned managed-provider nameservers</h4>
        ${nameservers.length ? `
          <ul>${nameservers.map((nameserver) => `
            <li>
              <code>${escapeHtml(nameserver)}</code>
              ${renderCopyButton(nameserver, 'Copy')}
            </li>`).join('')}</ul>
          ${renderCopyButton(nameservers.join('\n'), 'Copy all nameservers')}
        ` : '<p class="muted">No managed-provider nameservers have been assigned by the backend yet. Wait for managed DNS zone creation to finish before changing delegation.</p>'}
      </div>
      <div class="propagation-guidance">
        <h4>Propagation guidance</h4>
        <ul>
          <li>Replace the NS records for this delegated zone with only the assigned managed-provider nameservers above.</li>
          <li>DNS propagation commonly takes minutes but can take up to 24–48 hours depending on registrar, parent-zone TTLs, and resolver cache.</li>
          <li>Use <strong>Verify DNS</strong> after updating delegation. Verification checks that public DNS points at the assigned nameserver set and then validates ownership.</li>
        </ul>
      </div>
      <dl class="metadata-grid domain-status-grid">
        <div><dt>Delegation</dt><dd>${escapeHtml(domain.delegationStatus)}</dd></div>
        <div><dt>Ownership verification</dt><dd>${escapeHtml(domain.verificationStatus)}</dd></div>
        <div><dt>Domain status</dt><dd>${escapeHtml(domain.status)}</dd></div>
        <div><dt>Last checked</dt><dd>${escapeHtml(domain.lastCheckedAt ?? 'Not checked yet')}</dd></div>
      </dl>
      ${domain.failureReason ? `<div class="alert alert-error domain-failure"><strong>Failure reason:</strong> ${escapeHtml(domain.failureReason)}</div>` : ''}
      <h4>Managed-zone records</h4>
      <p>These records are returned by the backend for the delegated zone. Publish or verify them inside the managed zone when required.</p>
      <ul>${nonNsInstructions.length ? nonNsInstructions.map((instruction) => renderDnsInstruction(instruction)).join('') : '<li>No additional DNS records are required from the dashboard right now.</li>'}</ul>
    </section>`;
}

function renderDnsInstruction(instruction: DomainDnsInstruction): string {
  const value = Array.isArray(instruction.value) ? instruction.value.join(', ') : instruction.value;
  const record = `${instruction.name} ${instruction.type} ${value}`;
  return `
    <li class="dns-instruction-row">
      <code>${escapeHtml(record)}</code>
      <span>${escapeHtml(instruction.purpose)}${instruction.required ? '' : ' (optional)'}</span>
      ${renderCopyButton(record, 'Copy record')}
    </li>`;
}

function renderCopyButton(value: string, label: string): string {
  return `<button type="button" class="copy-button" data-action="copy-to-clipboard" data-copy-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
}

function isDelegatedDomain(domain: ProjectDomain): boolean {
  return domain.dnsMode === 'delegated_sub_zone' || domain.dnsMode === 'delegated_full_zone';
}

function renderEnvironmentVariablesPage(project: Project | undefined, variables: EnvironmentVariable[]): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  const rows = variables.length
    ? variables.map((variable) => `
      <tr>
        <td>${escapeHtml(variable.key)}</td>
        <td>${escapeHtml(variable.value)}</td>
        <td>${variable.protected ? 'Protected' : 'Unprotected'}</td>
        <td>${escapeHtml(variable.updatedAt)}</td>
      </tr>`).join('')
    : '<tr><td colspan="4">No environment variables configured.</td></tr>';

  return `
    <article class="card">
      <h2>Environment variables</h2>
      <p>Loaded from <code>GET /projects/{projectId}/environment-variables</code>; saved with <code>PUT /projects/{projectId}/environment-variables</code>.</p>
      <form data-action="save-environment-variable" data-project-id="${escapeHtml(project.id)}">
        <label>Key <input name="key" placeholder="API_TOKEN" required></label>
        <label>Value <input name="value" required></label>
        <label><input name="protected" type="checkbox"> Protected</label>
        <button type="submit">Save variable</button>
      </form>
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Scope</th><th>Updated</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </article>`;
}

function renderLogsPage(project: Project | undefined, logs: Array<Pick<Deployment, 'id' | 'state' | 'logs'>>): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  const blocks = logs.length
    ? logs.map((deployment) => `
      <section class="log-block">
        <h3>${escapeHtml(deployment.id)} · ${escapeHtml(deployment.state)}</h3>
        <pre>${escapeHtml(deployment.logs.join('\n'))}</pre>
      </section>`).join('')
    : '<p>No build history or logs yet.</p>';

  return `
    <article class="card">
      <h2>Logs and build history</h2>
      <p>Loaded from <code>GET /projects/{projectId}/logs</code> for <strong>${escapeHtml(project.name)}</strong>.</p>
      ${blocks}
    </article>`;
}

function renderAssistantPage(project: Project | undefined, messages: AssistantMessage[], changeRequests: AiChangeRequest[]): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  const transcript = messages.length
    ? messages.map((message) => `<li class="message message-${message.role}"><strong>${message.role}</strong><p>${escapeHtml(message.content)}</p></li>`).join('')
    : '<li>Ask for a feature, content edit, configuration change, or deployment investigation.</li>';
  const requests = changeRequests.length
    ? changeRequests.map((request) => `
      <li class="ai-change-request">
        <header><strong>${escapeHtml(request.prompt)}</strong><span class="status">${escapeHtml(request.status)}</span></header>
        <p>Target: <code>${escapeHtml(request.targetBranch)}</code></p>
        ${request.patch ? `<p>Patch: ${escapeHtml(request.patch.summary)} (${request.patch.files.length} files)</p>` : '<p>No patch generated yet.</p>'}
        ${request.branch ? `<p>Branch: <a href="${escapeHtml(request.branch.webUrl)}">${escapeHtml(request.branch.name)}</a></p>` : ''}
        ${request.mergeRequest ? `<p>Merge request: <a href="${escapeHtml(request.mergeRequest.webUrl)}">!${request.mergeRequest.iid}</a></p>` : ''}
        ${request.ciStatus ? `<p>CI: ${escapeHtml(request.ciStatus.status)}${request.ciStatus.deploymentReady ? ' · deployment ready' : ''}</p>` : ''}
        <div class="assistant-actions">
          <button data-action="ai-attach-context" data-project-id="${escapeHtml(project.id)}" data-change-request-id="${escapeHtml(request.id)}">Attach context</button>
          <button data-action="ai-generate-patch" data-project-id="${escapeHtml(project.id)}" data-change-request-id="${escapeHtml(request.id)}">Generate patch</button>
          <button data-action="ai-create-branch" data-project-id="${escapeHtml(project.id)}" data-change-request-id="${escapeHtml(request.id)}" data-confirm-apply="true">Confirm and create branch</button>
          <button data-action="ai-open-merge-request" data-project-id="${escapeHtml(project.id)}" data-change-request-id="${escapeHtml(request.id)}">Open MR</button>
          <button data-action="ai-trigger-ci" data-project-id="${escapeHtml(project.id)}" data-change-request-id="${escapeHtml(request.id)}">Trigger CI</button>
        </div>
      </li>`).join('')
    : '<li>No AI change requests yet.</li>';

  return `
    <article class="card assistant-card">
      <h2>AI assistant <span class="preview-badge">Preview/mock · post-MVP</span></h2>
      <p>This assistant is a post-MVP preview for <strong>${escapeHtml(project.name)}</strong>. Current controls validate the reviewed-change workflow shape; production use requires real model, repository, GitLab, redaction, audit, rollback, and CI polling adapters.</p>
      <ul class="assistant-transcript">${transcript}</ul>
      <form data-action="assistant-request" data-project-id="${escapeHtml(project.id)}">
        <label>Request <textarea name="prompt" placeholder="Add pricing cards to the landing page" required></textarea></label>
        <label>Target branch <input name="targetBranch" value="main"></label>
        <button type="submit">Create preview AI change request</button>
      </form>
      <section class="assistant-safety">
        <h3>Preview safety controls required before production</h3>
        <ul>
          <li>User confirmation is required before applying generated changes.</li>
          <li>Changes open a GitLab merge request instead of pushing to production.</li>
          <li>CI must succeed before deployment can be marked ready.</li>
          <li>Secrets are redacted and file paths are constrained to this project.</li>
          <li>Rollback, branch naming, audit events, and adapter failure handling must be completed before this becomes an MVP feature.</li>
        </ul>
      </section>
      <section>
        <h3>Change requests</h3>
        <ul class="assistant-change-requests">${requests}</ul>
      </section>
    </article>`;
}

function renderEmptyProjectNotice(): string {
  return `
    <article class="card">
      <h2>Select a project</h2>
      <p>Create or select a project before opening this page.</p>
      <a class="button" href="${escapeHtml(pageHref('project-list'))}">Back to projects</a>
    </article>`;
}

function parseDashboardNotice(search?: string): { message: string; variant: 'success' | 'error' } | undefined {
  if (!search) {
    return undefined;
  }
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const error = params.get('github_error');
  if (error) {
    return { message: error, variant: 'error' };
  }
  if (params.get('notice') === 'github_connected') {
    return {
      message: 'GitHub connected successfully. Choose a repository or create a new one for this project.',
      variant: 'success',
    };
  }
  return undefined;
}

function clearDashboardNoticeQuery(): void {
  if (!globalThis.location) {
    return;
  }
  const url = new URL(globalThis.location.href);
  if (!url.searchParams.has('notice') && !url.searchParams.has('github_error')) {
    return;
  }
  url.searchParams.delete('notice');
  url.searchParams.delete('github_error');
  globalThis.history?.replaceState?.(null, '', `${url.pathname}${url.hash}`);
}

function pageFromHash(hash?: string): DashboardPageId | undefined {
  const id = hash?.replace(/^#/, '').split('?')[0];
  if (!id || id === 'project-list') {
    return 'project-list';
  }
  const pageId = id as DashboardPageId;
  return dashboardPages.some((page) => page.id === pageId) ? pageId : undefined;
}

function projectIdFromHash(hash?: string): string | undefined {
  const query = hash?.replace(/^#/, '').split('?')[1];
  if (!query) {
    return undefined;
  }
  return new URLSearchParams(query).get('projectId') ?? undefined;
}

function pageHref(page: DashboardPageId, projectId?: string): string {
  if (projectId) {
    if (page === 'project-overview') {
      return `/projects/${encodeURIComponent(projectId)}`;
    }
    if (page === 'gitlab-repository-status') {
      return `/projects/${encodeURIComponent(projectId)}/repository`;
    }
    return `/dashboard#${page}?projectId=${encodeURIComponent(projectId)}`;
  }
  if (page === 'project-list') {
    return '/dashboard';
  }
  return `/dashboard#${page}`;
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const exists = items.some((existing) => existing.id === item.id);
  return exists ? items.map((existing) => existing.id === item.id ? item : existing) : [...items, item];
}

function isAuthFailure(message: string): boolean {
  return message.includes('Authentication is required')
    || message.includes('Invalid email or password')
    || message.includes('Email verification is required');
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function optionalDomainDnsMode(value: FormDataEntryValue | null): DomainDnsMode | undefined {
  const normalized = optionalString(value);
  return normalized === 'none'
    || normalized === 'custom_cname'
    || normalized === 'apex'
    || normalized === 'delegated_sub_zone'
    || normalized === 'delegated_full_zone'
    ? normalized
    : undefined;
}

function requiredProjectId(element: HTMLElement): string {
  return requiredDataset(element, 'projectId');
}

function requiredSelectedProjectId(state: DashboardState): string {
  const projectId = state.selectedProjectId ?? selectProject(state)?.id;
  if (!projectId) {
    throw new Error('Select a project first.');
  }
  return projectId;
}

function requiredDataset(element: HTMLElement, key: string): string {
  const value = element.dataset[key];
  if (!value) {
    throw new Error(`Missing ${key} attribute.`);
  }
  return value;
}

async function copyToClipboard(value: string): Promise<void> {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(value);
    return;
  }

  const textarea = globalThis.document?.createElement('textarea');
  if (!textarea) {
    return;
  }
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  globalThis.document.body.append(textarea);
  textarea.select();
  globalThis.document.execCommand?.('copy');
  textarea.remove();
}

function isErrorPayload(payload: unknown): payload is { error: { message: string } } {
  return typeof payload === 'object'
    && payload !== null
    && 'error' in payload
    && typeof (payload as { error?: { message?: unknown } }).error?.message === 'string';
}

function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
