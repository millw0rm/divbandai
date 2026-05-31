import { randomBytes } from 'node:crypto';
import process from 'node:process';
import type { SourceControlOAuthState } from '../models.ts';
import type { BackendStore } from '../store.ts';
import { createId, nowIso } from '../utils.ts';

const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;
const LOCAL_GITHUB_OAUTH_CLIENT_ID = 'Ov23liDHwzB5QdOp80MA';
const LOCAL_GITHUB_OAUTH_CLIENT_SECRET = 'eedee415eebc1e585ac130df0d9893c3ae681107';
const GITHUB_FETCH_ATTEMPTS = 3;

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

  start(userId: string, apiBaseUrl: string, returnTo = '/#gitlab-repository-status', projectId?: string): GitHubOAuthStartResult {
    this.requireConfigured();
    const state = Buffer.from(randomBytes(24)).toString('base64url');
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
    const record: SourceControlOAuthState = {
      id: createId('source_oauth_state'),
      provider: 'github',
      state,
      userId,
      projectId,
      returnTo: safeReturnTo(returnTo),
      createdAt: nowIso(),
      expiresAt,
    };
    this.store.sourceControlOAuthStates.set(state, record);

    const url = new URL(this.authorizeUrl);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri(apiBaseUrl));
    url.searchParams.set('scope', 'repo');
    url.searchParams.set('state', state);
    return { authorizationUrl: url.toString(), expiresAt };
  }

  async complete(code: string, state: string, apiBaseUrl: string): Promise<GitHubOAuthCallbackResult> {
    this.requireConfigured();
    const record = this.store.sourceControlOAuthStates.get(state);
    if (!record || record.usedAt || Date.parse(record.expiresAt) <= Date.now()) {
      throw new Error('GitHub authorization state is invalid or expired.');
    }

    const tokenResponse = await retryGitHubFetch(() => fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri(apiBaseUrl),
        state,
      }),
    }));
    const tokenBody = await tokenResponse.json() as GitHubOAuthTokenResponse;
    if (!tokenResponse.ok || !tokenBody.access_token) {
      throw new Error(tokenBody.error_description ?? tokenBody.error ?? 'GitHub OAuth token exchange failed.');
    }

    const userResponse = await retryGitHubFetch(() => fetch(`${this.apiUrl}/user`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${tokenBody.access_token}`,
        'x-github-api-version': '2022-11-28',
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
      accessToken: tokenBody.access_token,
      returnTo: record.returnTo,
    };
  }

  private redirectUri(apiBaseUrl: string): string {
    return this.callbackUrl || `${apiBaseUrl.replace(/\/+$/, '')}/api/auth/callback/github`;
  }

  private requireConfigured(): void {
    if (!this.configured()) {
      throw new Error('GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.');
    }
  }
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
  const message = lastError instanceof Error ? lastError.message : 'network request failed';
  throw new Error(`GitHub request failed after ${GITHUB_FETCH_ATTEMPTS} attempts: ${message}`);
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
