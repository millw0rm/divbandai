import type { Deployment, DeploymentEnvironment, DeploymentState, Project } from '../models.ts';
import { createId, nowIso } from '../utils.ts';

export interface DeploymentStatusReport {
  deploymentId?: string;
  state: DeploymentState;
  gitRef?: string;
  commitSha?: string;
  environment?: DeploymentEnvironment;
  image?: string;
  imageDigest?: string;
  pipelineId?: string;
  jobUrl?: string;
  ingressHostname?: string;
  healthCheckUrl?: string;
  logLine?: string;
}

const finishedStates: DeploymentState[] = ['succeeded', 'failed', 'cancelled'];

export class DeploymentStatusService {
  trigger(project: Project, gitRef: string, commitSha?: string): Deployment {
    return {
      id: createId('deploy'),
      projectId: project.id,
      state: 'queued',
      gitRef,
      commitSha,
      environment: 'production',
      logs: [`${nowIso()} queued deployment for ${gitRef}`],
    };
  }

  report(project: Project, report: DeploymentStatusReport): Deployment {
    const deployment = this.findDeployment(project, report) ?? this.createReportedDeployment(project, report);
    return this.applyReport(deployment, report);
  }

  rollback(project: Project, failedDeployment: Deployment): Deployment {
    const previousDeployment = [...project.deployments]
      .reverse()
      .find((deployment) => deployment.id !== failedDeployment.id && deployment.state === 'succeeded' && deployment.image);

    if (!previousDeployment) {
      throw new Error('No previous healthy deployment is available to roll back to.');
    }

    return {
      id: createId('deploy'),
      projectId: project.id,
      state: 'rolling_back',
      gitRef: previousDeployment.gitRef,
      commitSha: previousDeployment.commitSha,
      environment: previousDeployment.environment,
      image: previousDeployment.image,
      imageDigest: previousDeployment.imageDigest,
      ingressHostname: previousDeployment.ingressHostname,
      healthCheckUrl: previousDeployment.healthCheckUrl,
      previousDeploymentId: previousDeployment.id,
      rollbackOfDeploymentId: failedDeployment.id,
      startedAt: nowIso(),
      logs: [`${nowIso()} rolling back ${failedDeployment.id} to ${previousDeployment.image}`],
    };
  }

  transition(deployment: Deployment, state: DeploymentState, logLine?: string): Deployment {
    const timestamp = nowIso();
    return {
      ...deployment,
      state,
      startedAt: deployment.startedAt ?? (state === 'running' || state === 'rolling_back' ? timestamp : undefined),
      finishedAt: finishedStates.includes(state) ? timestamp : deployment.finishedAt,
      logs: logLine ? [...deployment.logs, `${timestamp} ${logLine}`] : deployment.logs,
    };
  }

  private findDeployment(project: Project, report: DeploymentStatusReport): Deployment | undefined {
    if (report.deploymentId) {
      return project.deployments.find((deployment) => deployment.id === report.deploymentId);
    }
    if (report.pipelineId) {
      return project.deployments.find((deployment) => deployment.pipelineId === report.pipelineId);
    }
    if (report.commitSha) {
      return [...project.deployments]
        .reverse()
        .find((deployment) => deployment.commitSha === report.commitSha && deployment.environment === (report.environment ?? 'production'));
    }
    return undefined;
  }

  private createReportedDeployment(project: Project, report: DeploymentStatusReport): Deployment {
    const deployment: Deployment = {
      id: createId('deploy'),
      projectId: project.id,
      state: 'queued',
      gitRef: report.gitRef ?? 'main',
      commitSha: report.commitSha,
      environment: report.environment ?? 'production',
      logs: [],
    };
    project.deployments.push(deployment);
    return deployment;
  }

  private applyReport(deployment: Deployment, report: DeploymentStatusReport): Deployment {
    const timestamp = nowIso();
    deployment.state = report.state;
    deployment.gitRef = report.gitRef ?? deployment.gitRef;
    deployment.commitSha = report.commitSha ?? deployment.commitSha;
    deployment.environment = report.environment ?? deployment.environment;
    deployment.image = report.image ?? deployment.image;
    deployment.imageDigest = report.imageDigest ?? deployment.imageDigest;
    deployment.pipelineId = report.pipelineId ?? deployment.pipelineId;
    deployment.jobUrl = report.jobUrl ?? deployment.jobUrl;
    deployment.ingressHostname = report.ingressHostname ?? deployment.ingressHostname;
    deployment.healthCheckUrl = report.healthCheckUrl ?? deployment.healthCheckUrl;
    deployment.startedAt = deployment.startedAt ?? (report.state === 'running' || report.state === 'rolling_back' ? timestamp : undefined);
    deployment.finishedAt = finishedStates.includes(report.state) ? timestamp : deployment.finishedAt;
    deployment.logs.push(`${timestamp} ${report.logLine ?? `reported ${report.state}`}`);
    return deployment;
  }
}
