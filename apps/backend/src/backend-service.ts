import { can, assignableRoles, type ProjectPermission, type ProjectRole } from '@divband/auth';
import process from 'node:process';
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
  DomainDnsInstruction,
  DomainDnsMode,
  DomainDelegationStatus,
  DelegatedDnsSetup,
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
  TenantPlan,
  TenantPlanTier,
  User,
} from './models.ts';
import { defaultStore, type BackendStore } from './store.ts';
import { AuthService, type CreateApiTokenInput, type LinkGitLabIdentityInput, type LinkOAuthIdentityInput, type LoginInput, type RegisterInput } from './services/auth.ts';
import { AuditLogService } from './services/audit-log.ts';
import { CertificateStatusService } from './services/certificate-status.ts';
import { DeploymentStatusService, type DeploymentStatusReport } from './services/deployment-status.ts';
import { DnsVerificationService } from './services/dns-verification.ts';
import { ManagedDnsService, type ManagedDnsProvider } from './services/managed-dns.ts';
import { GitLabService } from './services/gitlab.ts';
import { GitHubOAuthService } from './services/github-oauth.ts';
import { KubernetesService } from './services/kubernetes.ts';
import { RateLimitService } from './services/rate-limit.ts';
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

export interface BackendServiceOptions extends PublishingServiceOptions {
  managedDnsProvider?: ManagedDnsProvider;
  managedDnsDefaultTtlSeconds?: number;
  managedDnsPlatformIngressTarget?: string;
  managedDnsApexRecordType?: 'ALIAS' | 'ANAME' | 'A' | 'AAAA';
  requireEmailVerification?: boolean;
}

export class BackendService {
  private readonly auth: AuthService;
  private readonly audit: AuditLogService;
  private readonly certificates = new CertificateStatusService();
  private readonly deployments = new DeploymentStatusService();
  private readonly dns = new DnsVerificationService();
  private readonly managedDns: ManagedDnsService;
  private readonly gitlab = new GitLabService();
  private readonly githubOAuth: GitHubOAuthService;
  private readonly kubernetes = new KubernetesService();
  private readonly publishing: PublishingService;
  private readonly secrets: ProjectSecretService;
  private readonly rateLimits: RateLimitService;
  private readonly requireEmailVerification: boolean;

  constructor(private readonly store: BackendStore = defaultStore, options: BackendServiceOptions = {}) {
    this.auth = new AuthService(store);
    this.audit = new AuditLogService(store);
    this.githubOAuth = new GitHubOAuthService(store);
    this.rateLimits = new RateLimitService(store);
    this.secrets = new ProjectSecretService(store);
    this.publishing = new PublishingService(store, options);
    this.requireEmailVerification = options.requireEmailVerification ?? true;
    this.managedDns = new ManagedDnsService(options.managedDnsProvider, {
      defaultTtlSeconds: options.managedDnsDefaultTtlSeconds,
      platformIngressTarget: options.managedDnsPlatformIngressTarget,
      apexRecordType: options.managedDnsApexRecordType,
    });
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    try {
      const route = this.parsePath(request.path);
      const method = request.method.toUpperCase();
      this.applyRateLimit(method, route, request);

      if (method === 'POST' && this.matches(route, 'auth', 'register')) {
        const result = this.auth.register(this.registerInput(request.body));
        this.ensurePersonalOrganization(result.user);
        if (this.store.users.size === 1 && this.store.platformAdmins.size === 0) {
          this.grantPlatformAdmin(result.user.id, 'super_admin', result.user.id);
        }
        this.audit.record(result.user.id, 'user.registered', { email: result.user.email });
        return this.created(this.authResponse(result));
      }

      if (method === 'POST' && this.matches(route, 'auth', 'verify-email')) {
        const token = this.stringField(this.requiredObject(request.body), 'token', 'Email verification token is required.');
        const user = this.auth.verifyEmail(token);
        this.audit.record(user.id, 'user.email_verified', { email: user.email });
        return this.ok({ user });
      }

      if (method === 'POST' && this.matches(route, 'auth', 'password-reset', 'request')) {
        const email = this.stringField(this.requiredObject(request.body), 'email', 'Email is required.');
        const result = this.auth.requestPasswordReset(email);
        if (result.challenge) {
          this.audit.record(result.challenge.userId, 'user.password_reset_requested', { challengeId: result.challenge.id });
        }
        return this.ok({ ok: true, resetToken: result.token });
      }

      if (method === 'POST' && this.matches(route, 'auth', 'password-reset', 'confirm')) {
        const body = this.requiredObject(request.body);
        const user = this.auth.resetPassword(this.stringField(body, 'token', 'Password reset token is required.'), this.stringField(body, 'password', 'Password is required.'));
        this.audit.record(user.id, 'user.password_reset_completed', {});
        return this.ok({ user });
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

      if (this.isAcmeChallengeRoute(route)) {
        return await this.handleAcmeChallengeRoute(method, route, request);
      }

      if (method === 'GET' && (this.matches(route, 'auth', 'github', 'callback') || this.matches(route, 'auth', 'callback', 'github'))) {
        const result = await this.githubOAuth.complete(
          route.query.get('code') ?? '',
          route.query.get('state') ?? '',
          this.apiBaseUrl(),
        );
        const identity = this.auth.linkGitLabIdentity(result.userId, {
          provider: 'github',
          gitlabUserId: result.githubUserId,
          username: result.username,
          accessToken: result.accessToken,
        });
        this.audit.record(result.userId, 'user.github_identity_linked', { username: identity.username });
        const project = result.projectId ? this.store.projects.get(result.projectId) : undefined;
        if (project && project.ownerId === result.userId && !project.repositoryUrl) {
          const user = this.store.users.get(result.userId);
          if (user) {
            await this.createGitLabRepository(project, user);
          }
        }
        return this.ok({ redirectTo: project ? `/#gitlab-repository-status?projectId=${encodeURIComponent(project.id)}` : result.returnTo, gitlabIdentity: this.redactGitLabIdentity(identity) });
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
      this.requireVerifiedAccount(actor);

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

      if (method === 'POST' && (this.matches(route, 'auth', 'gitlab-identity') || this.matches(route, 'auth', 'github-identity'))) {
        const gitlabIdentity = this.auth.linkGitLabIdentity(user.id, this.sourceControlIdentityInput(request.body, route.segments[1] === 'github-identity' ? 'github' : 'gitlab'));
        this.audit.record(user.id, 'user.source_control_identity_linked', { provider: gitlabIdentity.provider ?? 'gitlab', username: gitlabIdentity.username });
        return this.created({ gitlabIdentity: this.redactGitLabIdentity(gitlabIdentity) });
      }

      if (method === 'POST' && this.matches(route, 'auth', 'github', 'oauth', 'start')) {
        const body = this.optionalObject(request.body);
        const returnTo = typeof body.returnTo === 'string' ? body.returnTo : '/#gitlab-repository-status';
        const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
        return this.ok(this.githubOAuth.start(user.id, this.apiBaseUrl(), returnTo, projectId));
      }

      if (method === 'GET' && this.matches(route, 'auth', 'github', 'repositories')) {
        return this.ok({ repositories: await this.gitlab.listRepositories(this.sourceControlIdentityForUser(user)) });
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
          this.refreshProjectDomainCertificateStatuses(project);
          return this.ok({ project, membership });
        }

        if (method === 'DELETE' && route.segments.length === 2) {
          const { project } = this.requireProject(projectId, actor, 'project:archive');
          return this.ok({ project: this.archiveProject(project, user) });
        }

        if (method === 'GET' && this.matches(route, 'projects', projectId, 'status')) {
          const { project } = this.requireProject(projectId, actor, 'project:read');
          this.refreshProjectDomainCertificateStatuses(project);
          return this.ok({
            status: project.status,
            repositoryUrl: project.repositoryUrl,
            namespaceProvisioned: project.namespaceProvisioned,
            platformSubdomainAttached: project.platformSubdomainAttached,
            activeDomains: project.domains.filter((domain) => domain.verified).map((domain) => domain.hostname),
            domains: project.domains.map((domain) => this.domainStatusResponse(domain)),
            latestDeployment: project.deployments.at(-1),
          });
        }

        if (method === 'GET' && this.matches(route, 'projects', projectId, 'repository', 'contents')) {
          const { project } = this.requireProject(projectId, actor, 'project:read');
          const path = route.query.get('path') ?? '';
          return this.ok({
            repository: project.repository,
            files: await this.gitlab.listRepositoryContents(project, this.sourceControlIdentityForUser(user), path),
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

        if (method === 'POST' && (this.matches(route, 'projects', projectId, 'gitlab-repository') || this.matches(route, 'projects', projectId, 'github-repository'))) {
          const { project } = this.requireProject(projectId, actor, 'project:provision_gitlab');
          if (this.gitlab.requiresLinkedIdentity()) {
            this.requireGitLabIdentity(user);
          }
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
          const domain = await this.addCustomDomain(project, user, this.requiredObject(request.body));
          return this.created({ domain, setup: this.delegatedDnsSetup(domain) }, 202);
        }

        if (method === 'GET' && route.segments[2] === 'domains' && route.segments[3] && route.segments[4] === 'dns-setup') {
          const { project } = this.requireProject(projectId, actor, 'domain:manage');
          const domain = this.requireDomain(project, route.segments[3]);
          return this.ok({ setup: this.delegatedDnsSetup(domain) });
        }

        if (method === 'POST' && route.segments[2] === 'domains' && route.segments[3] && route.segments[4] === 'verify') {
          const { project } = this.requireProject(projectId, actor, 'domain:manage');
          const domain = await this.verifyCustomDomain(project, user, route.segments[3], this.optionalObject(request.body));
          return this.ok({ domain, setup: this.delegatedDnsSetup(domain) });
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

    if (method === 'GET' && resource === 'monitoring' && route.segments[2] === 'signals') {
      return this.ok({ signals: this.monitoringSignals() });
    }

    if (method === 'PUT' && resource === 'billing' && route.segments[2] === 'organizations' && route.segments[3]) {
      return this.ok({ organization: this.updateOrganizationBilling(route.segments[3], this.requiredObject(body), actor.user) });
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
    for (const project of this.store.projects.values()) {
      this.refreshProjectDomainCertificateStatuses(project);
    }
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
    if (abuseAction.action === 'restrict_deployments' && abuseAction.targetType === 'project') {
      const project = this.store.projects.get(abuseAction.targetId);
      if (project) {
        project.deploymentRestrictedAt = abuseAction.createdAt;
        project.deploymentRestrictionReason = abuseAction.reason;
      }
      return;
    }
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
    this.requireTenantActive(organization);
    this.requireProjectQuota(organization);
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
    for (const project of this.store.projects.values()) {
      this.refreshProjectDomainCertificateStatuses(project);
    }

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
    const identity = this.sourceControlIdentityForUser(user);
    const repository = await this.gitlab.createRepository(project, this.secrets.list(project, { reveal: true }), identity);
    await this.gitlab.configureRunnerTag(project, identity);
    project.repositoryUrl = repository.webUrl;
    project.repository = {
      provider: repository.provider === 'gitlab' ? 'gitlab' : 'github',
      path: repository.path,
      webUrl: repository.webUrl,
      cloneUrl: repository.cloneUrl,
      defaultBranch: repository.defaultBranch ?? 'main',
      connectedAt: nowIso(),
    };
    this.touch(project, 'repository_provisioned');
    this.audit.record(user.id, 'project.repository_created', { path: repository.path }, project.id);
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

  private async addCustomDomain(project: Project, user: User, body: Record<string, unknown>): Promise<ProjectDomain> {
    this.requireDomainQuota(project);
    const hostname = typeof body.hostname === 'string' ? body.hostname.trim().toLowerCase() : '';
    if (!hostname || !hostname.includes('.')) {
      throw new Error('A valid hostname is required.');
    }

    const dnsMode = this.parseDomainDnsMode(body, hostname);
    const challenge = this.dns.createChallenge(hostname);
    const timestamp = nowIso();
    const assignedNameservers = this.assignedNameservers(dnsMode);
    const dnsTarget = this.domainDnsTarget(project, dnsMode);
    const verificationRecord = `${challenge.recordName} ${challenge.recordType} ${challenge.recordValue}`;
    const domain: ProjectDomain = {
      id: createId('domain'),
      hostname,
      dnsMode,
      status: 'pending_dns',
      verificationStatus: 'pending',
      verificationToken: challenge.token,
      verificationName: challenge.recordName,
      verificationValue: challenge.recordValue,
      verificationRecord,
      verified: false,
      dnsTarget,
      assignedNameservers,
      delegationStatus: this.initialDelegationStatus(dnsMode),
      providerZoneId: typeof body.providerZoneId === 'string' && body.providerZoneId.trim() ? body.providerZoneId.trim() : undefined,
      dnsInstructions: this.domainDnsInstructions(hostname, dnsMode, challenge.recordName, challenge.recordValue, dnsTarget, assignedNameservers),
      certificateStatus: 'not_requested',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.managedDns.ensureDelegatedZone(project, domain);
    if (domain.providerZoneId) {
      await this.managedDns.createVerificationRecord(domain);
      domain.dnsInstructions = this.domainDnsInstructions(hostname, dnsMode, challenge.recordName, challenge.recordValue, dnsTarget, domain.assignedNameservers);
    }

    project.domains.push(domain);
    this.touch(project, 'domain_pending_verification');
    this.audit.record(user.id, 'project.custom_domain_added', { hostname, dnsMode }, project.id);
    return domain;
  }

  private async verifyCustomDomain(project: Project, user: User, domainId: string, body: Record<string, unknown>): Promise<ProjectDomain> {
    const domain = this.requireDomain(project, domainId);
    const observedToken = typeof body.observedToken === 'string' ? body.observedToken : undefined;
    domain.lastCheckedAt = nowIso();

    if (this.isDelegatedDnsMode(domain.dnsMode)) {
      const checkedAt = nowIso();
      const delegation = await this.dns.verifyDelegation(domain.hostname, domain.assignedNameservers);
      domain.delegationStatus = delegation.verified ? 'verified' : 'failed';
      domain.delegationCheckedAt = checkedAt;
      if (delegation.verified) {
        domain.delegationVerifiedAt = checkedAt;
        domain.delegationFailedAt = undefined;
      }
      if (!delegation.verified) {
        const reason = delegation.reason ?? 'DNS delegation verification failed.';
        domain.verificationStatus = 'failed';
        domain.status = 'failed';
        domain.failureReason = reason;
        domain.delegationFailedAt = checkedAt;
        domain.updatedAt = checkedAt;
        throw new Error(reason);
      }
    }

    const verified = await this.dns.verify(domain.hostname, domain.verificationToken, observedToken);
    if (!verified) {
      const reason = this.isDelegatedDnsMode(domain.dnsMode)
        ? `Ownership verification failed: publish TXT ${domain.verificationName} with value ${domain.verificationValue} in the delegated managed zone, then retry.`
        : 'DNS verification failed.';
      domain.verificationStatus = 'failed';
      domain.status = 'failed';
      domain.failureReason = reason;
      domain.updatedAt = nowIso();
      throw new Error(reason);
    }

    const verifiedAt = nowIso();
    const updatedDomain = this.certificates.markRequested({
      ...domain,
      verified: true,
      verificationStatus: 'verified',
      status: 'active',
      verifiedAt,
      updatedAt: verifiedAt,
      failureReason: undefined,
    });
    Object.assign(domain, updatedDomain);
    if (domain.providerZoneId) {
      await this.managedDns.createApplicationRecord(project, domain);
      await this.managedDns.createWildcardRecord(project, domain);
    }
    this.touch(project, 'domain_active');
    this.audit.record(user.id, 'project.custom_domain_verified', { hostname: domain.hostname, dnsMode: domain.dnsMode }, project.id);
    return domain;
  }

  private refreshProjectDomainCertificateStatuses(project: Project): void {
    let changed = false;
    for (const domain of project.domains) {
      const nextStatus = this.certificates.getStatus(domain);
      if (nextStatus !== domain.certificateStatus) {
        domain.certificateStatus = nextStatus;
        domain.updatedAt = nowIso();
        changed = true;
        if (nextStatus === 'issued') {
          domain.status = 'active';
          domain.failureReason = undefined;
        } else if (nextStatus === 'failed') {
          domain.status = 'failed';
          domain.failureReason = domain.failureReason ?? `Certificate issuance failed for ${domain.hostname}.`;
        } else if (domain.verified) {
          domain.status = 'provisioning';
        }
      }
    }
    if (changed) {
      project.updatedAt = nowIso();
    }
  }


  private parseDomainDnsMode(body: Record<string, unknown>, hostname: string): DomainDnsMode {
    const requested = typeof body.dnsMode === 'string' ? body.dnsMode : typeof body.mode === 'string' ? body.mode : undefined;
    if (requested === 'none' || requested === 'custom_cname' || requested === 'apex' || requested === 'delegated_sub_zone' || requested === 'delegated_full_zone') {
      return requested;
    }
    if (requested === 'delegated_dns') {
      return 'delegated_full_zone';
    }
    return hostname.split('.').length === 2 ? 'apex' : 'custom_cname';
  }

  private assignedNameservers(dnsMode: DomainDnsMode): string[] {
    if (!this.isDelegatedDnsMode(dnsMode)) {
      return [];
    }
    return [];
  }

  private initialDelegationStatus(dnsMode: DomainDnsMode): DomainDelegationStatus {
    return this.isDelegatedDnsMode(dnsMode) ? 'pending' : 'not_applicable';
  }

  private domainDnsTarget(project: Project, dnsMode: DomainDnsMode): string | string[] | undefined {
    if (dnsMode === 'none' || this.isDelegatedDnsMode(dnsMode)) {
      return undefined;
    }
    if (dnsMode === 'apex') {
      return project.platformHostname;
    }
    return project.platformHostname;
  }

  private domainDnsInstructions(
    hostname: string,
    dnsMode: DomainDnsMode,
    verificationName: string,
    verificationValue: string,
    dnsTarget: string | string[] | undefined,
    assignedNameservers: string[],
  ): DomainDnsInstruction[] {
    const instructions: DomainDnsInstruction[] = [
      { type: 'TXT', name: verificationName, value: verificationValue, purpose: 'ownership_verification', required: true },
    ];

    if (dnsMode === 'custom_cname' && dnsTarget) {
      instructions.push({ type: 'CNAME', name: hostname, value: dnsTarget, purpose: 'traffic_routing', required: true });
    }

    if (dnsMode === 'apex' && dnsTarget) {
      instructions.push({ type: 'ALIAS', name: hostname, value: dnsTarget, purpose: 'traffic_routing', required: true });
      instructions.push({ type: 'ANAME', name: hostname, value: dnsTarget, purpose: 'traffic_routing', required: false });
    }

    if (this.isDelegatedDnsMode(dnsMode)) {
      instructions.push({ type: 'NS', name: hostname, value: assignedNameservers, purpose: 'zone_delegation', required: true });
    }

    return instructions;
  }

  private isDelegatedDnsMode(dnsMode: DomainDnsMode): boolean {
    return dnsMode === 'delegated_sub_zone' || dnsMode === 'delegated_full_zone';
  }


  private detectHostedAppAbuse(body: Record<string, unknown>): void {
    const image = typeof body.image === 'string' ? body.image.toLowerCase() : '';
    const gitRef = typeof body.gitRef === 'string' ? body.gitRef.toLowerCase() : '';
    const marker = `${image} ${gitRef}`;
    if (/(phish|malware|crypto-miner|botnet|spam)/u.test(marker)) {
      throw new Error('Deployment blocked by hosted-app abuse detection.');
    }
  }

  private triggerDeployment(project: Project, user: User, body: Record<string, unknown>): Deployment {
    this.requireDeploymentAllowed(project);
    this.detectHostedAppAbuse(body);
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
    const branch = await this.gitlab.createBranch(project, changeRequest, changeRequest.patch, this.sourceControlIdentityForUser(user));
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

    const mergeRequest = await this.gitlab.openMergeRequest(project, changeRequest, this.sourceControlIdentityForUser(user));
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

    const pipeline = await this.gitlab.triggerPipeline(project, changeRequest.branch?.name ?? changeRequest.mergeRequest.sourceBranch, this.sourceControlIdentityForUser(user));
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
    const link = this.sourceControlIdentityForUser(user);
    if (!link) {
      throw new Error('Link a source-control identity before provisioning or accessing generated repositories.');
    }
    return link;
  }

  private sourceControlIdentityForUser(user: User): GitLabIdentityLink | undefined {
    const identities = [...this.store.gitlabIdentityLinks.values()].filter((identity) => identity.userId === user.id);
    return identities.find((identity) => identity.provider === 'github' && identity.accessToken) ?? identities.at(-1);
  }

  private createOrganization(user: User, body: Record<string, unknown>): Organization {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `${user.name}'s team`;
    const slug = normalizeSlug(typeof body.slug === 'string' ? body.slug : name);
    if (!slug) {
      throw new Error('Organization slug is required.');
    }
    const timestamp = nowIso();
    const organization: Organization = { id: createId('org'), name, slug, createdAt: timestamp, updatedAt: timestamp, billingTier: 'free', billingStatus: 'trialing' };
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
      billingTier: 'free',
      billingStatus: 'trialing',
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

  private authResponse(result: { user: User; session: AuthSession; token: string; tokenType: 'Bearer'; emailVerificationToken?: string }): { user: User; session: Omit<AuthSession, 'tokenHash'>; token: string; tokenType: 'Bearer'; emailVerificationToken?: string } {
    return { user: result.user, session: this.redactSession(result.session), token: result.token, tokenType: result.tokenType, emailVerificationToken: result.emailVerificationToken };
  }

  private redactSession(session: AuthSession): Omit<AuthSession, 'tokenHash'> {
    const { tokenHash: _tokenHash, ...safeSession } = session;
    return safeSession;
  }

  private redactApiToken(apiToken: ApiToken): Omit<ApiToken, 'tokenHash'> {
    const { tokenHash: _tokenHash, ...safeToken } = apiToken;
    return safeToken;
  }

  private redactGitLabIdentity(identity: GitLabIdentityLink): Omit<GitLabIdentityLink, 'accessTokenHash' | 'accessToken'> {
    const { accessTokenHash: _accessTokenHash, accessToken: _accessToken, ...safeIdentity } = identity;
    return safeIdentity;
  }


  private delegatedDnsSetup(domain: ProjectDomain): DelegatedDnsSetup {
    const isDelegated = this.isDelegatedDnsMode(domain.dnsMode);
    const nextSteps = isDelegated
      ? [
        `Create or replace NS records for ${domain.hostname} at the parent zone with the assigned managed-provider nameservers.`,
        'Wait for registrar and resolver propagation, then run domain verification again.',
        'After delegation and ownership verification pass, Divband manages app, wildcard, and ACME challenge records in the provider zone.',
      ]
      : [
        'Publish the required ownership and traffic-routing DNS records shown in dnsInstructions.',
        'Wait for DNS propagation, then run domain verification again.',
      ];
    return {
      mode: domain.dnsMode,
      providerZoneId: domain.providerZoneId,
      assignedNameservers: domain.assignedNameservers,
      delegationStatus: domain.delegationStatus,
      verificationStatus: domain.verificationStatus,
      failureReason: domain.failureReason,
      dnsInstructions: domain.dnsInstructions,
      propagationGuidance: isDelegated
        ? 'Delegation can take minutes to hours depending on registrar and parent-zone TTLs; verification checks public resolvers and authoritative parent nameservers for the exact NS set.'
        : 'DNS changes can take minutes to hours depending on provider TTLs; verification checks for the required ownership TXT record before activating the domain.',
      nextSteps,
      createdAt: domain.createdAt,
      updatedAt: domain.updatedAt,
      lastCheckedAt: domain.lastCheckedAt,
      delegationCheckedAt: domain.delegationCheckedAt,
      delegationVerifiedAt: domain.delegationVerifiedAt,
      delegationFailedAt: domain.delegationFailedAt,
    };
  }

  private apiBaseUrl(): string {
    return process.env.API_BASE_URL?.trim() || 'http://localhost:3000';
  }

  private domainStatusResponse(domain: ProjectDomain): Pick<ProjectDomain, 'id' | 'hostname' | 'dnsMode' | 'status' | 'verificationStatus' | 'assignedNameservers' | 'delegationStatus' | 'certificateStatus' | 'failureReason'> & { mode: DomainDnsMode; dnsSetup: DelegatedDnsSetup } {
    return {
      id: domain.id,
      hostname: domain.hostname,
      mode: domain.dnsMode,
      dnsMode: domain.dnsMode,
      status: domain.status,
      verificationStatus: domain.verificationStatus,
      assignedNameservers: domain.assignedNameservers,
      delegationStatus: domain.delegationStatus,
      certificateStatus: domain.certificateStatus,
      failureReason: domain.failureReason,
      dnsSetup: this.delegatedDnsSetup(domain),
    };
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


  private applyRateLimit(method: string, route: RouteMatch, request: ApiRequest): void {
    const client = this.clientIp(request);
    if (route.segments[0] === 'auth') {
      this.rateLimits.consume({ key: `auth:${client}:${route.segments.join('/')}`, limit: 20, windowSeconds: 60, blockSeconds: 300 });
    }
    if (this.isPublishingRoute(route) && (method === 'POST' || method === 'PUT')) {
      this.rateLimits.consume({ key: `publish:${client}`, limit: 30, windowSeconds: 60 * 60, blockSeconds: 60 * 60 });
    }
    if (route.segments[0] === 'projects' && route.segments.includes('deployments') && method === 'POST') {
      this.rateLimits.consume({ key: `deploy:${client}`, limit: 60, windowSeconds: 60 * 60, blockSeconds: 15 * 60 });
    }
  }

  private clientIp(request: ApiRequest): string {
    const forwarded = request.headers?.['x-forwarded-for'] ?? request.headers?.['X-Forwarded-For'];
    return (forwarded?.split(',')[0]?.trim() || request.headers?.['x-real-ip'] || request.headers?.['X-Real-IP'] || 'unknown').toString();
  }

  private requireVerifiedAccount(actor: AuthActor): void {
    if (this.requireEmailVerification && !actor.user.emailVerifiedAt) {
      throw new Error('Email verification is required before using authenticated platform features.');
    }
  }

  private stringField(body: Record<string, unknown>, field: string, message: string): string {
    const value = body[field];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(message);
    }
    return value;
  }

  private planFor(tier: TenantPlanTier | undefined, billingStatus: TenantPlan['billingStatus'] | undefined): TenantPlan {
    const normalizedTier = tier ?? 'free';
    const planLimits = {
      free: { maxProjects: 3, maxCustomDomains: 1, maxMonthlyDeployments: 100, maxPublishedSites: 3, maxPublishBytes: 1024 * 1024 * 1024 },
      pro: { maxProjects: 25, maxCustomDomains: 10, maxMonthlyDeployments: 1_000, maxPublishedSites: 25, maxPublishBytes: 25 * 1024 * 1024 * 1024 },
      team: { maxProjects: 250, maxCustomDomains: 100, maxMonthlyDeployments: 10_000, maxPublishedSites: 250, maxPublishBytes: 250 * 1024 * 1024 * 1024 },
    }[normalizedTier];
    return { tier: normalizedTier, billingStatus: billingStatus ?? 'trialing', ...planLimits };
  }

  private requireTenantActive(organization: Organization): void {
    if (organization.suspendedAt) {
      throw new Error('Organization is suspended.');
    }
    const plan = this.planFor(organization.billingTier, organization.billingStatus);
    if (plan.billingStatus === 'past_due' || plan.billingStatus === 'cancelled') {
      throw new Error('Billing must be active before creating or changing hosted resources.');
    }
  }

  private requireProjectQuota(organization: Organization): void {
    const plan = this.planFor(organization.billingTier, organization.billingStatus);
    const activeProjects = [...this.store.projects.values()].filter((project) => project.organizationId === organization.id && project.status !== 'archived').length;
    if (activeProjects >= plan.maxProjects) {
      throw new Error(`Tenant project quota exceeded for ${plan.tier} plan.`);
    }
  }

  private requireDomainQuota(project: Project): void {
    const organization = this.store.organizations.get(project.organizationId);
    if (!organization) {
      throw new Error('Organization not found.');
    }
    this.requireTenantActive(organization);
    const plan = this.planFor(organization.billingTier, organization.billingStatus);
    if (project.domains.length >= plan.maxCustomDomains) {
      throw new Error(`Custom-domain quota exceeded for ${plan.tier} plan.`);
    }
  }

  private requireDeploymentAllowed(project: Project): void {
    const organization = this.store.organizations.get(project.organizationId);
    if (!organization) {
      throw new Error('Organization not found.');
    }
    this.requireTenantActive(organization);
    if (project.suspendedAt) {
      throw new Error('Project is suspended.');
    }
    if (project.deploymentRestrictedAt) {
      throw new Error('Project deployments are restricted by the abuse team.');
    }
    const plan = this.planFor(organization.billingTier, organization.billingStatus);
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const monthlyDeployments = project.deployments.filter((deployment) => deployment.startedAt?.startsWith(monthPrefix)).length;
    if (monthlyDeployments >= plan.maxMonthlyDeployments) {
      throw new Error(`Monthly deployment quota exceeded for ${plan.tier} plan.`);
    }
  }

  private updateOrganizationBilling(organizationId: string, body: Record<string, unknown>, actor: User): Organization {
    const organization = this.store.organizations.get(organizationId);
    if (!organization) {
      throw new Error('Organization not found.');
    }
    const tier = typeof body.billingTier === 'string' ? body.billingTier : organization.billingTier ?? 'free';
    const status = typeof body.billingStatus === 'string' ? body.billingStatus : organization.billingStatus ?? 'trialing';
    if (tier !== 'free' && tier !== 'pro' && tier !== 'team') {
      throw new Error('Invalid billing tier.');
    }
    if (status !== 'trialing' && status !== 'active' && status !== 'past_due' && status !== 'cancelled') {
      throw new Error('Invalid billing status.');
    }
    organization.billingTier = tier;
    organization.billingStatus = status;
    organization.billingCustomerId = typeof body.billingCustomerId === 'string' ? body.billingCustomerId : organization.billingCustomerId;
    organization.billingSubscriptionId = typeof body.billingSubscriptionId === 'string' ? body.billingSubscriptionId : organization.billingSubscriptionId;
    organization.updatedAt = nowIso();
    this.audit.record(actor.id, 'billing.organization_updated', { organizationId, tier, status });
    return organization;
  }

  private monitoringSignals() {
    const timestamp = nowIso();
    const authFailures = this.store.auditEvents.filter((event) => event.action.includes('login') || event.action.includes('password_reset')).length;
    const failedDeployments = this.failedDeployments().length;
    const pendingDomains = this.platformDomainStatus().filter((domain) => !domain.verified).length;
    const certificateFailures = this.platformDomainStatus().filter((domain) => domain.certificateStatus === 'failed').length;
    const runnerDegraded = this.runnerHealth().filter((runner) => runner.status === 'degraded').length;
    const storageFailures = [...this.store.uploadSessions.values()].filter((session) => session.scannerStatus === 'failed').length;
    return [
      { id: 'monitor_auth', component: 'auth', severity: authFailures > 50 ? 'warning' : 'ok', message: `${authFailures} recent auth audit events`, observedAt: timestamp, runbookUrl: 'docs/operations.md#auth-monitoring' },
      { id: 'monitor_deployments', component: 'deployments', severity: failedDeployments > 0 ? 'warning' : 'ok', message: `${failedDeployments} failed deployments`, observedAt: timestamp, runbookUrl: 'docs/operations.md#deployment-monitoring' },
      { id: 'monitor_dns', component: 'dns', severity: pendingDomains > 0 ? 'warning' : 'ok', message: `${pendingDomains} domains pending verification`, observedAt: timestamp, runbookUrl: 'docs/operations.md#dns-monitoring' },
      { id: 'monitor_certificates', component: 'certificates', severity: certificateFailures > 0 ? 'critical' : 'ok', message: `${certificateFailures} certificate failures`, observedAt: timestamp, runbookUrl: 'docs/operations.md#certificate-monitoring' },
      { id: 'monitor_runners', component: 'runners', severity: runnerDegraded > 0 ? 'critical' : 'ok', message: `${runnerDegraded} degraded runners`, observedAt: timestamp, runbookUrl: 'docs/operations.md#runner-monitoring' },
      { id: 'monitor_storage', component: 'storage', severity: storageFailures > 0 ? 'critical' : 'ok', message: `${storageFailures} failed upload scanner sessions`, observedAt: timestamp, runbookUrl: 'docs/operations.md#storage-monitoring' },
    ];
  }

  private async handleAcmeChallengeRoute(method: string, route: RouteMatch, request: ApiRequest): Promise<ApiResponse> {
    this.requireAcmeAutomationToken(request);
    if (method !== 'POST' || !route.segments[2] || (route.segments[3] !== 'present' && route.segments[3] !== 'cleanup')) {
      return this.error(404, 'not_found', 'ACME challenge endpoint not found.');
    }

    const domain = this.findDelegatedDomainForAcme(route.segments[2]);
    const body = this.requiredObject(request.body);
    const recordName = this.stringField(body, 'recordName', 'ACME challenge recordName is required.');

    if (route.segments[3] === 'cleanup') {
      await this.managedDns.deleteAcmeChallengeRecord(domain, recordName);
      return this.ok({ ok: true, hostname: domain.hostname, recordName });
    }

    const value = this.stringField(body, 'value', 'ACME challenge value is required.');
    await this.managedDns.createAcmeChallengeRecord(domain, value, recordName);
    return this.ok({ ok: true, hostname: domain.hostname, recordName });
  }

  private requireAcmeAutomationToken(request: ApiRequest): void {
    const configured = process.env.ACME_DNS01_AUTOMATION_TOKEN?.trim();
    if (!configured) {
      throw new Error('ACME DNS-01 automation is not configured.');
    }
    const provided = (request.headers?.authorization ?? request.headers?.Authorization ?? request.headers?.['x-divband-acme-token'])?.replace(/^Bearer\s+/i, '').trim();
    if (provided !== configured) {
      throw new Error('ACME DNS-01 automation token is invalid.');
    }
  }

  private findDelegatedDomainForAcme(hostname: string): ProjectDomain {
    const normalized = hostname.trim().toLowerCase();
    const domain = [...this.store.projects.values()]
      .flatMap((project) => project.domains)
      .filter((candidate) => this.isDelegatedDnsMode(candidate.dnsMode) && candidate.providerZoneId)
      .sort((a, b) => b.hostname.length - a.hostname.length)
      .find((candidate) => normalized === candidate.hostname || normalized.endsWith(`.${candidate.hostname}`));
    if (!domain) {
      throw new Error(`No delegated managed DNS zone is available for ${normalized}.`);
    }
    return domain;
  }

  private isAcmeChallengeRoute(route: RouteMatch): boolean {
    return route.segments[0] === 'internal' && route.segments[1] === 'acme-challenges';
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

    return { email: record.email, name: record.name, password: record.password, inviteCode: typeof record.inviteCode === 'string' ? record.inviteCode : undefined };
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

  private sourceControlIdentityInput(body: unknown, fallbackProvider: 'gitlab' | 'github'): LinkGitLabIdentityInput {
    const record = this.requiredObject(body);
    const username = typeof record.username === 'string' ? record.username : typeof record.login === 'string' ? record.login : '';
    const provider = record.provider === 'gitlab' || record.provider === 'github' ? record.provider : fallbackProvider;
    const gitlabUserId = typeof record.gitlabUserId === 'string'
      ? record.gitlabUserId
      : typeof record.githubUserId === 'string'
        ? record.githubUserId
        : username;
    if (!gitlabUserId || !username) {
      throw new Error('Source-control identity requires username and user id.');
    }
    return {
      provider,
      gitlabUserId,
      username,
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

let defaultBackendService: BackendService | undefined;

export const backendService = {
  handle(request: ApiRequest): Promise<ApiResponse> {
    defaultBackendService ??= new BackendService();
    return defaultBackendService.handle(request);
  },
};

export function handleApiRequest(request: ApiRequest): Promise<ApiResponse> {
  return backendService.handle(request);
}
