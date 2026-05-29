import type {
  ApiToken,
  AiChangeRequest,
  AuditEvent,
  AuthSession,
  GitLabIdentityLink,
  OAuthIdentity,
  Organization,
  OrganizationMembership,
  Project,
  ProjectEnvironmentSecret,
  ProjectMembership,
  Publish,
  PublishedFile,
  PublishedSite,
  PublishedVersion,
  UploadSession,
  User,
} from './models.ts';

export interface BackendStore {
  users: Map<string, User>;
  usersByEmail: Map<string, string>;
  passwordHashesByUserId: Map<string, string>;
  sessions: Map<string, AuthSession>;
  apiTokens: Map<string, ApiToken>;
  organizations: Map<string, Organization>;
  organizationMemberships: Map<string, OrganizationMembership>;
  projects: Map<string, Project>;
  projectEnvironmentSecrets: Map<string, ProjectEnvironmentSecret>;
  projectMemberships: Map<string, ProjectMembership>;
  oauthIdentities: Map<string, OAuthIdentity>;
  gitlabIdentityLinks: Map<string, GitLabIdentityLink>;
  auditEvents: AuditEvent[];
  aiChangeRequests: Map<string, AiChangeRequest>;
  publishes: Map<string, Publish>;
  publishedSites: Map<string, PublishedSite>;
  publishedVersions: Map<string, PublishedVersion>;
  publishedFiles: PublishedFile[];
  uploadSessions: Map<string, UploadSession>;
}

export interface BackendStoreSnapshot {
  users: User[];
  usersByEmail: Array<[string, string]>;
  passwordHashesByUserId: Array<[string, string]>;
  sessions: AuthSession[];
  apiTokens: ApiToken[];
  organizations: Organization[];
  organizationMemberships: OrganizationMembership[];
  projects: Project[];
  projectEnvironmentSecrets: ProjectEnvironmentSecret[];
  projectMemberships: ProjectMembership[];
  oauthIdentities: OAuthIdentity[];
  gitlabIdentityLinks: GitLabIdentityLink[];
  auditEvents: AuditEvent[];
  aiChangeRequests: AiChangeRequest[];
  publishes: Publish[];
  publishedSites: PublishedSite[];
  publishedVersions: PublishedVersion[];
  publishedFiles: PublishedFile[];
  uploadSessions: UploadSession[];
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
    sessions: new Map(),
    apiTokens: new Map(),
    organizations: new Map(),
    organizationMemberships: new Map(),
    projects: new Map(),
    projectEnvironmentSecrets: new Map(),
    projectMemberships: new Map(),
    oauthIdentities: new Map(),
    gitlabIdentityLinks: new Map(),
    auditEvents: [],
    aiChangeRequests: new Map(),
    publishes: new Map(),
    publishedSites: new Map(),
    publishedVersions: new Map(),
    publishedFiles: [],
    uploadSessions: new Map(),
  };
}

export function snapshotBackendStore(store: BackendStore): BackendStoreSnapshot {
  return {
    users: [...store.users.values()],
    usersByEmail: [...store.usersByEmail.entries()],
    passwordHashesByUserId: [...store.passwordHashesByUserId.entries()],
    sessions: [...store.sessions.values()],
    apiTokens: [...store.apiTokens.values()],
    organizations: [...store.organizations.values()],
    organizationMemberships: [...store.organizationMemberships.values()],
    projects: [...store.projects.values()],
    projectEnvironmentSecrets: [...store.projectEnvironmentSecrets.values()],
    projectMemberships: [...store.projectMemberships.values()],
    oauthIdentities: [...store.oauthIdentities.values()],
    gitlabIdentityLinks: [...store.gitlabIdentityLinks.values()],
    auditEvents: [...store.auditEvents],
    aiChangeRequests: [...store.aiChangeRequests.values()],
    publishes: [...store.publishes.values()],
    publishedSites: [...store.publishedSites.values()],
    publishedVersions: [...store.publishedVersions.values()],
    publishedFiles: [...store.publishedFiles],
    uploadSessions: [...store.uploadSessions.values()],
  };
}

export function hydrateBackendStore(snapshot: BackendStoreSnapshot, store: BackendStore = createBackendStore()): BackendStore {
  store.users = mapById(snapshot.users);
  store.usersByEmail = new Map(snapshot.usersByEmail);
  store.passwordHashesByUserId = new Map(snapshot.passwordHashesByUserId);
  store.sessions = new Map((snapshot.sessions ?? []).map((session) => [session.tokenHash, session]));
  store.apiTokens = mapById(snapshot.apiTokens);
  store.organizations = mapById(snapshot.organizations);
  store.organizationMemberships = mapById(snapshot.organizationMemberships);
  store.projects = mapById(snapshot.projects.map((project) => {
    const legacyProject = project as Project & { environmentVariables?: Array<{ key: string; value: string; protected: boolean; updatedAt: string }> };
    const { environmentVariables: _environmentVariables, ...safeProject } = legacyProject;
    return safeProject;
  }));
  store.projectEnvironmentSecrets = new Map((snapshot.projectEnvironmentSecrets ?? []).map((secret) => [`${secret.projectId}:${secret.key}`, secret]));
  store.projectMemberships = mapById(snapshot.projectMemberships);
  store.oauthIdentities = mapById(snapshot.oauthIdentities);
  store.gitlabIdentityLinks = mapById(snapshot.gitlabIdentityLinks);
  store.auditEvents = [...snapshot.auditEvents];
  store.aiChangeRequests = mapById(snapshot.aiChangeRequests);
  store.publishes = new Map(snapshot.publishes.map((publish) => [publish.slug, publish]));
  store.publishedSites = new Map(snapshot.publishedSites.map((site) => [site.slug, site]));
  store.publishedVersions = mapById(snapshot.publishedVersions);
  store.publishedFiles = [...snapshot.publishedFiles];
  store.uploadSessions = new Map(snapshot.uploadSessions.map((session) => [session.versionId, session]));
  return store;
}

function mapById<T extends { id: string }>(values: T[]): Map<string, T> {
  return new Map(values.map((value) => [value.id, value]));
}

export const defaultStore = createBackendStore();
