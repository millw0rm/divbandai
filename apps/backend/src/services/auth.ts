import { roleAtLeast } from '@divband/auth';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import type { ApiToken, AuthActor, AuthSession, GitLabIdentityLink, OAuthIdentity, ProjectMembership, User } from '../models.ts';
import type { BackendStore } from '../store.ts';
import { createId, nowIso } from '../utils.ts';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: User;
  session: AuthSession;
  token: string;
  tokenType: 'Bearer';
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
  private readonly tokenPepper: string;

  constructor(private readonly store: BackendStore, env: Record<string, string | undefined> = process.env) {
    this.tokenPepper = env.DIVBAND_TOKEN_HASH_PEPPER?.trim() || 'divband-local-development-token-pepper';
  }

  register(input: RegisterInput): AuthResult {
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
    this.store.passwordHashesByUserId.set(user.id, this.hashPassword(input.password));

    return { user, ...this.createSession(user.id), tokenType: 'Bearer' };
  }

  login(input: LoginInput): AuthResult {
    const email = input.email.trim().toLowerCase();
    const userId = this.store.usersByEmail.get(email);
    if (!userId) {
      throw new Error('Invalid email or password.');
    }

    const expectedHash = this.store.passwordHashesByUserId.get(userId);
    if (!expectedHash || !this.verifyPassword(input.password, expectedHash)) {
      throw new Error('Invalid email or password.');
    }

    const user = this.store.users.get(userId);
    if (!user) {
      throw new Error('Invalid email or password.');
    }

    if (this.needsPasswordRehash(expectedHash)) {
      this.store.passwordHashesByUserId.set(user.id, this.hashPassword(input.password));
    }

    return { user, ...this.createSession(user.id), tokenType: 'Bearer' };
  }

  authenticate(authorizationHeader?: string): AuthActor {
    this.cleanupExpiredSessions();
    const token = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice('Bearer '.length).trim() : undefined;
    if (!token) {
      throw new Error('Authentication is required.');
    }

    const tokenHash = this.hashToken(token);
    const session = this.store.sessions.get(tokenHash);
    if (session && !session.revokedAt && Date.parse(session.expiresAt) > Date.now()) {
      const user = this.store.users.get(session.userId);
      if (!user) {
        throw new Error('Authentication is required.');
      }
      session.lastSeenAt = nowIso();
      return { user, session, platformAdmin: this.platformAdminForUser(user.id) };
    }

    const apiToken = this.findApiToken(tokenHash);
    if (apiToken && !apiToken.revokedAt && (!apiToken.expiresAt || Date.parse(apiToken.expiresAt) > Date.now())) {
      const user = this.store.users.get(apiToken.userId);
      if (!user) {
        throw new Error('Authentication is required.');
      }
      apiToken.lastUsedAt = nowIso();
      return { user, apiToken, platformAdmin: this.platformAdminForUser(user.id) };
    }

    throw new Error('Authentication is required.');
  }

  createApiToken(userId: string, input: CreateApiTokenInput): { apiToken: ApiToken; token: string } {
    const token = this.createOpaqueToken('api');
    const apiToken: ApiToken = {
      id: createId('api_token'),
      tokenHash: this.hashToken(token),
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

  revokeCurrentSession(actor: AuthActor): AuthSession {
    if (!actor.session) {
      throw new Error('Only bearer sessions can be revoked with this endpoint.');
    }
    actor.session.revokedAt = nowIso();
    return actor.session;
  }

  revokeSession(userId: string, sessionId: string): AuthSession {
    const session = [...this.store.sessions.values()].find((candidate) => candidate.id === sessionId && candidate.userId === userId);
    if (!session) {
      throw new Error('Session not found.');
    }
    session.revokedAt = nowIso();
    return session;
  }

  cleanupExpiredSessions(referenceTime: number = Date.now()): number {
    let deleted = 0;
    for (const [tokenHash, session] of this.store.sessions.entries()) {
      if (Date.parse(session.expiresAt) <= referenceTime) {
        this.store.sessions.delete(tokenHash);
        deleted += 1;
      }
    }
    return deleted;
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
      accessTokenHash: input.accessToken ? this.hashToken(input.accessToken) : undefined,
      linkedAt: nowIso(),
    };
    this.store.gitlabIdentityLinks.set(link.id, link);
    return link;
  }

  platformAdminForUser(userId: string) {
    return [...this.store.platformAdmins.values()].find((admin) => admin.userId === userId && !admin.revokedAt);
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

  private createSession(userId: string): { session: AuthSession; token: string } {
    this.cleanupExpiredSessions();
    const token = this.createOpaqueToken('session');
    const session: AuthSession = {
      id: createId('session'),
      tokenHash: this.hashToken(token),
      userId,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
    this.store.sessions.set(session.tokenHash, session);
    return { session, token };
  }

  private findApiToken(tokenHash: string): ApiToken | undefined {
    return [...this.store.apiTokens.values()].find((apiToken) => apiToken.tokenHash === tokenHash);
  }

  private createOpaqueToken(prefix: string): string {
    return `${prefix}_${randomBytes(32).toString('base64url')}`;
  }

  private hashToken(token: string): string {
    return `hmac-sha256:${createHmac('sha256', this.tokenPepper).update(token).digest('hex')}`;
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('base64');
    const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
    return `scrypt:v1:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${Buffer.from(derived).toString('base64')}`;
  }

  private verifyPassword(password: string, encodedHash: string): boolean {
    if (encodedHash.startsWith('local-dev:')) {
      return encodedHash === this.legacyHashSecret(password);
    }
    const [scheme, version, n, r, p, salt, expected] = encodedHash.split(':');
    if (scheme !== 'scrypt' || version !== 'v1' || !salt || !expected) {
      return false;
    }
    const candidate = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    const expectedBytes = Buffer.from(expected, 'base64');
    return expectedBytes.length === candidate.length && timingSafeEqual(expectedBytes, candidate);
  }

  private needsPasswordRehash(encodedHash: string): boolean {
    return encodedHash.startsWith('local-dev:');
  }

  private legacyHashSecret(secret: string): string {
    let hash = 0;
    for (const char of secret) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    return `local-dev:${hash.toString(16)}:${secret.length}`;
  }
}
