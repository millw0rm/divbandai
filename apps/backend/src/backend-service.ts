import { can, assignableRoles, type ProjectPermission, type ProjectRole } from '@divband/auth';
import { createProjectLifecyclePlan, type ProjectStatus } from './project-lifecycle';
import type {
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  ApiToken,
  AuthActor,
  Deployment,
  EnvironmentVariable,
  GitLabIdentityLink,
  OAuthIdentity,
  Organization,
  OrganizationMembership,
  Project,
  ProjectDomain,
  ProjectMembership,
  User,
} from './models';
import { defaultStore, type BackendStore } from './store';
import { AuthService, type CreateApiTokenInput, type LinkGitLabIdentityInput, type LinkOAuthIdentityInput, type LoginInput, type RegisterInput } from './services/auth';
import { AuditLogService } from './services/audit-log';
import { CertificateStatusService } from './services/certificate-status';
import { DeploymentStatusService } from './services/deployment-status';
import { DnsVerificationService } from './services/dns-verification';
import { GitLabService } from './services/gitlab';
import { KubernetesService } from './services/kubernetes';
import { createId, maskSecret, normalizeSlug, nowIso } from './utils';

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

  constructor(private readonly store: BackendStore = defaultStore) {
    this.auth = new AuthService(store);
    this.audit = new AuditLogService(store);
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    try {
      const route = this.parsePath(request.path);
      const method = request.method.toUpperCase();

      if (method === 'POST' && this.matches(route, 'auth', 'register')) {
        const result = this.auth.register(this.registerInput(request.body));
        this.ensurePersonalOrganization(result.user);
        this.audit.record(result.user.id, 'user.registered', { email: result.user.email });
        return this.created(result);
      }

      if (method === 'POST' && this.matches(route, 'auth', 'login')) {
        const result = this.auth.login(this.loginInput(request.body));
        this.audit.record(result.user.id, 'user.logged_in', { email: result.user.email });
        return this.ok(result);
      }

      const actor = this.auth.authenticate(request.headers?.authorization ?? request.headers?.Authorization);
      const user = actor.user;

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

        if (method === 'GET' && route.segments[2] === 'deployments' && route.segments[3]) {
          const { project } = this.requireProject(projectId, actor, 'project:read');
          return this.ok({ deployment: this.requireDeployment(project, route.segments[3]) });
        }

        if (method === 'GET' && this.matches(route, 'projects', projectId, 'logs')) {
          const { project } = this.requireProject(projectId, actor, 'project:read');
          return this.ok({ deployments: project.deployments.map(({ id, state, logs }) => ({ id, state, logs })) });
        }

        if (method === 'GET' && this.matches(route, 'projects', projectId, 'environment-variables')) {
          const { project } = this.requireProject(projectId, actor, 'secret:read');
          return this.ok({ environmentVariables: project.environmentVariables.map((variable) => ({ ...variable, value: maskSecret(variable.value) })) });
        }

        if (method === 'PUT' && this.matches(route, 'projects', projectId, 'environment-variables')) {
          const { project } = this.requireProject(projectId, actor, 'secret:manage');
          return this.ok({ environmentVariables: this.upsertEnvironmentVariables(project, user, this.requiredObject(request.body)) });
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
      environmentVariables: [],
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
    const repository = await this.gitlab.createRepository(project);
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

  private upsertEnvironmentVariables(project: Project, user: User, body: Record<string, unknown>): EnvironmentVariable[] {
    const variables = Array.isArray(body.variables) ? body.variables : [];
    for (const rawVariable of variables) {
      if (!this.isRecord(rawVariable) || typeof rawVariable.key !== 'string' || typeof rawVariable.value !== 'string') {
        throw new Error('Each environment variable requires a string key and value.');
      }

      const key = rawVariable.key.trim().toUpperCase();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment variable key: ${rawVariable.key}`);
      }

      const existing = project.environmentVariables.find((variable) => variable.key === key);
      const next: EnvironmentVariable = {
        key,
        value: rawVariable.value,
        protected: rawVariable.protected === true,
        updatedAt: nowIso(),
      };

      if (existing) {
        Object.assign(existing, next);
      } else {
        project.environmentVariables.push(next);
      }
    }

    this.touch(project);
    this.audit.record(user.id, 'project.environment_variables_updated', { keys: variables.length }, project.id);
    return project.environmentVariables.map((variable) => ({ ...variable, value: maskSecret(variable.value) }));
  }

  private deleteEnvironmentVariable(project: Project, user: User, key: string): EnvironmentVariable[] {
    project.environmentVariables = project.environmentVariables.filter((variable) => variable.key !== key.toUpperCase());
    this.touch(project);
    this.audit.record(user.id, 'project.environment_variable_deleted', { key: key.toUpperCase() }, project.id);
    return project.environmentVariables.map((variable) => ({ ...variable, value: maskSecret(variable.value) }));
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
