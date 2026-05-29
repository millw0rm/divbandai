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
  | 'ai-assistant';

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
}

export interface AuthSession {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  session: AuthSession;
}

export interface ProjectDomain {
  id: string;
  hostname: string;
  verificationToken: string;
  verificationRecord: string;
  verified: boolean;
  certificateStatus: 'not_requested' | 'pending' | 'issued' | 'failed';
  createdAt: string;
  verifiedAt?: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  gitRef: string;
  commitSha?: string;
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
  environmentVariables: EnvironmentVariable[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
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
  assistantMessages: AssistantMessage[];
  loading: boolean;
  error?: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AssistantChangeRequest {
  prompt: string;
  projectId: string;
  targetBranch?: string;
}

export interface ApiClientOptions {
  baseUrl?: string;
  token?: string;
  fetch?: typeof fetch;
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
    title: 'AI assistant',
    description: 'Draft feature changes through reviewed GitLab merge requests.',
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
    title: 'AI assistant',
    description: 'Request feature work and project changes through chat.',
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

  async requestAssistantChange(input: AssistantChangeRequest): Promise<AssistantMessage> {
    const response = await this.request<{ message: AssistantMessage }>(
      `/projects/${encodeURIComponent(input.projectId)}/assistant/requests`,
      { method: 'POST', body: { prompt: input.prompt, targetBranch: input.targetBranch } },
    );
    return response.message;
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
    assistantMessages: [],
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

export function renderDashboard(state: DashboardState): string {
  const selectedProject = selectProject(state);
  return `
    <main class="dashboard-shell">
      <aside class="dashboard-sidebar">
        <h1>divband</h1>
        <p>Multi-tenant hosting dashboard</p>
        ${renderNavigation(state, selectedProject)}
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
      return renderEnvironmentVariablesPage(state.environmentVariables);
    case 'logs-build-history':
      return renderLogsPage(state.logs);
    case 'ai-assistant':
      return renderAssistantPage(selectedProject, state.assistantMessages);
    case 'project-list':
    default:
      return renderProjectListPage(state.projects, selectedProject?.id);
  }
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
      </dl>
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
        <span>${domain.verified ? 'Domain active' : 'Domain pending verification'}</span>
        <code>${escapeHtml(domain.verificationRecord)}</code>
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

function renderEnvironmentVariablesPage(variables: EnvironmentVariable[]): string {
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
      <form data-action="save-environment-variable">
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

function renderLogsPage(logs: Array<Pick<Deployment, 'id' | 'state' | 'logs'>>): string {
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
      <p>Loaded from <code>GET /projects/{projectId}/logs</code>.</p>
      ${blocks}
    </article>`;
}

function renderAssistantPage(project: Project | undefined, messages: AssistantMessage[]): string {
  if (!project) {
    return renderEmptyProjectNotice();
  }

  const transcript = messages.length
    ? messages.map((message) => `<li class="message message-${message.role}"><strong>${message.role}</strong><p>${escapeHtml(message.content)}</p></li>`).join('')
    : '<li>Ask for a feature, content edit, configuration change, or deployment investigation.</li>';

  return `
    <article class="card assistant-card">
      <h2>AI assistant</h2>
      <p>Creates reviewed change requests for <strong>${escapeHtml(project.name)}</strong>.</p>
      <ul class="assistant-transcript">${transcript}</ul>
      <form data-action="assistant-request" data-project-id="${escapeHtml(project.id)}">
        <label>Request <textarea name="prompt" placeholder="Add pricing cards to the landing page" required></textarea></label>
        <label>Target branch <input name="targetBranch" value="main"></label>
        <button type="submit">Send request</button>
      </form>
    </article>`;
}

function renderLifecycleStepper(currentState: ProjectLifecycleState): string {
  const activeIndex = lifecycleStates.findIndex((state) => state.id === currentState);
  return `
    <ol class="lifecycle-stepper">
      ${lifecycleStates.map((state, index) => `
        <li class="${index <= activeIndex ? 'complete' : ''} ${state.id === currentState ? 'current' : ''}">
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
