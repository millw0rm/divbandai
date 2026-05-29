import { can, assignableRoles, type ProjectPermission, type ProjectRole } from '@divband/auth';
import { createProjectLifecyclePlan, type ProjectStatus } from './project-lifecycle.ts';
import type {
  AbuseAction,
  AiChangeRequest,
  AiCiStatus,
  AiContextAttachment,
  AiPatchFile,
  AiPatchProposal,
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  ApiToken,
  AuthActor,
  AuthSession,
  Deployment,
  DeploymentState,
  EnvironmentVariable,
  GitLabIdentityLink,
  OAuthIdentity,
  Organization,
  OrganizationMembership,
  Project,
  ProjectDomain,
  PlatformAdmin,
  PlatformAdminRole,
  ProjectMembership,
  PublishRequest,
  User,
} from './models.ts';
import { defaultStore, type BackendStore } from './store.ts';
import { AuthService, type CreateApiTokenInput, type LinkGitLabIdentityInput, type LinkOAuthIdentityInput, type LoginInput, type RegisterInput } from './services/auth.ts';
import { AuditLogService } from './services/audit-log.ts';
import { CertificateStatusService } from './services/certificate-status.ts';
import { DeploymentStatusService, type DeploymentStatusReport } from './services/deployment-status.ts';
import { DnsVerificationService } from './services/dns-verification.ts';
import { GitLabService } from './services/gitlab.ts';
import { KubernetesService } from './services/kubernetes.ts';
import { PublishingService, type PublishingServiceOptions } from './services/publishing.ts';
import { ProjectSecretService } from './services/secrets.ts';
import { createId, normalizeSlug, nowIso } from './utils.ts';

interface RouteMatch {
  segments: string[];
  query: URLSearchParams;
}

interface CreateProjectBody {
  name?: unknown;
  slug?: unknown;
  organizationId?: unknown;
}

interface AuthorizedProject {
  project: Project;
  membership: ProjectMembership;
}

export class BackendService {
  private readonly auth: AuthService;
  private readonly audit: AuditLogService;
  private readonly certificates = new CertificateStatusService();
  private readonly deployments = new DeploymentStatusService();
  private readonly dns = new DnsVerificationService();
  private readonly gitlab = new GitLabService();
  private readonly kubernetes = new KubernetesService();
  private readonly publishing: PublishingService;
  private readonly secrets: ProjectSecretService;

  constructor(private readonly store: BackendStore = defaultStore, publishingOptions: PublishingServiceOptions = {}) {
    this.auth = new AuthService(store);
    this.audit = new AuditLogService(store);
    this.secrets = new ProjectSecretService(store);
    this.publishing = new PublishingService(store, publishingOptions);
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    try {
      const route = this.parsePath(request.path);
      const method = request.method.toUpperCase();

      if (method === 'POST' && this.matches(route, 'auth', 'register')) {
        const result = this.auth.register(this.registerInput(request.body));
        this.ensurePersonalOrganization(result.user);
        if (this.store.users.size === 1 && this.store.platformAdmins.size === 0) {
          this.grantPlatformAdmin(result.user.id, 'super_admin', result.user.id);
        }
        this.audit.record(result.user.id, 'user.registered', { email: result.user.email });
        return this.created(this.authResponse(result));
      }

      if (method === 'POST' && this.matches(route, 'auth', 'login')) {
        const result = this.auth.login(this.loginInput(request.body));
        this.audit.record(result.user.id, 'user.logged_in', { email: result.user.email });
        return this.ok(this.authResponse(result));
      }

      if (method === 'POST' && this.matches(route, 'auth', 'logout')) {
        const actor = this.auth.authenticate(request.headers?.authorization ?? request.headers?.Authorization);
        const session = this.auth.revokeCurrentSession(actor);
        this.audit.record(actor.user.id, 'user.session_revoked', { sessionId: session.id });
        return this.ok({ session: this.redactSession(session) });
      }

      if (method === 'DELETE' && route.segments[0] === 'auth' && route.segments[1] === 'sessions' && route.segments[2]) {
        const actor = this.auth.authenticate(request.headers?.authorization ?? request.headers?.Authorization);
        const session = this.auth.revokeSession(actor.user.id, route.segments[2]);
        this.audit.record(actor.user.id, 'user.session_revoked', { sessionId: session.id });
        return this.ok({ session: this.redactSession(session) });
      }

      if (method === 'POST' && this.matches(route, 'auth', 'sessions', 'cleanup')) {
        const actor = this.auth.authenticate(request.headers?.authorization ?? request.headers?.Authorization);
        const deleted = this.auth.cleanupExpiredSessions();
        this.audit.record(actor.user.id, 'user.sessions_cleaned', { deleted });
        return this.ok({ deleted });
      }

      if (this.isPublishingRoute(route)) {
        const actor = this.authenticateOptional(request);
        const publishSlug = route.segments[3];

        if (method === 'POST' && this.matches(route, 'api', 'v1', 'publish')) {
          const response = await this.publishing.create(this.requiredObject(request.body) as unknown as PublishRequest, actor);
          if (actor) {
            this.audit.record(actor.user.id, 'publish.created', { slug: response.slug });
          }
          return this.created(response, 202);
        }

        if (method === 'GET' && publishSlug && this.matches(route, 'api', 'v1', 'publish', publishSlug)) {
          return this.ok({ publish: this.publishing.get(publishSlug) });
        }

        if (method === 'PUT' && publishSlug && this.matches(route, 'api', 'v1', 'publish', publishSlug)) {
          const response = await this.publishing.update(publishSlug, this.requiredObject(request.body) as unknown as PublishRequest & { claimToken?: unknown }, actor);
          if (actor) {
            this.audit.record(actor.user.id, 'publish.updated', { slug: response.slug, versionId: response.upload.versionId });
          }
          return this.ok(response);
        }

        if (method === 'DELETE' && publishSlug && this.matches(route, 'api', 'v1', 'publish', publishSlug)) {
          const publish = await this.publishing.delete(publishSlug, actor, this.optionalObject(request.body).claimToken);
          if (actor) {
            this.audit.record(actor.user.id, 'publish.deleted', { slug: publish.slug });
          }
          return this.ok({ publish });
        }

        if (method === 'POST' && publishSlug && this.matches(route, 'api', 'v1', 'publish', publishSlug, 'finalize')) {
          const publish = await this.publishing.finalize(publishSlug, this.requiredObject(request.body).versionId);
          if (actor) {
            this.audit.record(actor.user.id, 'publish.finalized', { slug: publish.slug, versionId: publish.liveVersionId ?? '' });
          }
          return this.ok({ publish });
        }

        if (method === 'POST' && publishSlug && this.matches(route, 'api', 'v1', 'publish', publishSlug, 'claim')) {
          if (!actor) {
            throw new Error('Authentication is required.');
          }
          const publish = await this.publishing.claim(publishSlug, this.requiredObject(request.body).claimToken, actor);
          this.audit.record(actor.user.id, 'publish.claimed', { slug: publish.slug });
          return this.ok({ publish });
        }
      }

      const actor = this.auth.authenticate(request.headers?.authorization ?? request.headers?.Authorization);
      const user = actor.user;

      if (route.segments[0] === 'admin') {
        return this.handleAdminRoute(method, route, actor, request.body);
      }

      if (method === 'GET' && this.matches(route, 'api', 'v1', 'publishes')) {
        return this.ok({ publishes: this.publishing.list(actor) });
      }

      if (method === 'POST' && this.matches(route, 'auth', 'oauth-identities')) {
        const identity = this.auth.linkOAuthIdentity(user.id, this.oauthIdentityInput(request.body));
        this.audit.record(user.id, 'user.oauth_identity_linked', { provider: identity.provider, issuer: identity.issuer });
        return this.created({ identity });
      }

      if (method === 'POST' && this.matches(route, 'auth', 'gitlab-identity')) {
        const gitlabIdentity = this.auth.linkGitLabIdentity(user.id, this.gitLabIdentityInput(request.body));
        this.audit.record(user.id, 'user.gitlab_identity_linked', { username: gitlabIdentity.username });
        return this.created({ gitlabIdentity: this.redactGitLabIdentity(gitlabIdentity) });
      }

      if (method === 'GET' && this.matches(route, 'organizations')) {
        return this.ok({ organizations: this.listOrganizations(user) });
      }

      if (method === 'POST' && this.matches(route, 'organizations')) {
        return this.created({ organization: this.createOrganization(user, this.requiredObject(request.body)) });
      }

      if (method === 'GET' && this.matches(route, 'projects')) {
        return this.ok({ projects: this.listProjects(actor) });
      }

      if (method === 'POST' && this.matches(route, 'projects')) {
        return this.created({ project: this.createProject(user, this.requiredObject(request.body) as CreateProjectBody) }, 202);
      }

      const projectId = route.segments[1];
      if (route.segments[0] === 'projects' && projectId) {
        if (method === 'GET' && route.segments.length === 2) {
          const { project, membership } = this.requireProject(projectId, actor, 'project:read');
          return this.ok({ project, membership });
        }

        if (method === 'DELETE' && route.segments.length === 2) {
          const { project } = this.requireProject(projectId, actor, 'project:archive');
          return this.ok({ project: this.archiveProject(project, user) });
        }

        if (method === 'GET' && this.matches(route, 'projects', projectId, 'status')) {
          const { project } = this.requireProject(projectId, actor, 'project:read');
          return this.ok({
            status: project.status,
            repositoryUrl: project.repositoryUrl,
            namespaceProvisioned: project.namespaceProvisioned,
            platformSubdomainAttached: project.platformSubdomainAttached,
            activeDomains: project.domains.filter((domain) => domain.verified).map((domain) => domain.hostname),
            latestDeployment: project.deployments.at(-1),
          });
        }

        if (method === 'GET' && this.matches(route, 'projects', projectId, 'members')) {
          const { project } = this.requireProject(projectId, actor, 'project:read');
          return this.ok({ members: this.listProjectMembers(project) });
        }

        if (method === 'PUT' && this.matches(route, 'projects', projectId, 'members')) {
          const authorized = this.requireProject(projectId, actor, 'member:manage');
          return this.ok({ member: this.upsertProjectMember(authorized, user, this.requiredObject(request.body)) });
        }

        if (method === 'POST' && this.matches(route, 'projects', projectId, 'api-tokens')) {
          const authorized = this.requireProject(projectId, actor, 'token:manage');
          const result = this.createProjectApiToken(authorized, user, this.requiredObject(request.body));
          return this.created({ apiToken: this.redactApiToken(result.apiToken), token: result.token });
        }

        if (method === 'POST' && this.matches(route, 'projects', projectId, 'gitlab-repository')) {
          const { project } = this.requireProject(projectId, actor, 'project:provision_gitlab');
          this.requireGitLabIdentity(user);
          return this.ok({ repository: await this.createGitLabRepository(project, user), project });
        }

        if (method === 'POST' && this.matches(route, 'projects', projectId, 'kubernetes-namespace')) {
          const { project } = this.requireProject(projectId, actor, 'project:provision_kubernetes');
          return this.ok({ namespace: await this.provisionKubernetesNamespace(project, user), project });
        }

        if (method === 'POST' && this.matches(route, 'projects', projectId, 'platform-subdomain')) {
          const { project } = this.requireProject(projectId, actor, 'domain:manage');
          return this.ok({ hostname: this.attachPlatformSubdomain(project, user), project });
        }

        if (method === 'POST' && this.matches(route, 'projects', projectId, 'domains')) {
          const { project } = this.requireProject(projectId, actor, 'domain:manage');
          return this.created({ domain: this.addCustomDomain(project, user, this.requiredObject(request.body)) }, 202);
        }

        if (method === 'POST' && route.segments[2] === 'domains' && route.segments[3] && route.segments[4] === 'verify') {
          const { project } = this.requireProject(projectId, actor, 'domain:manage');
          return this.ok({ domain: await this.verifyCustomDomain(project, user, route.segments[3], this.optionalObject(request.body)) });
        }

        if (method === 'POST' && this.matches(route, 'projects', projectId, 'deployments')) {
          const { project } = this.requireProject(projectId, actor, 'deployment:trigger');
          return this.created({ deployment: this.triggerDeployment(project, user, this.optionalObject(request.body)), project }, 202);
        }

        if (method === 'POST' && this.matches(route, 'projects', projectId, 'deployments', 'report')) {
          const { project } = this.requireProject(projectId, actor, 'deployment:trigger');
          return this.ok({ deployment: this.reportDeploymentStatus(project, user, this.requiredObject(request.body)), project });
        }

        if (method === 'PUT' && route.segments[2] === 'deployments' && route.segments[3] && route.segments[4] === 'status') {
          const { project } = this.requireProject(projectId, actor, 'deployment:trigger');
          const body = this.requiredObject(request.body);
          return this.ok({ deployment: this.reportDeploymentStatus(project, user, { ...body, deploymentId: route.segments[3] }), project });
        }

        if (method === 'POST' && route.segments[2] === 'deployments' && route.segments[3] && route.segments[4] === 'rollback') {
          const { project } = this.requireProject(projectId, actor, 'deployment:trigger');
          return this.created({ deployment: this.rollbackDeployment(project, user, route.segments[3]), project }, 202);
        }

        if (method === 'GET' && route.segments[2] === 'deployments' && route.segments[3]) {
          const { project } = this.requireProject(projectId, actor, 'project:read');
          return this.ok({ deployment: this.requireDeployment(project, route.segments[3]) });
        }

        if (method === 'GET' && this.matches(route, 'projects', projectId, 'logs')) {
          const { project } = this.requireProject(projectId, actor, 'project:read');
          return this.ok({ deployments: project.deployments.map(({ id, state, logs }) => ({ id, state, logs })) });
        }


        if (method === 'POST' && this.matches(route, 'projects', projectId, 'ai', 'change-requests')) {
          const { project } = this.requireProject(projectId, actor, 'ai:request_change');
          return this.created({ changeRequest: this.createAiChangeRequest(project, user, this.requiredObject(request.body)) }, 202);
        }

        if (method === 'GET' && this.matches(route, 'projects', projectId, 'ai', 'change-requests')) {
          const { project } = this.requireProject(projectId, actor, 'project:read');
          return this.ok({ changeRequests: this.listAiChangeRequests(project) });
        }

        if (route.segments[2] === 'ai' && route.segments[3] === 'change-requests' && route.segments[4]) {
          const changeRequestId = route.segments[4];
          const { project } = this.requireProject(projectId, actor, 'ai:request_change');

          if (method === 'GET' && route.segments.length === 5) {
            return this.ok({ changeRequest: this.requireAiChangeRequest(project, changeRequestId) });
          }

          if (method === 'POST' && route.segments[5] === 'context') {
            return this.ok({ changeRequest: this.attachAiProjectContext(project, user, changeRequestId, this.requiredObject(request.body)) });
          }

          if (method === 'POST' && route.segments[5] === 'patch') {
            return this.ok({ changeRequest: this.generateAiPatch(project, user, changeRequestId, this.optionalObject(request.body)) });
          }

          if (method === 'POST' && route.segments[5] === 'branch') {
            return this.created({ changeRequest: await this.createAiGitLabBranch(project, user, changeRequestId, this.requiredObject(request.body)) }, 202);
          }

          if (method === 'POST' && route.segments[5] === 'merge-request') {
            return this.created({ changeRequest: await this.openAiGitLabMergeRequest(project, user, changeRequestId) }, 202);
          }

          if (method === 'POST' && route.segments[5] === 'ci') {
            return this.created({ changeRequest: await this.triggerAiCi(project, user, changeRequestId) }, 202);
          }

          if (method === 'PUT' && route.segments[5] === 'status') {
            return this.ok({ changeRequest: this.reportAiBuildDeployStatus(project, user, changeRequestId, this.requiredObject(request.body)) });
          }
        }

        if (method === 'GET' && this.matches(route, 'projects', projectId, 'environment-variables')) {
          const { project } = this.requireProject(projectId, actor, 'secret:read');
          return this.ok({ environmentVariables: this.secrets.list(project) });
        }

        if (method === 'PUT' && this.matches(route, 'projects', projectId, 'environment-variables')) {
          const { project } = this.requireProject(projectId, actor, 'secret:manage');
          return this.ok({ environmentVariables: this.upsertEnvironmentVariables(project, user, this.requiredObject(request.body)) });
        }

        if (method === 'GET' && route.segments[2] === 'environment-variables' && route.segments[3] && route.segments[4] === 'value') {
          const { project } = this.requireProject(projectId, actor, 'secret:read');
          return this.ok({ environmentVariable: this.readEnvironmentVariable(project, user, route.segments[3], request) });
        }

        if (method === 'DELETE' && route.segments[2] === 'environment-variables' && route.segments[3]) {
          const { project } = this.requireProject(projectId, actor, 'secret:manage');
          return this.ok({ environmentVariables: this.deleteEnvironmentVariable(project, user, route.segments[3]) });
        }
      }

      return this.error(404, 'not_found', 'Endpoint not found.');
    } catch (error) {
      return this.error(400, 'bad_request', error instanceof Error ? error.message : 'Request failed.');
    }
  }


  private handleAdminRoute(method: string, route: RouteMatch, actor: AuthActor, body: unknown): ApiResponse {
    this.requirePlatformAdmin(actor);
    const resource = route.segments[1];
    this.audit.record(actor.user.id, 'platform_admin.route_accessed', { method, path: `/${route.segments.join('/')}` });

    if (method === 'GET' && resource === 'users') {
      return this.ok({ users: this.searchUsers(route.query.get('q') ?? undefined) });
    }

    if (method === 'GET' && resource === 'organizations') {
      return this.ok({ organizations: this.searchOrganizations(route.query.get('q') ?? undefined) });
    }

    if (method === 'GET' && resource === 'projects') {
      return this.ok({ projects: this.platformProjectOverview() });
    }

    if (method === 'GET' && resource === 'domains') {
      return this.ok({ domains: this.platformDomainStatus() });
    }

    if (method === 'GET' && resource === 'runners' && route.segments[2] === 'health') {
      return this.ok({ runners: this.runnerHealth() });
    }

    if (method === 'GET' && resource === 'deployments' && route.segments[2] === 'failures') {
      return this.ok({ deployments: this.failedDeployments() });
    }

    if (method === 'GET' && resource === 'audit-events') {
      return this.ok({ auditEvents: this.store.auditEvents.slice(-200).reverse() });
    }

    if (method === 'GET' && resource === 'abuse-actions') {
      return this.ok({ abuseActions: [...this.store.abuseActions.values()].reverse() });
    }

    if (method === 'POST' && resource === 'abuse-actions') {
      return this.created({ abuseAction: this.createAbuseAction(actor.user, this.requiredObject(body)) });
    }

    if (method === 'GET' && resource === 'platform-admins') {
      return this.ok({ platformAdmins: [...this.store.platformAdmins.values()].filter((admin) => !admin.revokedAt) });
    }

    if (method === 'POST' && resource === 'platform-admins') {
      const input = this.requiredObject(body);
      const userId = typeof input.userId === 'string' ? input.userId : '';
      const role = typeof input.role === 'string' && this.isPlatformAdminRole(input.role) ? input.role : 'support';
      return this.created({ platformAdmin: this.grantPlatformAdmin(userId, role, actor.user.id) });
    }

    if (method === 'DELETE' && resource === 'platform-admins' && route.segments[2]) {
      return this.ok({ platformAdmin: this.revokePlatformAdmin(route.segments[2], actor.user.id) });
    }

    return this.error(404, 'not_found', 'Admin endpoint not found.');
  }

  private requirePlatformAdmin(actor: AuthActor): void {
    if (!actor.platformAdmin || actor.platformAdmin.revokedAt) {
      throw new Error('Platform administrator privileges are required.');
    }
  }

  private grantPlatformAdmin(userId: string, role: PlatformAdminRole, grantedBy: string): PlatformAdmin {
    if (!this.store.users.has(userId)) {
      throw new Error('User not found.');
    }
    const existing = [...this.store.platformAdmins.values()].find((admin) => admin.userId === userId && !admin.revokedAt);
    if (existing) {
      existing.role = role;
      this.audit.record(grantedBy, 'platform_admin.updated', { userId, role });
      return existing;
    }
    const platformAdmin: PlatformAdmin = { id: createId('platform_admin'), userId, role, grantedBy, grantedAt: nowIso() };
    this.store.platformAdmins.set(platformAdmin.id, platformAdmin);
    this.audit.record(grantedBy, 'platform_admin.granted', { userId, role });
    return platformAdmin;
  }

  private revokePlatformAdmin(adminId: string, revokedBy: string): PlatformAdmin {
    const platformAdmin = this.store.platformAdmins.get(adminId);
    if (!platformAdmin || platformAdmin.revokedAt) {
      throw new Error('Platform admin not found.');
    }
    platformAdmin.revokedAt = nowIso();
    this.audit.record(revokedBy, 'platform_admin.revoked', { userId: platformAdmin.userId, adminId });
    return platformAdmin;
  }

  private searchUsers(query?: string): Array<User & { platformAdminRole?: PlatformAdminRole }> {
    const normalized = query?.trim().toLowerCase();
    return [...this.store.users.values()]
      .filter((user) => !normalized || user.email.toLowerCase().includes(normalized) || user.name.toLowerCase().includes(normalized) || user.id === normalized)
      .map((user) => ({ ...user, platformAdminRole: this.auth.platformAdminForUser(user.id)?.role }));
  }

  private searchOrganizations(query?: string): Organization[] {
    const normalized = query?.trim().toLowerCase();
    return [...this.store.organizations.values()].filter((organization) => !normalized || organization.name.toLowerCase().includes(normalized) || organization.slug.includes(normalized) || organization.id === normalized);
  }

  private platformProjectOverview(): Array<Project & { organization?: Organization; memberCount: number; failedDeploymentCount: number }> {
    return [...this.store.projects.values()].map((project) => ({
      ...project,
      organization: this.store.organizations.get(project.organizationId),
      memberCount: [...this.store.projectMemberships.values()].filter((membership) => membership.projectId === project.id).length,
      failedDeploymentCount: project.deployments.filter((deployment) => deployment.state === 'failed').length,
    }));
  }

  private platformDomainStatus(): Array<ProjectDomain & { projectId: string; projectSlug: string; organizationId: string }> {
    return [...this.store.projects.values()].flatMap((project) => project.domains.map((domain) => ({ ...domain, projectId: project.id, projectSlug: project.slug, organizationId: project.organizationId })));
  }

  private runnerHealth(): Array<{ projectId: string; projectSlug: string; runnerTag: string; status: 'idle' | 'active' | 'degraded'; latestDeploymentState?: DeploymentState; checkedAt: string }> {
    return [...this.store.projects.values()].map((project) => {
      const latestDeployment = project.deployments.at(-1);
      const active = latestDeployment?.state === 'queued' || latestDeployment?.state === 'running';
      const degraded = latestDeployment?.state === 'failed' || project.status === 'failed';
      return {
        projectId: project.id,
        projectSlug: project.slug,
        runnerTag: project.runnerTag,
        status: degraded ? 'degraded' : active ? 'active' : 'idle',
        latestDeploymentState: latestDeployment?.state,
        checkedAt: nowIso(),
      };
    });
  }

  private failedDeployments(): Array<Deployment & { projectSlug: string; organizationId: string }> {
    return [...this.store.projects.values()].flatMap((project) => project.deployments
      .filter((deployment) => deployment.state === 'failed')
      .map((deployment) => ({ ...deployment, projectSlug: project.slug, organizationId: project.organizationId })));
  }

  private createAbuseAction(actor: User, body: Record<string, unknown>): AbuseAction {
    const targetType = typeof body.targetType === 'string' ? body.targetType : '';
    const targetId = typeof body.targetId === 'string' ? body.targetId : '';
    const action = typeof body.action === 'string' ? body.action : '';
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'No reason provided.';
    if (!this.isAbuseTargetType(targetType) || !this.isAbuseAction(action) || !targetId) {
      throw new Error('Abuse action requires targetType, targetId, and a valid action.');
    }
    const abuseAction: AbuseAction = { id: createId('abuse_action'), targetType, targetId, action, reason, createdBy: actor.id, createdAt: nowIso() };
    this.store.abuseActions.set(abuseAction.id, abuseAction);
    this.applyAbuseAction(abuseAction);
    this.audit.record(actor.id, 'platform_admin.abuse_action_created', { targetType, targetId, action, reason });
    return abuseAction;
  }

  private applyAbuseAction(abuseAction: AbuseAction): void {
    if (abuseAction.action !== 'suspend' && abuseAction.action !== 'unsuspend') {
      return;
    }
    const suspendedAt = abuseAction.action === 'suspend' ? abuseAction.createdAt : undefined;
    const suspensionReason = abuseAction.action === 'suspend' ? abuseAction.reason : undefined;
    if (abuseAction.targetType === 'user') {
      const user = this.store.users.get(abuseAction.targetId);
      if (user) {
        user.suspendedAt = suspendedAt;
        user.suspensionReason = suspensionReason;
      }
    }
    if (abuseAction.targetType === 'organization') {
      const organization = this.store.organizations.get(abuseAction.targetId);
      if (organization) {
        organization.suspendedAt = suspendedAt;
        organization.suspensionReason = suspensionReason;
      }
    }
    if (abuseAction.targetType === 'project') {
      const project = this.store.projects.get(abuseAction.targetId);
      if (project) {
        project.suspendedAt = suspendedAt;
        project.suspensionReason = suspensionReason;
      }
    }
  }

  private isPlatformAdminRole(role: string): role is PlatformAdminRole {
    return role === 'support' || role === 'security' || role === 'super_admin';
  }

  private isAbuseTargetType(targetType: string): targetType is AbuseAction['targetType'] {
    return targetType === 'user' || targetType === 'organization' || targetType === 'project' || targetType === 'domain';
  }

  private isAbuseAction(action: string): action is AbuseAction['action'] {
    return action === 'warn' || action === 'suspend' || action === 'unsuspend' || action === 'restrict_deployments';
  }

  private createProject(user: User, body: CreateProjectBody): Project {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled project';
    const slugSource = typeof body.slug === 'string' ? body.slug : name;
    const slug = normalizeSlug(slugSource);
    if (!slug) {
      throw new Error('Project slug is required.');
    }

    const organization = typeof body.organizationId === 'string' ? this.requireOrganizationForUser(body.organizationId, user) : this.ensurePersonalOrganization(user).organization;
    const plan = createProjectLifecyclePlan(slug, `${organization.slug}/${user.id}`);
    const timestamp = nowIso();
    const project: Project = {
      id: createId('project'),
      organizationId: organization.id,
      ownerId: user.id,
      name,
      slug: plan.slug,
      status: 'draft',
      gitlabPath: plan.gitlabPath,
      namespace: plan.namespace,
      platformHostname: plan.platformHostname,
      runnerTag: plan.runnerTag,
      namespaceProvisioned: false,
      platformSubdomainAttached: false,
      domains: [],
      deployments: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.store.projects.set(project.id, project);
    const membershipId = createId('project_member');
    this.store.projectMemberships.set(membershipId, {
      id: membershipId,
      projectId: project.id,
      userId: user.id,
      role: 'owner',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.audit.record(user.id, 'project.created', { slug: project.slug, organizationId: organization.id }, project.id);
    return project;
  }

  private listProjects(actor: AuthActor): Project[] {
    const visibleProjectIds = new Set(
      [...this.store.projectMemberships.values()]
        .filter((membership) => membership.userId === actor.user.id)
        .map((membership) => membership.projectId),
    );
    if (actor.apiToken?.projectId) {
      visibleProjectIds.forEach((projectId) => {
        if (projectId !== actor.apiToken?.projectId) {
          visibleProjectIds.delete(projectId);
        }
      });
    }

    return [...this.store.projects.values()].filter((project) => visibleProjectIds.has(project.id) && project.status !== 'archived');
  }

  private async createGitLabRepository(project: Project, user: User): Promise<unknown> {
    const repository = await this.gitlab.createRepository(project, this.secrets.list(project, { reveal: true }));
    await this.gitlab.configureRunnerTag(project);
    project.repositoryUrl = repository.webUrl;
    this.touch(project, 'repository_provisioned');
    this.audit.record(user.id, 'project.gitlab_repository_created', { path: repository.path }, project.id);
    return repository;
  }

  private async provisionKubernetesNamespace(project: Project, user: User): Promise<unknown> {
    const namespace = await this.kubernetes.provisionNamespace(project);
    project.namespaceProvisioned = true;
    this.touch(project, 'namespace_provisioned');
    this.audit.record(user.id, 'project.kubernetes_namespace_provisioned', { namespace: namespace.name }, project.id);
    return namespace;
  }

  private attachPlatformSubdomain(project: Project, user: User): string {
    project.platformSubdomainAttached = true;
    this.touch(project);
    this.audit.record(user.id, 'project.platform_subdomain_attached', { hostname: project.platformHostname }, project.id);
    return project.platformHostname;
  }

  private addCustomDomain(project: Project, user: User, body: Record<string, unknown>): ProjectDomain {
    const hostname = typeof body.hostname === 'string' ? body.hostname.trim().toLowerCase() : '';
    if (!hostname || !hostname.includes('.')) {
      throw new Error('A valid hostname is required.');
    }

    const challenge = this.dns.createChallenge(hostname);
    const domain: ProjectDomain = {
      id: createId('domain'),
      hostname,
      verificationToken: challenge.token,
      verificationRecord: `${challenge.recordName} ${challenge.recordType} ${challenge.recordValue}`,
      verified: false,
      certificateStatus: 'not_requested',
      createdAt: nowIso(),
    };

    project.domains.push(domain);
    this.touch(project, 'domain_pending_verification');
    this.audit.record(user.id, 'project.custom_domain_added', { hostname }, project.id);
    return domain;
  }

  private async verifyCustomDomain(project: Project, user: User, domainId: string, body: Record<string, unknown>): Promise<ProjectDomain> {
    const domain = this.requireDomain(project, domainId);
    const observedToken = typeof body.observedToken === 'string' ? body.observedToken : undefined;
    const verified = await this.dns.verify(domain.hostname, domain.verificationToken, observedToken);
    if (!verified) {
      throw new Error('DNS verification failed.');
    }

    const updatedDomain = this.certificates.markRequested({ ...domain, verified: true, verifiedAt: nowIso() });
    Object.assign(domain, updatedDomain);
    this.touch(project, 'domain_active');
    this.audit.record(user.id, 'project.custom_domain_verified', { hostname: domain.hostname }, project.id);
    return domain;
  }

  private triggerDeployment(project: Project, user: User, body: Record<string, unknown>): Deployment {
    const gitRef = typeof body.gitRef === 'string' ? body.gitRef : 'main';
    const commitSha = typeof body.commitSha === 'string' ? body.commitSha : undefined;
    const deployment = this.deployments.trigger(project, gitRef, commitSha);
    project.deployments.push(deployment);
    this.touch(project, 'building');
    this.audit.record(user.id, 'project.deployment_triggered', { deploymentId: deployment.id, gitRef }, project.id);
    return deployment;
  }

  private reportDeploymentStatus(project: Project, user: User, body: Record<string, unknown>): Deployment {
    const state = typeof body.state === 'string' ? body.state : '';
    if (!this.isDeploymentState(state)) {
      throw new Error('Deployment report requires a valid state.');
    }

    const deployment = this.deployments.report(project, {
      deploymentId: typeof body.deploymentId === 'string' ? body.deploymentId : undefined,
      state,
      gitRef: typeof body.gitRef === 'string' ? body.gitRef : undefined,
      commitSha: typeof body.commitSha === 'string' ? body.commitSha : undefined,
      environment: this.deploymentEnvironment(body.environment),
      image: typeof body.image === 'string' ? body.image : undefined,
      imageDigest: typeof body.imageDigest === 'string' ? body.imageDigest : undefined,
      pipelineId: typeof body.pipelineId === 'string' ? body.pipelineId : undefined,
      jobUrl: typeof body.jobUrl === 'string' ? body.jobUrl : undefined,
      ingressHostname: typeof body.ingressHostname === 'string' ? body.ingressHostname : undefined,
      healthCheckUrl: typeof body.healthCheckUrl === 'string' ? body.healthCheckUrl : undefined,
      logLine: typeof body.logLine === 'string' ? body.logLine : undefined,
    } satisfies DeploymentStatusReport);
    this.touch(project, state === 'succeeded' ? 'deployed' : state === 'failed' ? 'failed' : 'building');
    this.audit.record(user.id, 'project.deployment_status_reported', { deploymentId: deployment.id, state }, project.id);
    return deployment;
  }

  private rollbackDeployment(project: Project, user: User, deploymentId: string): Deployment {
    const deployment = this.requireDeployment(project, deploymentId);
    const rollback = this.deployments.rollback(project, deployment);
    project.deployments.push(rollback);
    this.touch(project, 'building');
    this.audit.record(user.id, 'project.deployment_rollback_triggered', { deploymentId, rollbackDeploymentId: rollback.id }, project.id);
    return rollback;
  }


  private createAiChangeRequest(project: Project, user: User, body: Record<string, unknown>): AiChangeRequest {
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      throw new Error('AI change request prompt is required.');
    }

    const targetBranch = typeof body.targetBranch === 'string' && body.targetBranch.trim() ? body.targetBranch.trim() : 'main';
    const timestamp = nowIso();
    const changeRequest: AiChangeRequest = {
      id: createId('ai_change'),
      projectId: project.id,
      requesterId: user.id,
      prompt: this.redactSecrets(prompt),
      status: 'requested',
      targetBranch,
      context: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.store.aiChangeRequests.set(changeRequest.id, changeRequest);
    this.audit.record(user.id, 'ai.change_request_created', { changeRequestId: changeRequest.id, targetBranch }, project.id);
    return changeRequest;
  }

  private listAiChangeRequests(project: Project): AiChangeRequest[] {
    return [...this.store.aiChangeRequests.values()].filter((request) => request.projectId === project.id);
  }

  private attachAiProjectContext(project: Project, user: User, changeRequestId: string, body: Record<string, unknown>): AiChangeRequest {
    const changeRequest = this.requireAiChangeRequest(project, changeRequestId);
    const requestedFiles = Array.isArray(body.files) ? body.files.filter((file): file is string => typeof file === 'string') : [];
    const files = requestedFiles.map((file) => this.projectScopedPath(project, file));
    const attachment: AiContextAttachment = {
      id: createId('ai_context'),
      summary: this.redactSecrets(typeof body.summary === 'string' ? body.summary : `Context for ${project.slug}`),
      files,
      redactedSecrets: this.redactedSecretNames(project),
      createdAt: nowIso(),
    };

    changeRequest.context.push(attachment);
    this.touchAiChangeRequest(changeRequest, 'context_attached');
    this.audit.record(user.id, 'ai.context_attached', { changeRequestId, files: files.length, redactedSecrets: attachment.redactedSecrets.length }, project.id);
    return changeRequest;
  }

  private generateAiPatch(project: Project, user: User, changeRequestId: string, body: Record<string, unknown>): AiChangeRequest {
    const changeRequest = this.requireAiChangeRequest(project, changeRequestId);
    if (changeRequest.context.length === 0) {
      throw new Error('Attach project context before generating a patch.');
    }

    const rawFiles = Array.isArray(body.files) ? body.files : [];
    const files = rawFiles.length ? rawFiles.map((file) => this.aiPatchFileFromInput(project, file)) : [
      {
        path: this.projectScopedPath(project, 'README.md'),
        action: 'update' as const,
        diff: `AI proposal for: ${changeRequest.prompt}`,
      },
    ];
    const patch: AiPatchProposal = {
      id: createId('ai_patch'),
      summary: this.redactSecrets(typeof body.summary === 'string' ? body.summary : `Proposed changes for: ${changeRequest.prompt}`),
      files,
      createdAt: nowIso(),
      requiresConfirmation: true,
    };

    changeRequest.patch = patch;
    this.touchAiChangeRequest(changeRequest, 'awaiting_confirmation');
    this.audit.record(user.id, 'ai.patch_generated', { changeRequestId, files: files.length, requiresConfirmation: true }, project.id);
    return changeRequest;
  }

  private async createAiGitLabBranch(project: Project, user: User, changeRequestId: string, body: Record<string, unknown>): Promise<AiChangeRequest> {
    const changeRequest = this.requireAiChangeRequest(project, changeRequestId);
    if (!changeRequest.patch) {
      throw new Error('Generate a patch before creating a branch.');
    }
    if (body.confirmApply !== true) {
      throw new Error('User confirmation is required before applying generated changes.');
    }

    changeRequest.patch.confirmedAt = nowIso();
    changeRequest.patch.confirmedBy = user.id;
    const branch = await this.gitlab.createBranch(project, changeRequest, changeRequest.patch);
    changeRequest.branch = { ...branch, createdAt: nowIso() };
    this.touchAiChangeRequest(changeRequest, 'branch_created');
    this.audit.record(user.id, 'ai.branch_created', { changeRequestId, branch: branch.name, commitSha: branch.commitSha }, project.id);
    return changeRequest;
  }

  private async openAiGitLabMergeRequest(project: Project, user: User, changeRequestId: string): Promise<AiChangeRequest> {
    const changeRequest = this.requireAiChangeRequest(project, changeRequestId);
    if (!changeRequest.branch) {
      throw new Error('Create a GitLab branch before opening a merge request.');
    }

    const mergeRequest = await this.gitlab.openMergeRequest(project, changeRequest);
    changeRequest.mergeRequest = { ...mergeRequest, createdAt: nowIso() };
    this.touchAiChangeRequest(changeRequest, 'merge_request_opened');
    this.audit.record(user.id, 'ai.merge_request_opened', { changeRequestId, mergeRequest: mergeRequest.webUrl }, project.id);
    return changeRequest;
  }

  private async triggerAiCi(project: Project, user: User, changeRequestId: string): Promise<AiChangeRequest> {
    const changeRequest = this.requireAiChangeRequest(project, changeRequestId);
    if (!changeRequest.mergeRequest) {
      throw new Error('Open a merge request before triggering CI.');
    }

    const pipeline = await this.gitlab.triggerPipeline(project, changeRequest.branch?.name ?? changeRequest.mergeRequest.sourceBranch);
    changeRequest.ciStatus = { ...pipeline, deploymentReady: false, updatedAt: nowIso() };
    this.touchAiChangeRequest(changeRequest, 'ci_running');
    this.audit.record(user.id, 'ai.ci_triggered', { changeRequestId, pipelineId: pipeline.pipelineId }, project.id);
    return changeRequest;
  }

  private reportAiBuildDeployStatus(project: Project, user: User, changeRequestId: string, body: Record<string, unknown>): AiChangeRequest {
    const changeRequest = this.requireAiChangeRequest(project, changeRequestId);
    if (!changeRequest.ciStatus) {
      throw new Error('Trigger CI before reporting build or deploy readiness.');
    }

    const status = typeof body.status === 'string' ? body.status : changeRequest.ciStatus.status;
    if (!this.isAiCiState(status)) {
      throw new Error('Invalid CI status.');
    }

    const deploymentReady = status === 'success' && body.deploymentReady === true;
    const ciStatus: AiCiStatus = {
      pipelineId: typeof body.pipelineId === 'string' ? body.pipelineId : changeRequest.ciStatus?.pipelineId ?? createId('pipeline'),
      status,
      webUrl: typeof body.webUrl === 'string' ? body.webUrl : changeRequest.ciStatus?.webUrl ?? '',
      deploymentReady,
      updatedAt: nowIso(),
    };
    changeRequest.ciStatus = ciStatus;
    this.touchAiChangeRequest(changeRequest, status === 'success' ? (deploymentReady ? 'deploy_ready' : 'ci_succeeded') : status === 'failed' ? 'ci_failed' : 'ci_running');
    this.audit.record(user.id, 'ai.status_reported', { changeRequestId, status, deploymentReady }, project.id);
    return changeRequest;
  }

  private requireAiChangeRequest(project: Project, changeRequestId: string): AiChangeRequest {
    const changeRequest = this.store.aiChangeRequests.get(changeRequestId);
    if (!changeRequest || changeRequest.projectId !== project.id) {
      throw new Error('AI change request not found.');
    }
    return changeRequest;
  }

  private aiPatchFileFromInput(project: Project, input: unknown): AiPatchFile {
    if (!this.isRecord(input) || typeof input.path !== 'string' || typeof input.diff !== 'string') {
      throw new Error('Each patch file requires path and diff.');
    }
    const action = typeof input.action === 'string' ? input.action : 'update';
    if (action !== 'create' && action !== 'update' && action !== 'delete') {
      throw new Error('Patch file action must be create, update, or delete.');
    }
    return {
      path: this.projectScopedPath(project, input.path),
      action,
      diff: this.redactSecrets(input.diff),
    };
  }

  private projectScopedPath(project: Project, filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..') || normalized.startsWith('.git/')) {
      throw new Error('AI context and patches must use project-scoped file paths.');
    }
    return `${project.slug}/${normalized}`;
  }

  private redactSecrets(value: string): string {
    return value
      .replace(/(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
      .replace(/glpat-[A-Za-z0-9_-]+/g, '[REDACTED_GITLAB_TOKEN]');
  }

  private redactedSecretNames(project: Project): string[] {
    return this.secrets.protectedKeys(project);
  }

  private touchAiChangeRequest(changeRequest: AiChangeRequest, status: AiChangeRequest['status']): void {
    changeRequest.status = status;
    changeRequest.updatedAt = nowIso();
  }

  private isDeploymentState(state: string): state is DeploymentState {
    return state === 'queued' || state === 'running' || state === 'succeeded' || state === 'failed' || state === 'cancelled' || state === 'rolling_back';
  }

  private deploymentEnvironment(environment: unknown): DeploymentStatusReport['environment'] {
    return environment === 'production' || environment === 'staging' || environment === 'preview' || environment === 'sandbox' ? environment : undefined;
  }

  private isAiCiState(status: string): status is AiCiStatus['status'] {
    return status === 'created' || status === 'pending' || status === 'running' || status === 'success' || status === 'failed' || status === 'canceled';
  }

  private upsertEnvironmentVariables(project: Project, user: User, body: Record<string, unknown>): EnvironmentVariable[] {
    const rawVariables = Array.isArray(body.variables) ? body.variables : body.environmentVariables;
    const environmentVariables = this.secrets.upsert(project, rawVariables);
    this.touch(project);
    this.audit.record(user.id, 'project.environment_variables_updated', { keys: environmentVariables.map((variable) => variable.key) }, project.id);
    return environmentVariables;
  }

  private readEnvironmentVariable(project: Project, user: User, key: string, request: ApiRequest): EnvironmentVariable {
    const intent = request.headers?.['x-divband-secret-read'] ?? request.headers?.['X-Divband-Secret-Read'];
    if (intent !== 'reveal') {
      throw new Error('Secret reveal requires X-Divband-Secret-Read: reveal.');
    }
    const environmentVariable = this.secrets.require(project, key);
    this.audit.record(user.id, 'project.environment_variable_revealed', { key: environmentVariable.key }, project.id);
    return environmentVariable;
  }

  private deleteEnvironmentVariable(project: Project, user: User, key: string): EnvironmentVariable[] {
    const environmentVariables = this.secrets.delete(project, key);
    this.touch(project);
    this.audit.record(user.id, 'project.environment_variable_deleted', { key: key.toUpperCase() }, project.id);
    return environmentVariables;
  }

  private archiveProject(project: Project, user: User): Project {
    project.archivedAt = nowIso();
    this.touch(project, 'archived');
    this.audit.record(user.id, 'project.archived', {}, project.id);
    return project;
  }

  private requireProject(projectId: string, actor: AuthActor, permission: ProjectPermission): AuthorizedProject {
    const project = this.store.projects.get(projectId);
    const membership = project ? this.auth.projectMembershipFor(actor, project.id) : undefined;
    if (!project || !membership || !can(membership.role, permission)) {
      throw new Error('Project not found or permission denied.');
    }

    return { project, membership };
  }

  private listProjectMembers(project: Project): Array<ProjectMembership & { user?: User }> {
    return [...this.store.projectMemberships.values()]
      .filter((membership) => membership.projectId === project.id)
      .map((membership) => ({ ...membership, user: this.store.users.get(membership.userId) }));
  }

  private upsertProjectMember(authorized: AuthorizedProject, actor: User, body: Record<string, unknown>): ProjectMembership {
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const role = typeof body.role === 'string' ? body.role : '';
    if (!this.isProjectRole(role) || !assignableRoles(authorized.membership.role).includes(role)) {
      throw new Error('Requested role cannot be assigned by the current actor.');
    }
    if (!this.store.users.has(userId)) {
      throw new Error('User not found.');
    }

    const timestamp = nowIso();
    const existing = [...this.store.projectMemberships.values()].find((membership) => membership.projectId === authorized.project.id && membership.userId === userId);
    if (existing) {
      existing.role = role;
      existing.updatedAt = timestamp;
      this.audit.record(actor.id, 'project.member_updated', { userId, role }, authorized.project.id);
      return existing;
    }

    const membership: ProjectMembership = {
      id: createId('project_member'),
      projectId: authorized.project.id,
      userId,
      role,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.projectMemberships.set(membership.id, membership);
    this.audit.record(actor.id, 'project.member_added', { userId, role }, authorized.project.id);
    return membership;
  }

  private createProjectApiToken(authorized: AuthorizedProject, user: User, body: Record<string, unknown>): { apiToken: ApiToken; token: string } {
    const role = typeof body.role === 'string' ? body.role : authorized.membership.role;
    if (!this.isProjectRole(role) || !assignableRoles(authorized.membership.role).includes(role)) {
      throw new Error('Requested token role cannot be assigned by the current actor.');
    }
    const input: CreateApiTokenInput = {
      name: typeof body.name === 'string' ? body.name : 'Project API token',
      projectId: authorized.project.id,
      role,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
    };
    const result = this.auth.createApiToken(user.id, input);
    this.audit.record(user.id, 'project.api_token_created', { tokenId: result.apiToken.id, role }, authorized.project.id);
    return result;
  }

  private requireGitLabIdentity(user: User): GitLabIdentityLink {
    const link = [...this.store.gitlabIdentityLinks.values()].find((identity) => identity.userId === user.id);
    if (!link) {
      throw new Error('Link a GitLab identity before provisioning or accessing generated repositories.');
    }
    return link;
  }

  private createOrganization(user: User, body: Record<string, unknown>): Organization {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `${user.name}'s team`;
    const slug = normalizeSlug(typeof body.slug === 'string' ? body.slug : name);
    if (!slug) {
      throw new Error('Organization slug is required.');
    }
    const timestamp = nowIso();
    const organization: Organization = { id: createId('org'), name, slug, createdAt: timestamp, updatedAt: timestamp };
    const membership: OrganizationMembership = { id: createId('org_member'), organizationId: organization.id, userId: user.id, role: 'owner', createdAt: timestamp };
    this.store.organizations.set(organization.id, organization);
    this.store.organizationMemberships.set(membership.id, membership);
    this.audit.record(user.id, 'organization.created', { organizationId: organization.id, slug });
    return organization;
  }

  private ensurePersonalOrganization(user: User): { organization: Organization; membership: OrganizationMembership } {
    const existingMembership = [...this.store.organizationMemberships.values()].find((membership) => membership.userId === user.id && membership.role === 'owner');
    const existingOrganization = existingMembership ? this.store.organizations.get(existingMembership.organizationId) : undefined;
    if (existingMembership && existingOrganization) {
      return { organization: existingOrganization, membership: existingMembership };
    }

    const timestamp = nowIso();
    const organization: Organization = {
      id: createId('org'),
      name: `${user.name}'s workspace`,
      slug: normalizeSlug(`${user.name}-${user.id}`) || user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const membership: OrganizationMembership = { id: createId('org_member'), organizationId: organization.id, userId: user.id, role: 'owner', createdAt: timestamp };
    this.store.organizations.set(organization.id, organization);
    this.store.organizationMemberships.set(membership.id, membership);
    return { organization, membership };
  }

  private requireOrganizationForUser(organizationId: string, user: User): Organization {
    const organization = this.store.organizations.get(organizationId);
    const membership = [...this.store.organizationMemberships.values()].find((item) => item.organizationId === organizationId && item.userId === user.id);
    if (!organization || !membership) {
      throw new Error('Organization not found.');
    }
    return organization;
  }

  private listOrganizations(user: User): Organization[] {
    const organizationIds = new Set(
      [...this.store.organizationMemberships.values()].filter((membership) => membership.userId === user.id).map((membership) => membership.organizationId),
    );
    return [...this.store.organizations.values()].filter((organization) => organizationIds.has(organization.id));
  }

  private authResponse(result: { user: User; session: AuthSession; token: string; tokenType: 'Bearer' }): { user: User; session: Omit<AuthSession, 'tokenHash'>; token: string; tokenType: 'Bearer' } {
    return { user: result.user, session: this.redactSession(result.session), token: result.token, tokenType: result.tokenType };
  }

  private redactSession(session: AuthSession): Omit<AuthSession, 'tokenHash'> {
    const { tokenHash: _tokenHash, ...safeSession } = session;
    return safeSession;
  }

  private redactApiToken(apiToken: ApiToken): Omit<ApiToken, 'tokenHash'> {
    const { tokenHash: _tokenHash, ...safeToken } = apiToken;
    return safeToken;
  }

  private redactGitLabIdentity(identity: GitLabIdentityLink): Omit<GitLabIdentityLink, 'accessTokenHash'> {
    const { accessTokenHash: _accessTokenHash, ...safeIdentity } = identity;
    return safeIdentity;
  }

  private requireDomain(project: Project, domainId: string): ProjectDomain {
    const domain = project.domains.find((item) => item.id === domainId);
    if (!domain) {
      throw new Error('Domain not found.');
    }

    return domain;
  }

  private requireDeployment(project: Project, deploymentId: string): Deployment {
    const deployment = project.deployments.find((item) => item.id === deploymentId);
    if (!deployment) {
      throw new Error('Deployment not found.');
    }

    return deployment;
  }

  private touch(project: Project, status?: ProjectStatus): void {
    if (status) {
      project.status = status;
    }
    project.updatedAt = nowIso();
  }

  private authenticateOptional(request: ApiRequest): AuthActor | undefined {
    const authorization = request.headers?.authorization ?? request.headers?.Authorization;
    if (!authorization) {
      return undefined;
    }

    return this.auth.authenticate(authorization);
  }

  private isPublishingRoute(route: RouteMatch): boolean {
    return route.segments[0] === 'api' && route.segments[1] === 'v1' && route.segments[2] === 'publish';
  }

  private parsePath(path: string): RouteMatch {
    const url = new URL(path, 'https://api.divband.local');
    return {
      segments: url.pathname.split('/').filter(Boolean).map(decodeURIComponent),
      query: url.searchParams,
    };
  }

  private matches(route: RouteMatch, ...segments: string[]): boolean {
    return route.segments.length === segments.length && route.segments.every((segment, index) => segment === segments[index]);
  }

  private registerInput(body: unknown): RegisterInput {
    const record = this.requiredObject(body);
    if (typeof record.email !== 'string' || typeof record.name !== 'string' || typeof record.password !== 'string') {
      throw new Error('Registration requires email, name, and password.');
    }

    return { email: record.email, name: record.name, password: record.password };
  }

  private loginInput(body: unknown): LoginInput {
    const record = this.requiredObject(body);
    if (typeof record.email !== 'string' || typeof record.password !== 'string') {
      throw new Error('Login requires email and password.');
    }

    return { email: record.email, password: record.password };
  }

  private oauthIdentityInput(body: unknown): LinkOAuthIdentityInput {
    const record = this.requiredObject(body);
    if (typeof record.provider !== 'string' || (record.provider !== 'oidc' && record.provider !== 'oauth')) {
      throw new Error('OAuth identity provider must be oauth or oidc.');
    }
    if (typeof record.issuer !== 'string' || typeof record.subject !== 'string') {
      throw new Error('OAuth identity requires issuer and subject.');
    }
    return { provider: record.provider, issuer: record.issuer, subject: record.subject, email: typeof record.email === 'string' ? record.email : undefined };
  }

  private gitLabIdentityInput(body: unknown): LinkGitLabIdentityInput {
    const record = this.requiredObject(body);
    if (typeof record.gitlabUserId !== 'string' || typeof record.username !== 'string') {
      throw new Error('GitLab identity requires gitlabUserId and username.');
    }
    return {
      gitlabUserId: record.gitlabUserId,
      username: record.username,
      accessToken: typeof record.accessToken === 'string' ? record.accessToken : undefined,
    };
  }

  private requiredObject(body: unknown): Record<string, unknown> {
    if (!this.isRecord(body)) {
      throw new Error('JSON object body is required.');
    }

    return body;
  }

  private optionalObject(body: unknown): Record<string, unknown> {
    return this.isRecord(body) ? body : {};
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isProjectRole(role: string): role is ProjectRole {
    return role === 'owner' || role === 'admin' || role === 'developer' || role === 'viewer';
  }

  private ok<T>(body: T): ApiResponse<T> {
    return { status: 200, body };
  }

  private created<T>(body: T, status = 201): ApiResponse<T> {
    return { status, body };
  }

  private error(status: number, code: string, message: string): ApiResponse<ApiErrorBody> {
    return { status, body: { error: { code, message } } };
  }
}

export const backendService = new BackendService();

export function handleApiRequest(request: ApiRequest): Promise<ApiResponse> {
  return backendService.handle(request);
}
