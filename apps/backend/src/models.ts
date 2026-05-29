import type { ProjectRole } from '@divband/auth';
import type { ProjectStatus } from './project-lifecycle.ts';

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  suspendedAt?: string;
  suspensionReason?: string;
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
  id: string;
  tokenHash: string;
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

export type PlatformAdminRole = 'support' | 'security' | 'super_admin';

export interface PlatformAdmin {
  id: string;
  userId: string;
  role: PlatformAdminRole;
  grantedBy: string;
  grantedAt: string;
  revokedAt?: string;
}

export interface AuthActor {
  user: User;
  session?: AuthSession;
  apiToken?: ApiToken;
  platformAdmin?: PlatformAdmin;
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
export type DeploymentState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'rolling_back';
export type DeploymentEnvironment = 'production' | 'staging' | 'preview' | 'sandbox';

export interface Deployment {
  id: string;
  projectId: string;
  state: DeploymentState;
  gitRef: string;
  commitSha?: string;
  environment?: DeploymentEnvironment;
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

export interface ProjectEnvironmentSecret {
  projectId: string;
  key: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  algorithm: 'aes-256-gcm';
  protected: boolean;
  createdAt: string;
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
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  suspendedAt?: string;
  suspensionReason?: string;
}

export interface PublishFileManifest {
  path: string;
  size: number;
  contentType: string;
  hash: string;
}

export interface PublishUploadPlan {
  path: string;
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  storageBucket: string;
  storageKey: string;
  checksumSha256: string;
  contentLength: number;
  expiresAt: string;
}

export interface PublishVersion {
  id: string;
  status: 'pending' | 'live';
  files: PublishFileManifest[];
  createdAt: string;
  finalizedAt?: string;
}

export interface Publish {
  slug: string;
  ownerUserId?: string;
  claimTokenHash?: string;
  viewer?: string;
  spaMode: boolean;
  ttlSeconds: number;
  expiresAt?: string;
  liveVersionId?: string;
  versions: PublishVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishRequest {
  slug?: string;
  files: PublishFileManifest[];
  ttlSeconds?: number;
  viewer?: string;
  spaMode?: boolean;
  anonymous?: boolean;
}

export interface PublishResponse {
  slug: string;
  siteUrl: string;
  upload: {
    versionId: string;
    uploads: PublishUploadPlan[];
    skipped: PublishFileManifest[];
  };
  finalizeUrl: string;
  expiresInSeconds: number;
  claimToken?: string;
  claimUrl?: string;
  expiresAt?: string;
}

export type PublishedVersionState = 'pending' | 'live' | 'failed' | 'deleted';

export interface PublishedSite {
  id: string;
  slug: string;
  ownerId?: string;
  currentVersionId?: string;
  platformHostname: string;
  expiresAt?: string;
  claimTokenHash?: string;
  spaMode: boolean;
  viewer: string;
  passwordHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishedVersion {
  id: string;
  siteId: string;
  state: PublishedVersionState;
  createdAt: string;
  finalizedAt?: string;
}

export interface PublishedFile {
  siteId: string;
  versionId: string;
  path: string;
  size: number;
  contentType: string;
  hash: string;
  storageKey: string;
}

export interface UploadSession {
  versionId: string;
  slug: string;
  expiresAt: string;
  uploads: PublishUploadPlan[];
  skipped: PublishFileManifest[];
  scannerStatus: 'pending' | 'clean' | 'failed';
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

export interface AiContextAttachment {
  id: string;
  summary: string;
  files: string[];
  redactedSecrets: string[];
  createdAt: string;
}

export interface AiPatchFile {
  path: string;
  action: 'create' | 'update' | 'delete';
  diff: string;
}

export interface AiPatchProposal {
  id: string;
  summary: string;
  files: AiPatchFile[];
  createdAt: string;
  requiresConfirmation: boolean;
  confirmedAt?: string;
  confirmedBy?: string;
}

export interface AiGitLabBranch {
  name: string;
  webUrl: string;
  commitSha?: string;
  createdAt: string;
}

export interface AiGitLabMergeRequest {
  iid: number;
  title: string;
  webUrl: string;
  sourceBranch: string;
  targetBranch: string;
  state: 'opened' | 'merged' | 'closed';
  createdAt: string;
}

export interface AiCiStatus {
  pipelineId: string;
  status: 'created' | 'pending' | 'running' | 'success' | 'failed' | 'canceled';
  webUrl: string;
  deploymentReady: boolean;
  updatedAt: string;
}

export interface AiChangeRequest {
  id: string;
  projectId: string;
  requesterId: string;
  prompt: string;
  status: AiChangeStatus;
  targetBranch: string;
  context: AiContextAttachment[];
  patch?: AiPatchProposal;
  branch?: AiGitLabBranch;
  mergeRequest?: AiGitLabMergeRequest;
  ciStatus?: AiCiStatus;
  createdAt: string;
  updatedAt: string;
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
