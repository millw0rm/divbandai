import { randomBytes } from 'node:crypto';
import dns from 'node:dns';
import process from 'node:process';
import type { SourceControlOAuthState } from '../models.ts';
import type { BackendStore } from '../store.ts';
import { createId, nowIso } from '../utils.ts';

dns.setDefaultResultOrder('ipv4first');

const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;
const LOCAL_GITHUB_OAUTH_CLIENT_ID = 'Ov23liDHwzB5QdOp80MA';
const LOCAL_GITHUB_OAUTH_CLIENT_SECRET = '8f4e25e8c3cb6dc117bd9a6c83c44335e8e086df';
const GITHUB_FETCH_ATTEMPTS = 3;
const GITHUB_FETCH_TIMEOUT_MS = 30_000;

interface GitHubOAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  id: number;
  login: string;
}

export interface GitHubOAuthStartResult {
  authorizationUrl: string;
  expiresAt: string;
}

export interface GitHubOAuthCallbackResult {
  userId: string;
  projectId?: string;
  githubUserId: string;
  username: string;
  accessToken: string;
  returnTo: string;
}

export class GitHubOAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl?: string;
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly apiUrl: string;

  constructor(private readonly store: BackendStore, env: Record<string, string | undefined> = process.env) {
    this.clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim() || LOCAL_GITHUB_OAUTH_CLIENT_ID;
    this.clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim() || LOCAL_GITHUB_OAUTH_CLIENT_SECRET;
    this.callbackUrl = env.GITHUB_OAUTH_CALLBACK_URL?.trim();
    this.authorizeUrl = env.GITHUB_OAUTH_AUTHORIZE_URL?.trim() || 'https://github.com/login/oauth/authorize';
    this.tokenUrl = env.GITHUB_OAUTH_TOKEN_URL?.trim() || 'https://github.com/login/oauth/access_token';
    this.apiUrl = (env.GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, '');
  }

  configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  usingCustomCredentials(): boolean {
    return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID?.trim() && process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim());
  }

  configuration(apiBaseUrl: string): {
    clientIdSource: 'custom' | 'bundled';
    clientIdPreview: string;
    callbackUrl: string;
  } {
    const redirectBase = apiBaseUrl.replace(/\/+$/, '');
    return {
      clientIdSource: this.usingCustomCredentials() ? 'custom' : 'bundled',
      clientIdPreview: `${this.clientId.slice(0, 8)}…`,
      callbackUrl: this.redirectUri(redirectBase),
    };
  }

  async checkServerReachable(): Promise<boolean> {
    try {
      const response = await githubFetch(`${this.apiUrl}/`, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'divband-oauth',
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  start(userId: string, apiBaseUrl: string, returnTo = '/#gitlab-repository-status', projectId?: string, publicOrigin?: string): GitHubOAuthStartResult {
    this.requireConfigured();
    const redirectBaseUrl = normalizePublicOrigin(publicOrigin) ?? apiBaseUrl.replace(/\/+$/, '');
    const state = Buffer.from(randomBytes(24)).toString('base64url');
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
    const record: SourceControlOAuthState = {
      id: createId('source_oauth_state'),
      provider: 'github',
      state,
      userId,
      projectId,
      returnTo: safeReturnTo(returnTo),
      redirectBaseUrl,
      createdAt: nowIso(),
      expiresAt,
    };
    this.store.sourceControlOAuthStates.set(state, record);

    const url = new URL(this.authorizeUrl);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri(redirectBaseUrl));
    url.searchParams.set('scope', 'read:user repo');
    url.searchParams.set('state', state);
    return { authorizationUrl: url.toString(), expiresAt };
  }

  async complete(code: string, state: string, apiBaseUrl: string, publicOrigin?: string): Promise<GitHubOAuthCallbackResult> {
    this.requireConfigured();
    const record = this.store.sourceControlOAuthStates.get(state);
    if (!record || record.usedAt || Date.parse(record.expiresAt) <= Date.now()) {
      throw new Error('GitHub authorization state is invalid or expired.');
    }

    const redirectBaseUrl = record.redirectBaseUrl ?? normalizePublicOrigin(publicOrigin) ?? apiBaseUrl.replace(/\/+$/, '');
    const redirectUri = this.redirectUri(redirectBaseUrl);
    const tokenBody = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const tokenResponse = await retryGitHubFetch(() => githubFetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'divband-oauth',
      },
      body: tokenBody.toString(),
    }));
    const tokenPayload = await tokenResponse.json() as GitHubOAuthTokenResponse;
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error(tokenPayload.error_description ?? tokenPayload.error ?? 'GitHub OAuth token exchange failed.');
    }

    const userResponse = await retryGitHubFetch(() => githubFetch(`${this.apiUrl}/user`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${tokenPayload.access_token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'divband-oauth',
      },
    }));
    if (!userResponse.ok) {
      throw new Error(`GitHub user lookup failed with ${userResponse.status}.`);
    }
    const githubUser = await userResponse.json() as GitHubUserResponse;
    record.usedAt = nowIso();

    return {
      userId: record.userId,
      projectId: record.projectId,
      githubUserId: String(githubUser.id),
      username: githubUser.login,
      accessToken: tokenPayload.access_token,
      returnTo: record.returnTo,
    };
  }

  private redirectUri(redirectBaseUrl: string): string {
    if (this.callbackUrl) {
      return this.callbackUrl;
    }
    return `${redirectBaseUrl.replace(/\/+$/, '')}/api/auth/callback/github`;
  }

  private requireConfigured(): void {
    if (!this.configured()) {
      throw new Error('GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.');
    }
  }
}

async function githubFetch(input: string, init: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });
}

async function retryGitHubFetch(request: () => Promise<Response>): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GITHUB_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (attempt < GITHUB_FETCH_ATTEMPTS) {
        await delay(300 * attempt);
      }
    }
  }
  throw new Error(formatGitHubNetworkError(lastError));
}

function formatGitHubNetworkError(error: unknown): string {
  const detail = networkErrorDetail(error);
  if (detail.includes('fetch failed') || detail.includes('ENOTFOUND') || detail.includes('ETIMEDOUT') || detail.includes('ECONNREFUSED')) {
    return `Could not reach GitHub from the server (${detail}). Ensure outbound HTTPS to github.com and api.github.com is allowed, your OAuth app callback URL matches ${'http://localhost:3000/api/auth/callback/github'}, and set GITHUB_OAUTH_CLIENT_ID/GITHUB_OAUTH_CLIENT_SECRET if you are not using the bundled local app.`;
  }
  return `GitHub request failed after ${GITHUB_FETCH_ATTEMPTS} attempts: ${detail}`;
}

function networkErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'network request failed';
  }
  const cause = error.cause instanceof Error ? error.cause.message : undefined;
  return cause ? `${error.message} (${cause})` : error.message;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeReturnTo(value: string): string {
  if (!value.startsWith('/')) {
    return '/#gitlab-repository-status';
  }
  if (value.startsWith('//')) {
    return '/#gitlab-repository-status';
  }
  return value;
}

function normalizePublicOrigin(value?: string): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}
