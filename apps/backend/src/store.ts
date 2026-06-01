import type {
  AbuseAction,
  ApiToken,
  AiChangeRequest,
  AuditEvent,
  AuthSession,
  EmailVerificationChallenge,
  GitLabIdentityLink,
  MonitoringSignal,
  OAuthIdentity,
  PasswordResetChallenge,
  Organization,
  OrganizationMembership,
  Project,
  RateLimitBucket,
  ProjectEnvironmentSecret,
  PlatformAdmin,
  ProjectMembership,
  Publish,
  PublishedFile,
  PublishedSite,
  PublishedVersion,
  SourceControlOAuthState,
  UploadSession,
  User,
} from './models.ts';

export interface BackendStore {
  users: Map<string, User>;
  usersByEmail: Map<string, string>;
  passwordHashesByUserId: Map<string, string>;
  emailVerificationChallenges: Map<string, EmailVerificationChallenge>;
  passwordResetChallenges: Map<string, PasswordResetChallenge>;
  rateLimitBuckets: Map<string, RateLimitBucket>;
  monitoringSignals: Map<string, MonitoringSignal>;
  sessions: Map<string, AuthSession>;
  apiTokens: Map<string, ApiToken>;
  platformAdmins: Map<string, PlatformAdmin>;
  organizations: Map<string, Organization>;
  organizationMemberships: Map<string, OrganizationMembership>;
  projects: Map<string, Project>;
  projectEnvironmentSecrets: Map<string, ProjectEnvironmentSecret>;
  projectMemberships: Map<string, ProjectMembership>;
  oauthIdentities: Map<string, OAuthIdentity>;
  gitlabIdentityLinks: Map<string, GitLabIdentityLink>;
  sourceControlOAuthStates: Map<string, SourceControlOAuthState>;
  auditEvents: AuditEvent[];
  aiChangeRequests: Map<string, AiChangeRequest>;
  publishes: Map<string, Publish>;
  publishedSites: Map<string, PublishedSite>;
  publishedVersions: Map<string, PublishedVersion>;
  publishedFiles: PublishedFile[];
  uploadSessions: Map<string, UploadSession>;
  abuseActions: Map<string, AbuseAction>;
}

export interface BackendStoreSnapshot {
  users: User[];
  usersByEmail: Array<[string, string]>;
  passwordHashesByUserId: Array<[string, string]>;
  emailVerificationChallenges: EmailVerificationChallenge[];
  passwordResetChallenges: PasswordResetChallenge[];
  rateLimitBuckets: RateLimitBucket[];
  monitoringSignals: MonitoringSignal[];
  sessions: AuthSession[];
  apiTokens: ApiToken[];
  platformAdmins: PlatformAdmin[];
  organizations: Organization[];
  organizationMemberships: OrganizationMembership[];
  projects: Project[];
  projectEnvironmentSecrets: ProjectEnvironmentSecret[];
  projectMemberships: ProjectMembership[];
  oauthIdentities: OAuthIdentity[];
  gitlabIdentityLinks: GitLabIdentityLink[];
  sourceControlOAuthStates: SourceControlOAuthState[];
  auditEvents: AuditEvent[];
  aiChangeRequests: AiChangeRequest[];
  publishes: Publish[];
  publishedSites: PublishedSite[];
  publishedVersions: PublishedVersion[];
  publishedFiles: PublishedFile[];
  uploadSessions: UploadSession[];
  abuseActions: AbuseAction[];
}

export interface PersistenceAdapter {
  load(): Promise<BackendStoreSnapshot | undefined>;
  save(snapshot: BackendStoreSnapshot): Promise<void>;
}

export function createBackendStore(): BackendStore {
  return {
    users: new Map(),
    usersByEmail: new Map(),
    passwordHashesByUserId: new Map(),
    emailVerificationChallenges: new Map(),
    passwordResetChallenges: new Map(),
    rateLimitBuckets: new Map(),
    monitoringSignals: new Map(),
    sessions: new Map(),
    apiTokens: new Map(),
    platformAdmins: new Map(),
    organizations: new Map(),
    organizationMemberships: new Map(),
    projects: new Map(),
    projectEnvironmentSecrets: new Map(),
    projectMemberships: new Map(),
    oauthIdentities: new Map(),
    gitlabIdentityLinks: new Map(),
    sourceControlOAuthStates: new Map(),
    auditEvents: [],
    aiChangeRequests: new Map(),
    publishes: new Map(),
    publishedSites: new Map(),
    publishedVersions: new Map(),
    publishedFiles: [],
    uploadSessions: new Map(),
    abuseActions: new Map(),
  };
}

export function snapshotBackendStore(store: BackendStore): BackendStoreSnapshot {
  return {
    users: [...store.users.values()],
    usersByEmail: [...store.usersByEmail.entries()],
    passwordHashesByUserId: [...store.passwordHashesByUserId.entries()],
    emailVerificationChallenges: [...store.emailVerificationChallenges.values()],
    passwordResetChallenges: [...store.passwordResetChallenges.values()],
    rateLimitBuckets: [...store.rateLimitBuckets.values()],
    monitoringSignals: [...store.monitoringSignals.values()],
    sessions: [...store.sessions.values()],
    apiTokens: [...store.apiTokens.values()],
    platformAdmins: [...store.platformAdmins.values()],
    organizations: [...store.organizations.values()],
    organizationMemberships: [...store.organizationMemberships.values()],
    projects: [...store.projects.values()],
    projectEnvironmentSecrets: [...store.projectEnvironmentSecrets.values()],
    projectMemberships: [...store.projectMemberships.values()],
    oauthIdentities: [...store.oauthIdentities.values()],
    gitlabIdentityLinks: [...store.gitlabIdentityLinks.values()].map(({ accessToken: _accessToken, ...identity }) => identity),
    sourceControlOAuthStates: [...store.sourceControlOAuthStates.values()],
    auditEvents: [...store.auditEvents],
    aiChangeRequests: [...store.aiChangeRequests.values()],
    publishes: [...store.publishes.values()],
    publishedSites: [...store.publishedSites.values()],
    publishedVersions: [...store.publishedVersions.values()],
    publishedFiles: [...store.publishedFiles],
    uploadSessions: [...store.uploadSessions.values()],
    abuseActions: [...store.abuseActions.values()],
  };
}

export function hydrateBackendStore(snapshot: BackendStoreSnapshot, store: BackendStore = createBackendStore()): BackendStore {
  store.users = mapById(snapshot.users.map((user, index) => ({
    ...user,
    username: user.username || normalizeLegacyUsername(user, index),
  })));
  store.usersByEmail = new Map(snapshot.usersByEmail);
  store.passwordHashesByUserId = new Map(snapshot.passwordHashesByUserId);
  store.emailVerificationChallenges = mapById(snapshot.emailVerificationChallenges ?? []);
  store.passwordResetChallenges = mapById(snapshot.passwordResetChallenges ?? []);
  store.rateLimitBuckets = new Map((snapshot.rateLimitBuckets ?? []).map((bucket) => [bucket.key, bucket]));
  store.monitoringSignals = mapById(snapshot.monitoringSignals ?? []);
  store.sessions = new Map((snapshot.sessions ?? []).map((session) => [session.tokenHash, session]));
  store.apiTokens = mapById(snapshot.apiTokens);
  store.platformAdmins = mapById(snapshot.platformAdmins ?? []);
  store.organizations = mapById(snapshot.organizations);
  store.organizationMemberships = mapById(snapshot.organizationMemberships);
  store.projects = mapById(snapshot.projects.map((project) => {
    const legacyProject = project as Project & { environmentVariables?: Array<{ key: string; value: string; protected: boolean; updatedAt: string }> };
    const { environmentVariables: _environmentVariables, ...safeProject } = legacyProject;
    return {
      ...safeProject,
      workspaceHostname: safeProject.workspaceHostname ?? inferWorkspaceHostname(safeProject.platformHostname),
      domains: (safeProject.domains ?? []).map((domain) => normalizeProjectDomain(domain, safeProject.platformHostname)),
    };
  }));
  store.projectEnvironmentSecrets = new Map((snapshot.projectEnvironmentSecrets ?? []).map((secret) => [`${secret.projectId}:${secret.key}`, secret]));
  store.projectMemberships = mapById(snapshot.projectMemberships);
  store.oauthIdentities = mapById(snapshot.oauthIdentities);
  store.gitlabIdentityLinks = mapById(snapshot.gitlabIdentityLinks);
  store.sourceControlOAuthStates = new Map((snapshot.sourceControlOAuthStates ?? []).map((state) => [state.state, state]));
  store.auditEvents = [...snapshot.auditEvents];
  store.aiChangeRequests = mapById(snapshot.aiChangeRequests);
  store.publishes = new Map(snapshot.publishes.map((publish) => [publish.slug, publish]));
  store.publishedSites = new Map(snapshot.publishedSites.map((site) => [site.slug, site]));
  store.publishedVersions = mapById(snapshot.publishedVersions);
  store.publishedFiles = [...snapshot.publishedFiles];
  store.uploadSessions = new Map((snapshot.uploadSessions ?? []).map((session) => [session.versionId, session]));
  store.abuseActions = mapById(snapshot.abuseActions ?? []);
  return store;
}

function normalizeProjectDomain(domain: Project['domains'][number], platformHostname: string): Project['domains'][number] {
  const legacyDomain = domain as Project['domains'][number] & { dnsMode?: Project['domains'][number]['dnsMode']; status?: Project['domains'][number]['status']; verificationStatus?: Project['domains'][number]['verificationStatus']; verificationName?: string; verificationValue?: string; assignedNameservers?: string[]; delegationStatus?: Project['domains'][number]['delegationStatus']; dnsInstructions?: Project['domains'][number]['dnsInstructions']; delegationCheckedAt?: string; delegationVerifiedAt?: string; delegationFailedAt?: string; updatedAt?: string };
  const dnsMode = legacyDomain.dnsMode ?? (legacyDomain.hostname.split('.').length === 2 ? 'apex' : 'custom_cname');
  const verificationName = legacyDomain.verificationName ?? legacyDomain.verificationRecord.split(' TXT ')[0] ?? `_divband.${legacyDomain.hostname}`;
  const verificationValue = legacyDomain.verificationValue ?? legacyDomain.verificationRecord.split(' TXT ')[1] ?? `divband-verification=${legacyDomain.verificationToken}`;
  const assignedNameservers = legacyDomain.assignedNameservers ?? [];
  return {
    ...legacyDomain,
    dnsMode,
    status: legacyDomain.status ?? (legacyDomain.verified ? 'active' : 'pending_dns'),
    verificationStatus: legacyDomain.verificationStatus ?? (legacyDomain.verified ? 'verified' : 'pending'),
    verificationName,
    verificationValue,
    dnsTarget: legacyDomain.dnsTarget ?? platformHostname,
    assignedNameservers,
    delegationStatus: legacyDomain.delegationStatus ?? 'not_applicable',
    dnsInstructions: legacyDomain.dnsInstructions ?? [
      { type: 'TXT', name: verificationName, value: verificationValue, purpose: 'ownership_verification', required: true },
    ],
    updatedAt: legacyDomain.updatedAt ?? legacyDomain.verifiedAt ?? legacyDomain.createdAt,
  };
}

function mapById<T extends { id: string }>(values: T[]): Map<string, T> {
  return new Map(values.map((value) => [value.id, value]));
}

function normalizeLegacyUsername(user: User, index: number): string {
  const fromEmail = user.email.split('@')[0] ?? '';
  const normalized = fromEmail.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || `user-${index + 1}`;
}

function inferWorkspaceHostname(platformHostname: string): string {
  const parts = platformHostname.split('.');
  if (parts.length >= 3) {
    return `code.${parts.slice(0, -2).join('.')}.${parts.slice(-2).join('.')}`;
  }
  return `code.${platformHostname}`;
}

export const defaultStore = createBackendStore();
