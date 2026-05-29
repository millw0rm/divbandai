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
  ProjectMembership,
  Publish,
  User,
} from './models';

export interface BackendStore {
  users: Map<string, User>;
  usersByEmail: Map<string, string>;
  passwordHashesByUserId: Map<string, string>;
  sessions: Map<string, AuthSession>;
  apiTokens: Map<string, ApiToken>;
  organizations: Map<string, Organization>;
  organizationMemberships: Map<string, OrganizationMembership>;
  projects: Map<string, Project>;
  projectMemberships: Map<string, ProjectMembership>;
  oauthIdentities: Map<string, OAuthIdentity>;
  gitlabIdentityLinks: Map<string, GitLabIdentityLink>;
  auditEvents: AuditEvent[];
  aiChangeRequests: Map<string, AiChangeRequest>;
  publishes: Map<string, Publish>;
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
    projectMemberships: new Map(),
    oauthIdentities: new Map(),
    gitlabIdentityLinks: new Map(),
    auditEvents: [],
    aiChangeRequests: new Map(),
    publishes: new Map(),
  };
}

export const defaultStore = createBackendStore();
