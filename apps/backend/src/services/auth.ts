import { roleAtLeast } from '@divband/auth';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import type { ApiToken, AuthActor, AuthSession, EmailVerificationChallenge, GitLabIdentityLink, OAuthIdentity, PasswordResetChallenge, ProjectMembership, User } from '../models.ts';
import type { BackendStore } from '../store.ts';
import { createId, nowIso } from '../utils.ts';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
  inviteCode?: string;
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
  emailVerificationToken?: string;
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
  provider?: 'gitlab' | 'github';
  gitlabUserId: string;
  username: string;
  accessToken?: string;
}

export class AuthService {
  private readonly tokenPepper: string;
  private readonly signupMode: 'invite_only' | 'public';
  private readonly inviteCodes: Set<string>;
  private readonly exposeRecoveryTokens: boolean;
  private readonly requireEmailVerification: boolean;

  constructor(private readonly store: BackendStore, env: Record<string, string | undefined> = process.env) {
    this.tokenPepper = env.DIVBAND_TOKEN_HASH_PEPPER?.trim() || 'divband-local-development-token-pepper';
    this.signupMode = env.DIVBAND_SIGNUP_MODE === 'public' ? 'public' : 'invite_only';
    this.inviteCodes = new Set((env.DIVBAND_SIGNUP_INVITE_CODES ?? '').split(',').map((code) => code.trim()).filter(Boolean));
    this.exposeRecoveryTokens = env.DIVBAND_EXPOSE_AUTH_TOKENS === '1' || env.NODE_ENV !== 'production';
    this.requireEmailVerification = !['0', 'false', 'no', 'off'].includes((env.DIVBAND_REQUIRE_EMAIL_VERIFICATION ?? '1').toLowerCase());
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
    this.requireSignupAllowed(input.inviteCode);

    const user: User = {
      id: createId('user'),
      email,
      name: input.name.trim() || email,
      createdAt: nowIso(),
      signupInviteCode: input.inviteCode?.trim(),
      billingTier: 'free',
      billingStatus: 'trialing',
    };

    this.store.users.set(user.id, user);
    this.store.usersByEmail.set(email, user.id);
    this.store.passwordHashesByUserId.set(user.id, this.hashPassword(input.password));
    const verification = this.createEmailVerificationChallenge(user);

    return { user, ...this.createSession(user.id), tokenType: 'Bearer', emailVerificationToken: this.exposeRecoveryTokens ? verification.token : undefined };
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

    if (this.requireEmailVerification && !user.emailVerifiedAt) {
      throw new Error('Email verification is required before login.');
    }

    if (this.needsPasswordRehash(expectedHash)) {
      this.store.passwordHashesByUserId.set(user.id, this.hashPassword(input.password));
    }

    return { user, ...this.createSession(user.id), tokenType: 'Bearer' };
  }


  verifyEmail(token: string): User {
    const tokenHash = this.hashToken(token.trim());
    const challenge = [...this.store.emailVerificationChallenges.values()].find((item) => item.tokenHash === tokenHash && !item.verifiedAt);
    if (!challenge || Date.parse(challenge.expiresAt) <= Date.now()) {
      throw new Error('Email verification token is invalid or expired.');
    }
    const user = this.store.users.get(challenge.userId);
    if (!user) {
      throw new Error('Email verification token is invalid or expired.');
    }
    const timestamp = nowIso();
    challenge.verifiedAt = timestamp;
    user.emailVerifiedAt = timestamp;
    return user;
  }

  requestPasswordReset(emailInput: string): { challenge?: PasswordResetChallenge; token?: string } {
    const email = emailInput.trim().toLowerCase();
    const userId = this.store.usersByEmail.get(email);
    if (!userId) {
      return {};
    }
    const token = this.createOpaqueToken('reset');
    const challenge: PasswordResetChallenge = {
      id: createId('password_reset'),
      userId,
      tokenHash: this.hashToken(token),
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString(),
    };
    this.store.passwordResetChallenges.set(challenge.id, challenge);
    return { challenge, token: this.exposeRecoveryTokens ? token : undefined };
  }

  resetPassword(token: string, password: string): User {
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    const tokenHash = this.hashToken(token.trim());
    const challenge = [...this.store.passwordResetChallenges.values()].find((item) => item.tokenHash === tokenHash && !item.usedAt);
    if (!challenge || Date.parse(challenge.expiresAt) <= Date.now()) {
      throw new Error('Password reset token is invalid or expired.');
    }
    const user = this.store.users.get(challenge.userId);
    if (!user) {
      throw new Error('Password reset token is invalid or expired.');
    }
    challenge.usedAt = nowIso();
    this.store.passwordHashesByUserId.set(user.id, this.hashPassword(password));
    for (const session of this.store.sessions.values()) {
      if (session.userId === user.id) {
        session.revokedAt = challenge.usedAt;
      }
    }
    return user;
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
      if (user.suspendedAt) {
        throw new Error('User account is suspended.');
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
      if (user.suspendedAt) {
        throw new Error('User account is suspended.');
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
    const provider = input.provider ?? 'gitlab';
    const link: GitLabIdentityLink = {
      id: createId('gitlab_identity'),
      userId,
      provider,
      gitlabUserId: input.gitlabUserId.trim(),
      username: input.username.trim(),
      accessTokenHash: input.accessToken ? this.hashToken(input.accessToken) : undefined,
      accessToken: input.accessToken?.trim(),
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


  private requireSignupAllowed(inviteCode?: string): void {
    if (this.store.users.size === 0) {
      return;
    }
    if (this.signupMode === 'public') {
      return;
    }
    const trimmed = inviteCode?.trim();
    if (!trimmed || !this.inviteCodes.has(trimmed)) {
      throw new Error('Public signup is disabled; a valid invite code is required.');
    }
  }

  private createEmailVerificationChallenge(user: User): EmailVerificationChallenge & { token: string } {
    const token = this.createOpaqueToken('verify');
    const challenge: EmailVerificationChallenge = {
      id: createId('email_verification'),
      userId: user.id,
      tokenHash: this.hashToken(token),
      email: user.email,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString(),
    };
    this.store.emailVerificationChallenges.set(challenge.id, challenge);
    return { ...challenge, token };
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
    return `${prefix}_${Buffer.from(randomBytes(32)).toString('base64url')}`;
  }

  private hashToken(token: string): string {
    return `hmac-sha256:${createHmac('sha256', this.tokenPepper).update(token).digest('hex')}`;
  }

  private hashPassword(password: string): string {
    const salt = Buffer.from(randomBytes(16)).toString('base64');
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
