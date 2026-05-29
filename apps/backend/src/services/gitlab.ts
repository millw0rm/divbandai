import type { AiChangeRequest, AiPatchProposal, EnvironmentVariable, Project } from '../models.ts';

export interface GitLabRepository {
  path: string;
  webUrl: string;
  cloneUrl: string;
}

export interface GitLabBranchResult {
  name: string;
  webUrl: string;
  commitSha: string;
}

export interface GitLabMergeRequestResult {
  iid: number;
  title: string;
  webUrl: string;
  sourceBranch: string;
  targetBranch: string;
  state: 'opened' | 'merged' | 'closed';
}

export interface GitLabPipelineResult {
  pipelineId: string;
  status: 'created' | 'pending' | 'running' | 'success' | 'failed' | 'canceled';
  webUrl: string;
}

interface GitLabProjectResponse {
  id: number;
  path_with_namespace: string;
  web_url: string;
  ssh_url_to_repo: string;
  default_branch?: string;
}

interface GitLabBranchResponse {
  name: string;
  web_url?: string;
  commit?: { id?: string };
}

interface GitLabMergeRequestResponse {
  iid: number;
  title: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  state: 'opened' | 'merged' | 'closed';
}

interface GitLabPipelineResponse {
  id: number;
  status: GitLabPipelineResult['status'];
  web_url: string;
}

interface GitLabCommitResponse {
  id: string;
}

export class GitLabService {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly namespaceId?: number;
  private readonly defaultBranch: string;
  private readonly projectIdsByPath = new Map<string, number>();

  constructor(env: Record<string, string | undefined> = process.env) {
    this.baseUrl = (env.GITLAB_URL?.trim() || 'https://gitlab.com').replace(/\/+$/, '');
    this.token = env.GITLAB_TOKEN?.trim() || env.GITLAB_ACCESS_TOKEN?.trim() || '';
    this.namespaceId = positiveInteger(env.GITLAB_NAMESPACE_ID);
    this.defaultBranch = env.GITLAB_DEFAULT_BRANCH?.trim() || 'main';
  }

  async createRepository(project: Project, environmentVariables: EnvironmentVariable[] = []): Promise<GitLabRepository> {
    const existing = await this.findProject(project.gitlabPath);
    const gitlabProject = existing ?? await this.createProject(project);
    this.projectIdsByPath.set(project.gitlabPath, gitlabProject.id);

    await this.configureProjectVariables(project, environmentVariables);
    await this.protectBranch(gitlabProject.id, gitlabProject.default_branch ?? this.defaultBranch);
    await this.createDeploymentCredential(gitlabProject.id, project);

    return {
      path: gitlabProject.path_with_namespace,
      webUrl: gitlabProject.web_url,
      cloneUrl: gitlabProject.ssh_url_to_repo,
    };
  }

  async configureRunnerTag(project: Project): Promise<string> {
    const projectId = await this.projectId(project);
    await this.upsertVariable(projectId, {
      key: 'DIVBAND_RUNNER_TAG',
      value: project.runnerTag,
      protected: false,
      masked: false,
    });
    return project.runnerTag;
  }

  async createBranch(project: Project, changeRequest: AiChangeRequest, patch: AiPatchProposal): Promise<GitLabBranchResult> {
    const projectId = await this.projectId(project);
    const branchName = `ai/${changeRequest.id}`;
    const branch = await this.request<GitLabBranchResponse>(`/projects/${projectId}/repository/branches`, {
      method: 'POST',
      body: {
        branch: branchName,
        ref: changeRequest.targetBranch || this.defaultBranch,
      },
    }, [400]);

    const commit = await this.commitPatchSummary(projectId, branchName, changeRequest, patch);
    return {
      name: branchName,
      webUrl: branch.web_url ?? `${this.baseUrl}/${project.gitlabPath}/-/tree/${encodeURIComponent(branchName)}`,
      commitSha: commit.id,
    };
  }

  async openMergeRequest(project: Project, changeRequest: AiChangeRequest): Promise<GitLabMergeRequestResult> {
    const projectId = await this.projectId(project);
    const sourceBranch = changeRequest.branch?.name ?? `ai/${changeRequest.id}`;
    const title = `AI change: ${changeRequest.prompt.slice(0, 72)}`;
    const mr = await this.request<GitLabMergeRequestResponse>(`/projects/${projectId}/merge_requests`, {
      method: 'POST',
      body: {
        source_branch: sourceBranch,
        target_branch: changeRequest.targetBranch,
        title,
        description: this.mergeRequestDescription(changeRequest),
        remove_source_branch: true,
        squash: true,
      },
    });

    return {
      iid: mr.iid,
      title: mr.title,
      webUrl: mr.web_url,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      state: mr.state,
    };
  }

  async triggerPipeline(project: Project, ref: string): Promise<GitLabPipelineResult> {
    const projectId = await this.projectId(project);
    const pipeline = await this.request<GitLabPipelineResponse>(`/projects/${projectId}/pipeline`, {
      method: 'POST',
      body: { ref },
    });

    return {
      pipelineId: String(pipeline.id),
      status: pipeline.status,
      webUrl: pipeline.web_url,
    };
  }

  private async createProject(project: Project): Promise<GitLabProjectResponse> {
    const pathSegments = project.gitlabPath.split('/');
    const path = pathSegments.at(-1) ?? project.slug;
    const body: Record<string, unknown> = {
      name: project.name,
      path,
      visibility: 'private',
      initialize_with_readme: true,
      default_branch: this.defaultBranch,
      topics: ['divband', project.id],
    };
    if (this.namespaceId) {
      body.namespace_id = this.namespaceId;
    }

    return this.request<GitLabProjectResponse>('/projects', { method: 'POST', body });
  }

  private async findProject(path: string): Promise<GitLabProjectResponse | undefined> {
    try {
      return await this.request<GitLabProjectResponse>(`/projects/${encodeURIComponent(path)}`, { method: 'GET' });
    } catch (error) {
      if (error instanceof GitLabHttpError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  private async configureProjectVariables(project: Project, environmentVariables: EnvironmentVariable[]): Promise<void> {
    const projectId = await this.projectId(project);
    const variables = [
      { key: 'DIVBAND_PROJECT_ID', value: project.id, protected: false, masked: false },
      { key: 'DIVBAND_PROJECT_SLUG', value: project.slug, protected: false, masked: false },
      { key: 'DIVBAND_NAMESPACE', value: project.namespace, protected: false, masked: false },
      { key: 'DIVBAND_PLATFORM_HOSTNAME', value: project.platformHostname, protected: false, masked: false },
      ...environmentVariables.map((variable) => ({
        key: variable.key,
        value: variable.value,
        protected: variable.protected,
        masked: variable.protected && variable.value.length >= 8,
      })),
    ];

    await Promise.all(variables.map((variable) => this.upsertVariable(projectId, variable)));
  }

  private async upsertVariable(projectId: number, variable: { key: string; value: string; protected: boolean; masked: boolean }): Promise<void> {
    const body = {
      value: variable.value,
      protected: variable.protected,
      masked: variable.masked,
      raw: true,
      environment_scope: '*',
    };
    try {
      await this.request(`/projects/${projectId}/variables/${encodeURIComponent(variable.key)}`, { method: 'PUT', body });
    } catch (error) {
      if (error instanceof GitLabHttpError && error.status === 404) {
        await this.request(`/projects/${projectId}/variables`, { method: 'POST', body: { key: variable.key, ...body } });
        return;
      }
      throw error;
    }
  }

  private async protectBranch(projectId: number, branch: string): Promise<void> {
    await this.request(`/projects/${projectId}/protected_branches`, {
      method: 'POST',
      body: {
        name: branch,
        push_access_level: 40,
        merge_access_level: 40,
        allow_force_push: false,
      },
    }, [409]);
  }

  private async createDeploymentCredential(projectId: number, project: Project): Promise<void> {
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const preferAccessToken = process.env.GITLAB_USE_PROJECT_ACCESS_TOKEN === '1';
    if (preferAccessToken) {
      await this.request(`/projects/${projectId}/access_tokens`, {
        method: 'POST',
        body: {
          name: `divband-${project.slug}-deploy`,
          scopes: ['read_repository', 'read_registry'],
          access_level: 30,
          expires_at: expiresAt,
        },
      }, [400, 409]);
      return;
    }

    await this.request(`/projects/${projectId}/deploy_tokens`, {
      method: 'POST',
      body: {
        name: `divband-${project.slug}-deploy`,
        scopes: ['read_repository', 'read_registry'],
        expires_at: expiresAt,
      },
    }, [400, 409]);
  }

  private async commitPatchSummary(projectId: number, branch: string, changeRequest: AiChangeRequest, patch: AiPatchProposal): Promise<GitLabCommitResponse> {
    const content = [
      `# AI change ${changeRequest.id}`,
      '',
      patch.summary,
      '',
      '## Proposed files',
      ...patch.files.map((file) => `- ${file.action}: ${file.path}`),
      '',
      'The MVP adapter records the reviewed proposal in GitLab. A later worker can translate stored diffs into exact file actions.',
      '',
    ].join('\n');

    return this.request<GitLabCommitResponse>(`/projects/${projectId}/repository/commits`, {
      method: 'POST',
      body: {
        branch,
        commit_message: `Apply AI proposal ${changeRequest.id}`,
        actions: [{ action: 'create', file_path: `.divband/ai/${changeRequest.id}.md`, content }],
      },
    });
  }

  private mergeRequestDescription(changeRequest: AiChangeRequest): string {
    const files = changeRequest.patch?.files.map((file) => `- ${file.action}: ${file.path}`).join('\n') || '- No files recorded';
    return [`Prompt: ${changeRequest.prompt}`, '', 'Files:', files].join('\n');
  }

  private async projectId(project: Project): Promise<number> {
    const cached = this.projectIdsByPath.get(project.gitlabPath);
    if (cached) {
      return cached;
    }
    const gitlabProject = await this.findProject(project.gitlabPath);
    if (!gitlabProject) {
      throw new Error(`GitLab project ${project.gitlabPath} does not exist.`);
    }
    this.projectIdsByPath.set(project.gitlabPath, gitlabProject.id);
    return gitlabProject.id;
  }

  private async request<T = unknown>(path: string, options: { method: string; body?: unknown }, ignoredStatuses: number[] = []): Promise<T> {
    if (!this.token) {
      throw new Error('GITLAB_TOKEN or GITLAB_ACCESS_TOKEN is required for GitLab provisioning.');
    }

    const response = await fetch(`${this.baseUrl}/api/v4${path}`, {
      method: options.method,
      headers: {
        'content-type': 'application/json',
        'private-token': this.token,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (ignoredStatuses.includes(response.status)) {
      return {} as T;
    }
    if (!response.ok) {
      throw new GitLabHttpError(response.status, await response.text());
    }
    if (response.status === 204) {
      return {} as T;
    }
    return await response.json() as T;
  }
}

class GitLabHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`GitLab API request failed with ${status}: ${body}`);
  }
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
