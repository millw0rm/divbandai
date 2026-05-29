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
  | 'sign-in'
  | 'sign-up'
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
  runnerTag: string;
  repositoryUrl?: string;
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

export interface ProjectStatusSummary {
  status: BackendProjectStatus;
  repositoryUrl?: string;
  namespaceProvisioned: boolean;
  platformSubdomainAttached: boolean;
  activeDomains: string[];
  latestDeployment?: Deployment;
}

export interface DashboardState {
  currentPage: DashboardPageId;
  user?: AuthUser;
  session?: AuthSession;
  projects: Project[];
  selectedProjectId?: string;
  statusSummary?: ProjectStatusSummary;
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
    id: 'sign-in',
    title: 'Sign in',
    description: 'Start an authenticated dashboard session.',
    requiresProject: false,
  },
  {
    id: 'sign-up',
    title: 'Sign up',
    description: 'Create a divband account and first session.',
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
    this.fetchImpl = options.fetch ?? fetch;
  }

  setToken(token?: string): void {
    this.token = token;
  }

  register(input: { email: string; name: string; password: string }): Promise<AuthResponse> {
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

  async getProject(projectId: string): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}`);
    return response.project;
  }

  getProjectStatus(projectId: string): Promise<ProjectStatusSummary> {
    return this.request<ProjectStatusSummary>(`/projects/${encodeURIComponent(projectId)}/status`);
  }

  async provisionGitLabRepository(projectId: string): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}/gitlab-repository`, { method: 'POST' });
    return response.project;
  }

  async provisionNamespace(projectId: string): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}/kubernetes-namespace`, { method: 'POST' });
    return response.project;
  }

  async attachPlatformSubdomain(projectId: string): Promise<Project> {
    const response = await this.request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}/platform-subdomain`, { method: 'POST' });
    return response.project;
  }

  async addDomain(projectId: string, hostname: string): Promise<ProjectDomain> {
    const response = await this.request<{ domain: ProjectDomain }>(`/projects/${encodeURIComponent(projectId)}/domains`, {
      method: 'POST',
      body: { hostname },
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

  constructor(private readonly options: DashboardControllerOptions) {
    this.storage = options.storage ?? globalThis.localStorage;
    const storedToken = this.storage?.getItem('divband.dashboard.token') ?? undefined;
    this.api = new DivbandApiClient({ baseUrl: options.baseUrl, token: options.token ?? storedToken, fetch: options.fetch });
    this.state = createInitialDashboardState({ session: storedToken ? { id: 'stored-session', userId: 'stored-session', expiresAt: '' } : undefined, ...options.initialState });
  }

  async start(): Promise<void> {
    this.options.root.addEventListener('submit', (event) => void this.handleSubmit(event));
    this.options.root.addEventListener('click', (event) => void this.handleClick(event));
    globalThis.addEventListener?.('hashchange', () => void this.navigateFromHash());
    await this.navigateFromHash();
  }

  async navigate(page: DashboardPageId, selectedProjectId = this.state.selectedProjectId): Promise<DashboardActionResult> {
    this.state = { ...this.state, currentPage: page, selectedProjectId, loading: true, error: undefined };
    this.render();
    try {
      await this.loadPageData(page, selectedProjectId);
      this.state = { ...this.state, loading: false };
    } catch (error) {
      this.state = { ...this.state, loading: false, error: error instanceof Error ? error.message : 'Dashboard request failed.' };
    }
    return { state: this.state, html: this.render() };
  }

  render(): string {
    const html = renderDashboard(this.state);
    this.options.root.innerHTML = html;
    return html;
  }

  private async navigateFromHash(): Promise<DashboardActionResult> {
    const page = pageFromHash(globalThis.location?.hash) ?? this.state.currentPage;
    return this.navigate(page);
  }

  private async loadPageData(page: DashboardPageId, selectedProjectId?: string): Promise<void> {
    if (!this.state.session && page !== 'sign-in' && page !== 'sign-up') {
      this.state = { ...this.state, currentPage: 'sign-in' };
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

    const project = selectedProjectId ? await this.api.getProject(selectedProjectId) : selectProject(this.state);
    if (!project) {
      this.state = { ...this.state, projects: await this.api.listProjects() };
      return;
    }

    const projects = upsertById(this.state.projects, project);
    const statusSummary = await this.api.getProjectStatus(project.id);
    const baseState = { ...this.state, projects, selectedProjectId: project.id, statusSummary };

    if (page === 'environment-variables') {
      this.state = { ...baseState, environmentVariables: await this.api.listEnvironmentVariables(project.id) };
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
        case 'sign-in':
          await this.applyAuth(await this.api.login(requiredCredentials(data)));
          return this.navigate('project-list');
        case 'sign-up':
          await this.applyAuth(await this.api.register({ ...requiredCredentials(data), name: String(data.get('name') ?? '') }));
          return this.navigate('project-list');
        case 'create-project': {
          const project = await this.api.createProject({ name: String(data.get('name') ?? ''), slug: optionalString(data.get('slug')) });
          this.state = { ...this.state, projects: upsertById(this.state.projects, project), selectedProjectId: project.id };
          return this.navigate('project-overview', project.id);
        }
        case 'trigger-deployment':
          await this.api.triggerDeployment(requiredProjectId(form), { gitRef: optionalString(data.get('gitRef')) });
          return this.navigate('deployment-status', requiredProjectId(form));
        case 'add-domain':
          await this.api.addDomain(requiredProjectId(form), String(data.get('hostname') ?? ''));
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
      }
      return undefined;
    });
  }

  private async handleClick(event: Event): Promise<void> {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action], [data-project-id]') : undefined;
    if (!target) return;
    const action = target.dataset.action;
    const projectId = target.dataset.projectId;
    if (!action && projectId) {
      this.state = { ...this.state, selectedProjectId: projectId };
      return;
    }
    if (!action) return;
    event.preventDefault();
    await this.runAction(async () => {
      switch (action) {
        case 'provision-gitlab':
          await this.api.provisionGitLabRepository(requiredProjectId(target));
          return this.navigate('gitlab-repository-status', requiredProjectId(target));
        case 'provision-namespace':
          await this.api.provisionNamespace(requiredProjectId(target));
          return this.navigate('project-overview', requiredProjectId(target));
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
    this.storage?.setItem('divband.dashboard.token', response.token);
    this.state = { ...this.state, user: response.user, session: response.session };
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
  return `
    <main class="dashboard-shell">
      <aside class="dashboard-sidebar">
        <h1>divband</h1>
        <p>Multi-tenant hosting dashboard</p>
        ${renderNavigation(state, selectedProject)}
        <section class="lifecycle-legend">
          <h2>Lifecycle states</h2>
          ${renderLifecycleLegend()}
        </section>
      </aside>
      <section class="dashboard-content">
        ${state.error ? `<div class="alert alert-error">${escapeHtml(state.error)}</div>` : ''}
        ${state.loading ? '<div class="alert">Loading latest backend API data…</div>' : ''}
        ${renderCurrentPage(state, selectedProject)}
      </section>
    </main>`;
}

function renderNavigation(state: DashboardState, selectedProject?: Project): string {
  const items = dashboardPages
    .filter((page) => !page.requiresProject || selectedProject)
    .map((page) => `<a class="${state.currentPage === page.id ? 'active' : ''}" href="#${page.id}">${escapeHtml(page.title)}</a>`)
    .join('');
  return `<nav>${items}</nav>`;
}

function renderCurrentPage(state: DashboardState, selectedProject?: Project): string {
  switch (state.currentPage) {
    case 'sign-in':
      return renderSignInPage();
    case 'sign-up':
      return renderSignUpPage();
    case 'create-project':
      return renderCreateProjectPage();
    case 'project-overview':
      return renderProjectOverviewPage(selectedProject, state.statusSummary);
    case 'gitlab-repository-status':
      return renderGitLabStatusPage(selectedProject);
    case 'deployment-status':
      return renderDeploymentStatusPage(selectedProject, state.statusSummary?.latestDeployment);
    case 'domain-management':
      return renderDomainManagementPage(selectedProject);
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
    case 'project-list':
    default:
      return renderProjectListPage(state.projects, selectedProject?.id);
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

function renderSignInPage(): string {
  return `
    <article class="card">
      <h2>Sign in</h2>
      <form data-action="sign-in">
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Sign in</button>
      </form>
    </article>`;
}

function renderSignUpPage(): string {
  return `
    <article class="card">
      <h2>Sign up</h2>
      <form data-action="sign-up">
        <label>Name <input name="name" autocomplete="name" required></label>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <button type="submit">Create account</button>
      </form>
    </article>`;
}

function renderProjectListPage(projects: Project[], selectedProjectId?: string): string {
  const rows = projects.length
    ? projects.map((project) => `
      <tr class="${project.id === selectedProjectId ? 'selected' : ''}">
        <td><a href="#project-overview" data-project-id="${escapeHtml(project.id)}">${escapeHtml(project.name)}</a></td>
        <td>${escapeHtml(project.slug)}</td>
        <td><span class="status status-${escapeHtml(getProjectLifecycleState(project.status))}">${escapeHtml(getLifecycleLabel(project.status))}</span></td>
        <td>${escapeHtml(project.updatedAt)}</td>
      </tr>`).join('')
    : '<tr><td colspan="4">No projects yet. Create your first project to begin provisioning.</td></tr>';

  return `
    <article class="card">
      <header class="page-header">
        <div>
          <h2>Project list</h2>
          <p>Loaded from <code>GET /projects</code>.</p>
        </div>
        <a class="button" href="#create-project">Create project</a>
      </header>
      <table>
        <thead><tr><th>Name</th><th>Slug</th><th>Lifecycle</th><th>Updated</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </article>`;
}

function renderCreateProjectPage(): string {
  return `
    <article class="card">
      <h2>Create project</h2>
      <p>Submits to <code>POST /projects</code> and starts the Created lifecycle state.</p>
      <form data-action="create-project">
        <label>Project name <input name="name" placeholder="Marketing site" required></label>
        <label>Slug <input name="slug" placeholder="marketing-site"></label>
        <button type="submit">Create project</button>
      </form>
    </article>`;
}

function renderProjectOverviewPage(project?: Project, summary?: ProjectStatusSummary): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  return `
    <article class="card">
      <h2>${escapeHtml(project.name)}</h2>
      ${renderLifecycleStepper(getProjectLifecycleState(summary?.status ?? project.status))}
      <dl class="metadata-grid">
        <div><dt>GitLab path</dt><dd>${escapeHtml(project.gitlabPath)}</dd></div>
        <div><dt>Namespace</dt><dd>${escapeHtml(project.namespace)}</dd></div>
        <div><dt>Platform hostname</dt><dd>${escapeHtml(project.platformHostname)}</dd></div>
        <div><dt>Runner tag</dt><dd>${escapeHtml(project.runnerTag)}</dd></div>
        <div><dt>Active domains</dt><dd>${escapeHtml((summary?.activeDomains ?? project.domains.filter((domain) => domain.verified).map((domain) => domain.hostname)).join(', ') || 'None')}</dd></div>
        <div><dt>Latest deployment</dt><dd>${escapeHtml(summary?.latestDeployment?.state ?? project.deployments.at(-1)?.state ?? 'None')}</dd></div>
      </dl>
      <div class="quick-actions">
        <button data-action="provision-gitlab" data-project-id="${escapeHtml(project.id)}">Provision repository</button>
        <button data-action="provision-namespace" data-project-id="${escapeHtml(project.id)}">Provision namespace</button>
        <a class="button" href="#deployment-status">Open deployments</a>
      </div>
    </article>`;
}

function renderGitLabStatusPage(project?: Project): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  return `
    <article class="card">
      <h2>GitLab repository status</h2>
      <p>${project.repositoryUrl ? `Repository available at <a href="${escapeHtml(project.repositoryUrl)}">${escapeHtml(project.repositoryUrl)}</a>.` : 'Repository has not been provisioned yet.'}</p>
      <dl class="metadata-grid">
        <div><dt>Repository state</dt><dd>${project.repositoryUrl ? 'Repository provisioned' : 'Waiting for provisioning'}</dd></div>
        <div><dt>Project path</dt><dd>${escapeHtml(project.gitlabPath)}</dd></div>
        <div><dt>Runner tag</dt><dd>${escapeHtml(project.runnerTag)}</dd></div>
      </dl>
      <button data-action="provision-gitlab" data-project-id="${escapeHtml(project.id)}">Provision or reconcile repository</button>
    </article>`;
}

function renderDeploymentStatusPage(project?: Project, latestDeployment?: Deployment): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  const deployment = latestDeployment ?? project.deployments.at(-1);
  return `
    <article class="card">
      <h2>Deployment status</h2>
      <form data-action="trigger-deployment" data-project-id="${escapeHtml(project.id)}">
        <label>Git ref <input name="gitRef" value="main"></label>
        <button type="submit">Trigger deployment</button>
      </form>
      ${deployment ? `
        <dl class="metadata-grid">
          <div><dt>Deployment</dt><dd>${escapeHtml(deployment.id)}</dd></div>
          <div><dt>State</dt><dd>${escapeHtml(deployment.state)}</dd></div>
          <div><dt>Git ref</dt><dd>${escapeHtml(deployment.gitRef)}</dd></div>
          <div><dt>Finished</dt><dd>${escapeHtml(deployment.finishedAt ?? 'In progress')}</dd></div>
        </dl>` : '<p>No deployments have been triggered yet.</p>'}
    </article>`;
}

function renderDomainManagementPage(project?: Project): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  const domains = project.domains.length
    ? project.domains.map((domain) => `
      <li>
        <strong>${escapeHtml(domain.hostname)}</strong>
        <span>${domain.verified ? 'Domain active' : `Domain ${domain.status}`}</span>
        <span>DNS mode: ${escapeHtml(domain.dnsMode)}</span>
        <span>Delegation: ${escapeHtml(domain.delegationStatus)}</span>
        ${renderDomainInstructions(domain)}
        <button data-action="verify-domain" data-project-id="${escapeHtml(project.id)}" data-domain-id="${escapeHtml(domain.id)}">Verify</button>
      </li>`).join('')
    : '<li>No custom domains configured.</li>';

  return `
    <article class="card">
      <h2>Domain management</h2>
      <p>Platform hostname: <strong>${escapeHtml(project.platformHostname)}</strong></p>
      <button data-action="attach-platform-subdomain" data-project-id="${escapeHtml(project.id)}">Attach platform subdomain</button>
      <form data-action="add-domain" data-project-id="${escapeHtml(project.id)}">
        <label>Custom domain <input name="hostname" placeholder="www.example.com" required></label>
        <button type="submit">Add domain</button>
      </form>
      <ul class="domain-list">${domains}</ul>
    </article>`;
}

function renderDomainInstructions(domain: ProjectDomain): string {
  const instructions = domain.dnsInstructions.length ? domain.dnsInstructions : [{ type: 'TXT', name: domain.verificationName, value: domain.verificationValue, purpose: 'ownership_verification', required: true } satisfies DomainDnsInstruction];
  return `<ul>${instructions.map((instruction) => `<li><code>${escapeHtml(instruction.name)} ${escapeHtml(instruction.type)} ${escapeHtml(Array.isArray(instruction.value) ? instruction.value.join(', ') : instruction.value)}</code><span>${escapeHtml(instruction.purpose)}${instruction.required ? '' : ' (optional)'}</span></li>`).join('')}</ul>`;
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

function renderLifecycleStepper(currentState: ProjectLifecycleState): string {
  const activeIndex = lifecycleStates.findIndex((state) => state.id === currentState);
  const isFailure = currentState === 'failed';
  return `
    <ol class="lifecycle-stepper lifecycle-stepper-${escapeHtml(currentState)}">
      ${lifecycleStates.map((state, index) => `
        <li class="${!isFailure && index < activeIndex ? 'complete' : ''} ${state.id === currentState ? 'current' : ''}">
          <strong>${escapeHtml(state.label)}</strong>
          <span>${escapeHtml(state.description)}</span>
        </li>`).join('')}
    </ol>`;
}

function renderEmptyProjectNotice(): string {
  return `
    <article class="card">
      <h2>Select a project</h2>
      <p>Create or select a project before opening this page.</p>
      <a class="button" href="#project-list">Go to project list</a>
    </article>`;
}


function renderLifecycleLegend(): string {
  return `<ol>${lifecycleStates.map((state) => `<li><span class="status status-${state.id}">${escapeHtml(state.label)}</span></li>`).join('')}</ol>`;
}

function pageFromHash(hash?: string): DashboardPageId | undefined {
  const id = hash?.replace(/^#/, '') as DashboardPageId | undefined;
  return dashboardPages.some((page) => page.id === id) ? id : undefined;
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const exists = items.some((existing) => existing.id === item.id);
  return exists ? items.map((existing) => existing.id === item.id ? item : existing) : [...items, item];
}

function requiredCredentials(data: FormData): { email: string; password: string } {
  return { email: String(data.get('email') ?? ''), password: String(data.get('password') ?? '') };
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
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

function isErrorPayload(payload: unknown): payload is { error: { message: string } } {
  return typeof payload === 'object'
    && payload !== null
    && 'error' in payload
    && typeof (payload as { error?: { message?: unknown } }).error?.message === 'string';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
