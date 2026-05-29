import { roleAtLeast } from '@divband/auth';
import type { ApiToken, AuthActor, AuthSession, GitLabIdentityLink, OAuthIdentity, ProjectMembership, User } from '../models';
import type { BackendStore } from '../store';
import { createId, nowIso } from '../utils';

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CreateApiTokenInput {
  name: string;
  projectId?: string;
  role?: ApiToken['role'];
  expiresAt?: string;
}

export interface LinkOAuthIdentityInput {
  provider: OAuthIdentity['provider'];
  issuer: string;
  subject: string;
  email?: string;
}

export interface LinkGitLabIdentityInput {
  gitlabUserId: string;
  username: string;
  accessToken?: string;
}

export class AuthService {
  constructor(private readonly store: BackendStore) {}

  register(input: RegisterInput): { user: User; session: AuthSession } {
    const email = input.email.trim().toLowerCase();
    if (!email.includes('@')) {
      throw new Error('A valid email address is required.');
    }
    if (input.password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    if (this.store.usersByEmail.has(email)) {
      throw new Error('A user with this email already exists.');
    }

    const user: User = {
      id: createId('user'),
      email,
      name: input.name.trim() || email,
      createdAt: nowIso(),
    };

    this.store.users.set(user.id, user);
    this.store.usersByEmail.set(email, user.id);
    this.store.passwordHashesByUserId.set(user.id, this.hashSecret(input.password));

    return { user, session: this.createSession(user.id) };
  }

  login(input: LoginInput): { user: User; session: AuthSession } {
    const email = input.email.trim().toLowerCase();
    const userId = this.store.usersByEmail.get(email);
    if (!userId) {
      throw new Error('Invalid email or password.');
    }

    const expectedHash = this.store.passwordHashesByUserId.get(userId);
    if (expectedHash !== this.hashSecret(input.password)) {
      throw new Error('Invalid email or password.');
    }

    const user = this.store.users.get(userId);
    if (!user) {
      throw new Error('Invalid email or password.');
    }

    return { user, session: this.createSession(user.id) };
  }

  authenticate(authorizationHeader?: string): AuthActor {
    const token = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice('Bearer '.length) : undefined;
    if (!token) {
      throw new Error('Authentication is required.');
    }

    const session = this.store.sessions.get(token);
    if (session && !session.revokedAt && Date.parse(session.expiresAt) > Date.now()) {
      const user = this.store.users.get(session.userId);
      if (!user) {
        throw new Error('Authentication is required.');
      }
      session.lastSeenAt = nowIso();
      return { user, session };
    }

    const apiToken = this.findApiToken(token);
    if (apiToken && !apiToken.revokedAt && (!apiToken.expiresAt || Date.parse(apiToken.expiresAt) > Date.now())) {
      const user = this.store.users.get(apiToken.userId);
      if (!user) {
        throw new Error('Authentication is required.');
      }
      apiToken.lastUsedAt = nowIso();
      return { user, apiToken };
    }

    throw new Error('Authentication is required.');
  }

  createApiToken(userId: string, input: CreateApiTokenInput): { apiToken: ApiToken; token: string } {
    const token = createId('api_token_secret');
    const apiToken: ApiToken = {
      id: createId('api_token'),
      tokenHash: this.hashSecret(token),
      name: input.name.trim() || 'API token',
      userId,
      projectId: input.projectId,
      role: input.role,
      createdAt: nowIso(),
      expiresAt: input.expiresAt,
    };
    this.store.apiTokens.set(apiToken.id, apiToken);
    return { apiToken, token };
  }

  revokeApiToken(userId: string, tokenId: string): ApiToken {
    const apiToken = this.store.apiTokens.get(tokenId);
    if (!apiToken || apiToken.userId !== userId) {
      throw new Error('API token not found.');
    }
    apiToken.revokedAt = nowIso();
    return apiToken;
  }

  linkOAuthIdentity(userId: string, input: LinkOAuthIdentityInput): OAuthIdentity {
    const identity: OAuthIdentity = {
      id: createId('oauth_identity'),
      userId,
      provider: input.provider,
      issuer: input.issuer.trim(),
      subject: input.subject.trim(),
      email: input.email?.trim().toLowerCase(),
      linkedAt: nowIso(),
    };
    this.store.oauthIdentities.set(identity.id, identity);
    return identity;
  }

  linkGitLabIdentity(userId: string, input: LinkGitLabIdentityInput): GitLabIdentityLink {
    const link: GitLabIdentityLink = {
      id: createId('gitlab_identity'),
      userId,
      gitlabUserId: input.gitlabUserId.trim(),
      username: input.username.trim(),
      accessTokenHash: input.accessToken ? this.hashSecret(input.accessToken) : undefined,
      linkedAt: nowIso(),
    };
    this.store.gitlabIdentityLinks.set(link.id, link);
    return link;
  }

  projectMembershipFor(actor: AuthActor, projectId: string): ProjectMembership | undefined {
    const userMembership = [...this.store.projectMemberships.values()].find(
      (membership) => membership.projectId === projectId && membership.userId === actor.user.id,
    );
    if (!userMembership || !actor.apiToken) {
      return userMembership;
    }
    if (actor.apiToken.projectId && actor.apiToken.projectId !== projectId) {
      return undefined;
    }
    if (!actor.apiToken.role) {
      return userMembership;
    }

    const effectiveRole = roleAtLeast(userMembership.role, actor.apiToken.role) ? actor.apiToken.role : userMembership.role;
    return { ...userMembership, role: effectiveRole };
  }

  private createSession(userId: string): AuthSession {
    const session: AuthSession = {
      token: createId('session'),
      userId,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
    };
    this.store.sessions.set(session.token, session);
    return session;
  }

  private findApiToken(token: string): ApiToken | undefined {
    const tokenHash = this.hashSecret(token);
    return [...this.store.apiTokens.values()].find((apiToken) => apiToken.tokenHash === tokenHash);
  }

  private hashSecret(secret: string): string {
    let hash = 0;
    for (const char of secret) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    return `local-dev:${hash.toString(16)}:${secret.length}`;
  }
}
