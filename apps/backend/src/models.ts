import type { ProjectRole } from '@divband/auth';
import type { ProjectStatus } from './project-lifecycle';

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}

export interface ProjectMembership {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  oauthProvider?: string;
}

export interface ApiToken {
  id: string;
  tokenHash: string;
  name: string;
  userId: string;
  projectId?: string;
  role?: ProjectRole;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface OAuthIdentity {
  id: string;
  userId: string;
  provider: 'oidc' | 'oauth';
  issuer: string;
  subject: string;
  email?: string;
  linkedAt: string;
}

export interface GitLabIdentityLink {
  id: string;
  userId: string;
  gitlabUserId: string;
  username: string;
  accessTokenHash?: string;
  linkedAt: string;
}

export interface AuthActor {
  user: User;
  session?: AuthSession;
  apiToken?: ApiToken;
}

export interface ProjectDomain {
  id: string;
  hostname: string;
  verificationToken: string;
  verificationRecord: string;
  verified: boolean;
  certificateStatus: CertificateState;
  createdAt: string;
  verifiedAt?: string;
}

export type CertificateState = 'not_requested' | 'pending' | 'issued' | 'failed';
export type DeploymentState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Deployment {
  id: string;
  projectId: string;
  state: DeploymentState;
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
  organizationId: string;
  ownerId: string;
  slug: string;
  name: string;
  status: ProjectStatus;
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

export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  projectId?: string;
  metadata: JsonObject;
  createdAt: string;
}

export interface ApiRequest {
  method: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
