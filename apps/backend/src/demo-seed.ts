import type { ProjectRole } from '@divband/auth';
import { BackendService } from './backend-service.ts';
import type { PlatformAdminRole, Project, User } from './models.ts';
import type { BackendStore } from './store.ts';

export const demoPassword = 'DemoPass123!';

const demoAccounts = {
  superAdmin: { email: 'demo.superadmin@divband.test', name: 'Demo Super Admin' },
  support: { email: 'demo.support@divband.test', name: 'Demo Support Admin' },
  security: { email: 'demo.security@divband.test', name: 'Demo Security Admin' },
  owner: { email: 'demo.owner@divband.test', name: 'Demo Project Owner' },
  admin: { email: 'demo.admin@divband.test', name: 'Demo Project Admin' },
  developer: { email: 'demo.developer@divband.test', name: 'Demo Project Developer' },
  viewer: { email: 'demo.viewer@divband.test', name: 'Demo Project Viewer' },
} as const;

export interface DemoSeedResult {
  password: string;
  project: Pick<Project, 'id' | 'slug' | 'platformHostname'>;
  accounts: {
    superAdmin: string;
    support: string;
    security: string;
    owner: string;
    admin: string;
    developer: string;
    viewer: string;
  };
}

interface DemoUser {
  user: User;
  token: string;
}

export async function seedDemoData(store: BackendStore, options: { enabled?: boolean; env?: Record<string, string | undefined> } = {}): Promise<DemoSeedResult | undefined> {
  if (options.enabled === false) {
    return undefined;
  }
  const env = options.env ?? process.env;

  const backend = new BackendService(store, {
    apiBaseUrl: 'http://localhost:3000',
    publicSiteDomain: 'localhost.test',
    requireEmailVerification: false,
  });

  const superAdmin = await ensureDemoUser(backend, demoAccounts.superAdmin);
  const support = await ensureDemoUser(backend, demoAccounts.support);
  const security = await ensureDemoUser(backend, demoAccounts.security);
  const owner = await ensureDemoUser(backend, demoAccounts.owner);
  const admin = await ensureDemoUser(backend, demoAccounts.admin);
  const developer = await ensureDemoUser(backend, demoAccounts.developer);
  const viewer = await ensureDemoUser(backend, demoAccounts.viewer);

  await ensurePlatformAdmin(backend, superAdmin.token, support.user.id, 'support');
  await ensurePlatformAdmin(backend, superAdmin.token, security.user.id, 'security');
  await ensureDemoGitHubIdentity(backend, owner.token, env);

  const project = await ensureDemoProject(backend, owner.token);
  await ensureProjectMember(backend, owner.token, project.id, admin.user.id, 'admin');
  await ensureProjectMember(backend, owner.token, project.id, developer.user.id, 'developer');
  await ensureProjectMember(backend, owner.token, project.id, viewer.user.id, 'viewer');
  await request(backend, 'POST', `/projects/${project.id}/platform-subdomain`, {}, owner.token);

  return {
    password: demoPassword,
    project: {
      id: project.id,
      slug: project.slug,
      platformHostname: project.platformHostname,
    },
    accounts: {
      superAdmin: superAdmin.user.email,
      support: support.user.email,
      security: security.user.email,
      owner: owner.user.email,
      admin: admin.user.email,
      developer: developer.user.email,
      viewer: viewer.user.email,
    },
  };
}

async function ensureDemoUser(backend: BackendService, account: { email: string; name: string }): Promise<DemoUser> {
  const login = await tryRequest<{ user: User; token: string }>(backend, 'POST', '/auth/login', {
    email: account.email,
    password: demoPassword,
  });
  if (login) {
    return { user: login.user, token: login.token };
  }

  const registered = await request<{ user: User; token: string }>(backend, 'POST', '/auth/register', {
    email: account.email,
    name: account.name,
    password: demoPassword,
  });
  return { user: registered.user, token: registered.token };
}

async function ensurePlatformAdmin(backend: BackendService, superAdminToken: string, userId: string, role: PlatformAdminRole): Promise<void> {
  await request(backend, 'POST', '/admin/platform-admins', { userId, role }, superAdminToken);
}

async function ensureDemoProject(backend: BackendService, ownerToken: string): Promise<Project> {
  const existing = await request<{ projects: Project[] }>(backend, 'GET', '/projects', undefined, ownerToken);
  const project = existing.projects.find((candidate) => candidate.slug === 'demo-role-test');
  if (project) {
    return project;
  }

  const created = await request<{ project: Project }>(backend, 'POST', '/projects', {
    name: 'Demo Role Test Project',
    slug: 'demo-role-test',
  }, ownerToken);
  return created.project;
}

async function ensureProjectMember(backend: BackendService, ownerToken: string, projectId: string, userId: string, role: ProjectRole): Promise<void> {
  await request(backend, 'PUT', `/projects/${projectId}/members`, { userId, role }, ownerToken);
}

async function ensureDemoGitHubIdentity(backend: BackendService, ownerToken: string, env: Record<string, string | undefined>): Promise<void> {
  const accessToken = env.DIVBAND_DEMO_GITHUB_TOKEN?.trim();
  const username = env.DIVBAND_DEMO_GITHUB_USERNAME?.trim();
  if (!accessToken || !username) {
    return;
  }

  await request(backend, 'POST', '/auth/github-identity', {
    username,
    githubUserId: env.DIVBAND_DEMO_GITHUB_USER_ID?.trim() || username,
    accessToken,
  }, ownerToken);
}

async function tryRequest<T>(backend: BackendService, method: string, path: string, body?: unknown, token?: string): Promise<T | undefined> {
  const response = await backend.handle({
    method,
    path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  });
  return response.status >= 400 ? undefined : response.body as T;
}

async function request<T = unknown>(backend: BackendService, method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const response = await backend.handle({
    method,
    path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  });
  if (response.status >= 400) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(response.body)}`);
  }
  return response.body as T;
}
