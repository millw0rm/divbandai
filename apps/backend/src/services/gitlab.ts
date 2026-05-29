import type { AiChangeRequest, AiPatchProposal, Project } from '../models';

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

export class GitLabService {
  async createRepository(project: Project): Promise<GitLabRepository> {
    return {
      path: project.gitlabPath,
      webUrl: `https://gitlab.com/${project.gitlabPath}`,
      cloneUrl: `git@gitlab.com:${project.gitlabPath}.git`,
    };
  }

  async configureRunnerTag(project: Project): Promise<string> {
    return project.runnerTag;
  }

  async createBranch(project: Project, changeRequest: AiChangeRequest, patch: AiPatchProposal): Promise<GitLabBranchResult> {
    const branchName = `ai/${changeRequest.id}`;
    return {
      name: branchName,
      webUrl: `https://gitlab.com/${project.gitlabPath}/-/tree/${encodeURIComponent(branchName)}`,
      commitSha: `ai-${patch.id.slice(-12)}`,
    };
  }

  async openMergeRequest(project: Project, changeRequest: AiChangeRequest): Promise<GitLabMergeRequestResult> {
    const sourceBranch = changeRequest.branch?.name ?? `ai/${changeRequest.id}`;
    return {
      iid: Number.parseInt(changeRequest.id.replace(/\D/g, '').slice(-6), 10) || 1,
      title: `AI change: ${changeRequest.prompt.slice(0, 72)}`,
      webUrl: `https://gitlab.com/${project.gitlabPath}/-/merge_requests/${encodeURIComponent(changeRequest.id)}`,
      sourceBranch,
      targetBranch: changeRequest.targetBranch,
      state: 'opened',
    };
  }

  async triggerPipeline(project: Project, ref: string): Promise<GitLabPipelineResult> {
    return {
      pipelineId: `pipeline-${ref.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
      status: 'running',
      webUrl: `https://gitlab.com/${project.gitlabPath}/-/pipelines?ref=${encodeURIComponent(ref)}`,
    };
  }
}
