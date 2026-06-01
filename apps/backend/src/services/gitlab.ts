import type { AiChangeRequest, AiPatchProposal, EnvironmentVariable, GitLabIdentityLink, Project } from '../models.ts';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

export type SourceControlProvider = 'gitlab' | 'github';

export interface GitLabRepository {
  path: string;
  webUrl: string;
  cloneUrl: string;
  provider?: SourceControlProvider;
  defaultBranch?: string;
  offline?: boolean;
}

export interface SourceControlRepositorySummary {
  name: string;
  fullName: string;
  webUrl: string;
  private: boolean;
  defaultBranch: string;
}

export interface SourceControlRepositoryFile {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size?: number;
  webUrl: string;
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

interface GitHubUserResponse {
  login: string;
}

interface GitHubRepositoryResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
}

interface GitHubRefResponse {
  object: {
    sha: string;
  };
}

interface GitHubContentResponse {
  name?: string;
  path?: string;
  type?: 'file' | 'dir' | 'symlink' | 'submodule';
  size?: number;
  html_url?: string;
  content?: {
    sha?: string;
  };
  commit?: {
    sha?: string;
  };
}

interface GitHubPullRequestResponse {
  number: number;
  title: string;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
  state: 'open' | 'closed';
}

export class GitLabService {
  private readonly provider: SourceControlProvider;
  private readonly gitLabBaseUrl: string;
  private readonly gitHubBaseUrl: string;
  private readonly gitLabToken: string;
  private readonly gitHubToken: string;
  private readonly namespaceId?: number;
  private readonly defaultBranch: string;
  private readonly projectIdsByPath = new Map<string, number>();
  private readonly githubReposByProjectId = new Map<string, { owner: string; repo: string; fullName: string }>();

  constructor(env: Record<string, string | undefined> = process.env) {
    this.provider = sourceControlProvider(env.SOURCE_CONTROL_PROVIDER ?? env.DIVBAND_SOURCE_CONTROL_PROVIDER, env);
    this.gitLabBaseUrl = (env.GITLAB_URL?.trim() || 'https://gitlab.com').replace(/\/+$/, '');
    this.gitHubBaseUrl = (env.GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, '');
    this.gitLabToken = env.GITLAB_TOKEN?.trim() || env.GITLAB_ACCESS_TOKEN?.trim() || '';
    this.gitHubToken = env.GITHUB_TOKEN?.trim() || env.GITHUB_ACCESS_TOKEN?.trim() || '';
    this.namespaceId = positiveInteger(env.GITLAB_NAMESPACE_ID);
    this.defaultBranch = env.GITLAB_DEFAULT_BRANCH?.trim() || env.GITHUB_DEFAULT_BRANCH?.trim() || 'main';
  }

  requiresLinkedIdentity(): boolean {
    if (this.provider === 'github') {
      return !this.gitHubToken;
    }
    return Boolean(this.gitLabToken);
  }

  async createRepository(project: Project, environmentVariables: EnvironmentVariable[] = [], identity?: GitLabIdentityLink): Promise<GitLabRepository> {
    if (this.provider === 'github') {
      return this.createGitHubRepository(project, identity);
    }

    if (!this.gitLabToken) {
      return this.mockRepository(project);
    }

    const existing = await this.findGitLabProject(project.gitlabPath);
    const gitlabProject = existing ?? await this.createGitLabProject(project);
    this.projectIdsByPath.set(project.gitlabPath, gitlabProject.id);

    await this.configureGitLabProjectVariables(project, environmentVariables);
    await this.protectGitLabBranch(gitlabProject.id, gitlabProject.default_branch ?? this.defaultBranch);
    await this.createGitLabDeploymentCredential(gitlabProject.id, project);

    return {
      path: gitlabProject.path_with_namespace,
      webUrl: gitlabProject.web_url,
      cloneUrl: gitlabProject.ssh_url_to_repo,
      provider: 'gitlab',
      defaultBranch: gitlabProject.default_branch ?? this.defaultBranch,
    };
  }

  async deleteRepository(project: Project, identity?: GitLabIdentityLink): Promise<{ deleted: boolean; path?: string }> {
    if (this.provider === 'github') {
      const token = this.gitHubTokenFor(identity);
      if (!token) {
        this.githubReposByProjectId.delete(project.id);
        return { deleted: false, path: project.repository?.path ?? project.gitlabPath };
      }

      const repo = await this.githubRepositoryFor(project, identity);
      await this.gitHubRequest(`/repos/${repo.owner}/${repo.repo}`, { method: 'DELETE' }, token);
      this.githubReposByProjectId.delete(project.id);
      return { deleted: true, path: repo.fullName };
    }

    if (!this.gitLabToken) {
      return { deleted: false, path: project.repository?.path ?? project.gitlabPath };
    }

    const projectId = await this.gitLabProjectId(project);
    await this.gitLabRequest(`/projects/${projectId}`, { method: 'DELETE' });
    this.projectIdsByPath.delete(project.gitlabPath);
    return { deleted: true, path: project.gitlabPath };
  }

  async configureRunnerTag(project: Project, identity?: GitLabIdentityLink): Promise<string> {
    if (this.provider === 'github') {
      const repo = this.githubReposByProjectId.get(project.id);
      if (repo) {
        await this.upsertGitHubVariable(repo.owner, repo.repo, 'DIVBAND_RUNNER_TAG', project.runnerTag, identity);
      }
      return project.runnerTag;
    }

    if (!this.gitLabToken) {
      return project.runnerTag;
    }

    const projectId = await this.gitLabProjectId(project);
    await this.upsertGitLabVariable(projectId, {
      key: 'DIVBAND_RUNNER_TAG',
      value: project.runnerTag,
      protected: false,
      masked: false,
    });
    return project.runnerTag;
  }

  async createBranch(project: Project, changeRequest: AiChangeRequest, patch: AiPatchProposal, identity?: GitLabIdentityLink): Promise<GitLabBranchResult> {
    if (this.provider === 'github') {
      return this.createGitHubBranch(project, changeRequest, patch, identity);
    }

    const projectId = await this.gitLabProjectId(project);
    const branchName = `ai/${changeRequest.id}`;
    const branch = await this.gitLabRequest<GitLabBranchResponse>(`/projects/${projectId}/repository/branches`, {
      method: 'POST',
      body: {
        branch: branchName,
        ref: changeRequest.targetBranch || this.defaultBranch,
      },
    }, [400]);

    const commit = await this.commitGitLabPatchSummary(projectId, branchName, changeRequest, patch);
    return {
      name: branchName,
      webUrl: branch.web_url ?? `${this.gitLabBaseUrl}/${project.gitlabPath}/-/tree/${encodeURIComponent(branchName)}`,
      commitSha: commit.id,
    };
  }

  async openMergeRequest(project: Project, changeRequest: AiChangeRequest, identity?: GitLabIdentityLink): Promise<GitLabMergeRequestResult> {
    if (this.provider === 'github') {
      return this.openGitHubPullRequest(project, changeRequest, identity);
    }

    const projectId = await this.gitLabProjectId(project);
    const sourceBranch = changeRequest.branch?.name ?? `ai/${changeRequest.id}`;
    const title = `AI change: ${changeRequest.prompt.slice(0, 72)}`;
    const mr = await this.gitLabRequest<GitLabMergeRequestResponse>(`/projects/${projectId}/merge_requests`, {
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

  async triggerPipeline(project: Project, ref: string, identity?: GitLabIdentityLink): Promise<GitLabPipelineResult> {
    if (this.provider === 'github') {
      const repo = await this.githubRepositoryFor(project, identity);
      return {
        pipelineId: `github-actions:${ref}`,
        status: 'created',
        webUrl: `https://github.com/${repo.fullName}/actions`,
      };
    }

    const projectId = await this.gitLabProjectId(project);
    const pipeline = await this.gitLabRequest<GitLabPipelineResponse>(`/projects/${projectId}/pipeline`, {
      method: 'POST',
      body: { ref },
    });

    return {
      pipelineId: String(pipeline.id),
      status: pipeline.status,
      webUrl: pipeline.web_url,
    };
  }

  async linkGitHubRepository(project: Project, fullName: string, identity?: GitLabIdentityLink): Promise<GitLabRepository> {
    const normalized = fullName.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(normalized)) {
      throw new Error('Repository must be in owner/name format.');
    }

    const token = this.requiredGitHubToken(identity);
    const repo = await this.gitHubRequest<GitHubRepositoryResponse>(`/repos/${normalized}`, { method: 'GET' }, token);
    const [owner, repoName] = repo.full_name.split('/');
    if (!owner || !repoName) {
      throw new Error('GitHub repository response was invalid.');
    }

    this.githubReposByProjectId.set(project.id, { owner, repo: repoName, fullName: repo.full_name });
    await this.upsertGitHubVariable(owner, repoName, 'DIVBAND_PROJECT_ID', project.id, identity);
    await this.upsertGitHubVariable(owner, repoName, 'DIVBAND_PROJECT_SLUG', project.slug, identity);
    await this.upsertGitHubVariable(owner, repoName, 'DIVBAND_PLATFORM_HOSTNAME', project.platformHostname, identity);

    return {
      path: repo.full_name,
      webUrl: repo.html_url,
      cloneUrl: repo.ssh_url,
      provider: 'github',
      defaultBranch: repo.default_branch,
      offline: false,
    };
  }

  async listRepositories(identity?: GitLabIdentityLink): Promise<SourceControlRepositorySummary[]> {
    if (this.provider === 'github') {
      const token = this.requiredGitHubToken(identity);
      const repos = await this.gitHubRequest<GitHubRepositoryResponse[]>('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', { method: 'GET' }, token);
      return repos.map((repo) => ({
        name: repo.name,
        fullName: repo.full_name,
        webUrl: repo.html_url,
        private: repo.private,
        defaultBranch: repo.default_branch,
      }));
    }

    throw new Error('Repository listing is currently implemented for GitHub source control.');
  }

  async listRepositoryContents(project: Project, identity?: GitLabIdentityLink, path = ''): Promise<SourceControlRepositoryFile[]> {
    if (this.provider !== 'github') {
      throw new Error('Repository contents are currently implemented for GitHub source control.');
    }
    const repo = await this.githubRepositoryFor(project, identity);
    const token = this.requiredGitHubToken(identity);
    const response = await this.gitHubRequest<GitHubContentResponse[] | GitHubContentResponse>(
      `/repos/${repo.owner}/${repo.repo}/contents/${encodePath(path)}`,
      { method: 'GET' },
      token,
    );
    const entries = Array.isArray(response) ? response : [response];
    return entries.map((entry) => ({
      name: entry.name ?? entry.path ?? '',
      path: entry.path ?? entry.name ?? '',
      type: entry.type ?? 'file',
      size: entry.size,
      webUrl: entry.html_url ?? `https://github.com/${repo.fullName}`,
    }));
  }

  private mockRepository(project: Project, identity?: GitLabIdentityLink, offline = true): GitLabRepository {
    const repoName = githubRepoName(project.slug);
    const owner = identity?.provider === 'github' && identity.username
      ? identity.username
      : project.gitlabPath.split('/').slice(-2, -1)[0] ?? project.gitlabPath.split('/')[0] ?? 'local-user';
    const path = `${owner}/${repoName}`;
    const baseUrl = this.provider === 'github' ? 'https://github.com' : this.gitLabBaseUrl;
    return {
      path,
      webUrl: `${baseUrl}/${path}`,
      cloneUrl: `git@${new URL(baseUrl).hostname}:${path}.git`,
      provider: this.provider,
      defaultBranch: this.defaultBranch,
      offline,
    };
  }

  private async createGitHubRepository(project: Project, identity?: GitLabIdentityLink): Promise<GitLabRepository> {
    if (['1', 'true', 'yes'].includes((process.env.DIVBAND_GITHUB_OFFLINE ?? '').toLowerCase())) {
      return this.mockRepository(project, identity);
    }

    const token = this.gitHubTokenFor(identity);
    if (!token) {
      return this.mockRepository(project, identity);
    }

    try {
      const user = await this.gitHubRequest<GitHubUserResponse>('/user', { method: 'GET' }, token);
      const repoName = githubRepoName(project.slug);
      const existing = await this.findGitHubRepository(user.login, repoName, token);
      const repo = existing ?? await this.gitHubRequest<GitHubRepositoryResponse>('/user/repos', {
        method: 'POST',
        body: {
          name: repoName,
          private: true,
          auto_init: true,
          description: `Divband project ${project.name}`,
        },
      }, token);

      this.githubReposByProjectId.set(project.id, { owner: user.login, repo: repo.name, fullName: repo.full_name });
      await this.upsertGitHubVariable(user.login, repo.name, 'DIVBAND_PROJECT_ID', project.id, identity);
      await this.upsertGitHubVariable(user.login, repo.name, 'DIVBAND_PROJECT_SLUG', project.slug, identity);
      await this.upsertGitHubVariable(user.login, repo.name, 'DIVBAND_PLATFORM_HOSTNAME', project.platformHostname, identity);

      return {
        path: repo.full_name,
        webUrl: repo.html_url,
        cloneUrl: repo.ssh_url,
        provider: 'github',
        defaultBranch: repo.default_branch,
        offline: false,
      };
    } catch (error) {
      if (this.shouldUseOfflineGitHubFallback(error)) {
        return this.mockRepository(project, identity);
      }
      throw error;
    }
  }

  private shouldUseOfflineGitHubFallback(error: unknown): boolean {
    if (['1', 'true', 'yes'].includes((process.env.DIVBAND_GITHUB_OFFLINE ?? '').toLowerCase())) {
      return true;
    }
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    return isGitHubNetworkError(error);
  }

  private async createGitHubBranch(project: Project, changeRequest: AiChangeRequest, patch: AiPatchProposal, identity?: GitLabIdentityLink): Promise<GitLabBranchResult> {
    const repo = await this.githubRepositoryFor(project, identity);
    const token = this.requiredGitHubToken(identity);
    const sourceBranch = changeRequest.targetBranch || this.defaultBranch;
    const branchName = `ai/${changeRequest.id}`;
    const sourceRef = await this.gitHubRequest<GitHubRefResponse>(`/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(sourceBranch)}`, { method: 'GET' }, token);

    await this.gitHubRequest(`/repos/${repo.owner}/${repo.repo}/git/refs`, {
      method: 'POST',
      body: {
        ref: `refs/heads/${branchName}`,
        sha: sourceRef.object.sha,
      },
    }, token, [422]);

    const content = this.patchSummaryContent(changeRequest, patch);
    const filePath = `.divband/ai/${changeRequest.id}.md`;
    const commit = await this.gitHubRequest<GitHubContentResponse>(`/repos/${repo.owner}/${repo.repo}/contents/${encodePath(filePath)}`, {
      method: 'PUT',
      body: {
        message: `Apply AI proposal ${changeRequest.id}`,
        content: Buffer.from(content).toString('base64'),
        branch: branchName,
      },
    }, token);

    return {
      name: branchName,
      webUrl: `https://github.com/${repo.fullName}/tree/${encodeURIComponent(branchName)}`,
      commitSha: commit.commit?.sha ?? sourceRef.object.sha,
    };
  }

  private async openGitHubPullRequest(project: Project, changeRequest: AiChangeRequest, identity?: GitLabIdentityLink): Promise<GitLabMergeRequestResult> {
    const repo = await this.githubRepositoryFor(project, identity);
    const token = this.requiredGitHubToken(identity);
    const sourceBranch = changeRequest.branch?.name ?? `ai/${changeRequest.id}`;
    const pr = await this.gitHubRequest<GitHubPullRequestResponse>(`/repos/${repo.owner}/${repo.repo}/pulls`, {
      method: 'POST',
      body: {
        title: `AI change: ${changeRequest.prompt.slice(0, 72)}`,
        head: sourceBranch,
        base: changeRequest.targetBranch || this.defaultBranch,
        body: this.mergeRequestDescription(changeRequest),
      },
    }, token);

    return {
      iid: pr.number,
      title: pr.title,
      webUrl: pr.html_url,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      state: pr.state === 'open' ? 'opened' : 'closed',
    };
  }

  private async githubRepositoryFor(project: Project, identity?: GitLabIdentityLink): Promise<{ owner: string; repo: string; fullName: string }> {
    const cached = this.githubReposByProjectId.get(project.id);
    if (cached) {
      return cached;
    }

    if (project.repository?.provider === 'github' && project.repository.path.includes('/')) {
      const [owner, repo] = project.repository.path.split('/');
      if (owner && repo) {
        const details = { owner, repo, fullName: project.repository.path };
        this.githubReposByProjectId.set(project.id, details);
        return details;
      }
    }

    const token = this.requiredGitHubToken(identity);
    const user = await this.gitHubRequest<GitHubUserResponse>('/user', { method: 'GET' }, token);
    const repoName = githubRepoName(project.slug);
    const repo = await this.findGitHubRepository(user.login, repoName, token);
    if (!repo) {
      throw new Error(`GitHub repository ${user.login}/${repoName} does not exist.`);
    }
    const details = { owner: user.login, repo: repo.name, fullName: repo.full_name };
    this.githubReposByProjectId.set(project.id, details);
    return details;
  }

  private async findGitHubRepository(owner: string, repo: string, token: string): Promise<GitHubRepositoryResponse | undefined> {
    try {
      return await this.gitHubRequest<GitHubRepositoryResponse>(`/repos/${owner}/${repo}`, { method: 'GET' }, token);
    } catch (error) {
      if (error instanceof SourceControlHttpError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  private async upsertGitHubVariable(owner: string, repo: string, name: string, value: string, identity?: GitLabIdentityLink): Promise<void> {
    const token = this.gitHubTokenFor(identity);
    if (!token) {
      return;
    }
    await this.gitHubRequest(`/repos/${owner}/${repo}/actions/variables/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: { name, value },
    }, token, [404]);
    await this.gitHubRequest(`/repos/${owner}/${repo}/actions/variables`, {
      method: 'POST',
      body: { name, value },
    }, token, [201, 409]);
  }

  private async createGitLabProject(project: Project): Promise<GitLabProjectResponse> {
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

    return this.gitLabRequest<GitLabProjectResponse>('/projects', { method: 'POST', body });
  }

  private async findGitLabProject(path: string): Promise<GitLabProjectResponse | undefined> {
    try {
      return await this.gitLabRequest<GitLabProjectResponse>(`/projects/${encodeURIComponent(path)}`, { method: 'GET' });
    } catch (error) {
      if (error instanceof SourceControlHttpError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  private async configureGitLabProjectVariables(project: Project, environmentVariables: EnvironmentVariable[]): Promise<void> {
    const projectId = await this.gitLabProjectId(project);
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

    await Promise.all(variables.map((variable) => this.upsertGitLabVariable(projectId, variable)));
  }

  private async upsertGitLabVariable(projectId: number, variable: { key: string; value: string; protected: boolean; masked: boolean }): Promise<void> {
    const body = {
      value: variable.value,
      protected: variable.protected,
      masked: variable.masked,
      raw: true,
      environment_scope: '*',
    };
    try {
      await this.gitLabRequest(`/projects/${projectId}/variables/${encodeURIComponent(variable.key)}`, { method: 'PUT', body });
    } catch (error) {
      if (error instanceof SourceControlHttpError && error.status === 404) {
        await this.gitLabRequest(`/projects/${projectId}/variables`, { method: 'POST', body: { key: variable.key, ...body } });
        return;
      }
      throw error;
    }
  }

  private async protectGitLabBranch(projectId: number, branch: string): Promise<void> {
    await this.gitLabRequest(`/projects/${projectId}/protected_branches`, {
      method: 'POST',
      body: {
        name: branch,
        push_access_level: 40,
        merge_access_level: 40,
        allow_force_push: false,
      },
    }, [409]);
  }

  private async createGitLabDeploymentCredential(projectId: number, project: Project): Promise<void> {
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const preferAccessToken = process.env.GITLAB_USE_PROJECT_ACCESS_TOKEN === '1';
    if (preferAccessToken) {
      await this.gitLabRequest(`/projects/${projectId}/access_tokens`, {
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

    await this.gitLabRequest(`/projects/${projectId}/deploy_tokens`, {
      method: 'POST',
      body: {
        name: `divband-${project.slug}-deploy`,
        scopes: ['read_repository', 'read_registry'],
        expires_at: expiresAt,
      },
    }, [400, 409]);
  }

  private async commitGitLabPatchSummary(projectId: number, branch: string, changeRequest: AiChangeRequest, patch: AiPatchProposal): Promise<GitLabCommitResponse> {
    return this.gitLabRequest<GitLabCommitResponse>(`/projects/${projectId}/repository/commits`, {
      method: 'POST',
      body: {
        branch,
        commit_message: `Apply AI proposal ${changeRequest.id}`,
        actions: [{ action: 'create', file_path: `.divband/ai/${changeRequest.id}.md`, content: this.patchSummaryContent(changeRequest, patch) }],
      },
    });
  }

  private patchSummaryContent(changeRequest: AiChangeRequest, patch: AiPatchProposal): string {
    return [
      `# AI change ${changeRequest.id}`,
      '',
      patch.summary,
      '',
      '## Proposed files',
      ...patch.files.map((file) => `- ${file.action}: ${file.path}`),
      '',
      'The MVP adapter records the reviewed proposal. A later worker can translate stored diffs into exact file actions.',
      '',
    ].join('\n');
  }

  private mergeRequestDescription(changeRequest: AiChangeRequest): string {
    const files = changeRequest.patch?.files.map((file) => `- ${file.action}: ${file.path}`).join('\n') || '- No files recorded';
    return [`Prompt: ${changeRequest.prompt}`, '', 'Files:', files].join('\n');
  }

  private async gitLabProjectId(project: Project): Promise<number> {
    const cached = this.projectIdsByPath.get(project.gitlabPath);
    if (cached) {
      return cached;
    }
    const gitlabProject = await this.findGitLabProject(project.gitlabPath);
    if (!gitlabProject) {
      throw new Error(`GitLab project ${project.gitlabPath} does not exist.`);
    }
    this.projectIdsByPath.set(project.gitlabPath, gitlabProject.id);
    return gitlabProject.id;
  }

  private requiredGitHubToken(identity?: GitLabIdentityLink): string {
    const token = this.gitHubTokenFor(identity);
    if (!token) {
      throw new Error('Link a GitHub identity with an access token before provisioning or pushing repository changes.');
    }
    return token;
  }

  private gitHubTokenFor(identity?: GitLabIdentityLink): string {
    return identity?.provider === 'github' && identity.accessToken ? identity.accessToken : this.gitHubToken;
  }

  private async gitLabRequest<T = unknown>(path: string, options: { method: string; body?: unknown }, ignoredStatuses: number[] = []): Promise<T> {
    if (!this.gitLabToken) {
      throw new Error('GITLAB_TOKEN or GITLAB_ACCESS_TOKEN is required for GitLab provisioning.');
    }

    const response = await fetch(`${this.gitLabBaseUrl}/api/v4${path}`, {
      method: options.method,
      headers: {
        'content-type': 'application/json',
        'private-token': this.gitLabToken,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    return parseJsonResponse<T>(response, ignoredStatuses, 'GitLab');
  }

  private async gitHubRequest<T = unknown>(path: string, options: { method: string; body?: unknown }, token: string, ignoredStatuses: number[] = []): Promise<T> {
    try {
      const response = await fetch(`${this.gitHubBaseUrl}${path}`, {
        method: options.method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(30_000),
      });

      return await parseJsonResponse<T>(response, ignoredStatuses, 'GitHub');
    } catch (error) {
      if (error instanceof SourceControlHttpError) {
        throw error;
      }
      throw new Error(formatGitHubNetworkFailure(error));
    }
  }
}

class SourceControlHttpError extends Error {
  constructor(readonly status: number, provider: string, body: string) {
    super(`${provider} API request failed with ${status}: ${body}`);
  }
}

async function parseJsonResponse<T>(response: Response, ignoredStatuses: number[], provider: string): Promise<T> {
  if (ignoredStatuses.includes(response.status)) {
    return {} as T;
  }
  if (!response.ok) {
    throw new SourceControlHttpError(response.status, provider, await response.text());
  }
  if (response.status === 204) {
    return {} as T;
  }
  return await response.json() as T;
}

function sourceControlProvider(value: string | undefined, env: Record<string, string | undefined>): SourceControlProvider {
  if (value === 'github' || value === 'gitlab') {
    return value;
  }
  if (env.GITHUB_TOKEN || env.GITHUB_ACCESS_TOKEN) {
    return 'github';
  }
  return 'gitlab';
}

function githubRepoName(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'divband-project';
}

function isGitHubNetworkError(error: unknown): boolean {
  const message = formatGitHubNetworkFailure(error).toLowerCase();
  return message.includes('fetch failed')
    || message.includes('eai_again')
    || message.includes('enotfound')
    || message.includes('econnrefused')
    || message.includes('etimedout')
    || message.includes('network');
}

function formatGitHubNetworkFailure(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : undefined;
    return cause ? `${error.message} (${cause})` : error.message;
  }
  return 'network request failed';
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
