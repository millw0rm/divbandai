'use client';

import { FormEvent, useEffect, useState } from 'react';
import { clearAuthToken, getAuthToken, hasAuthToken, setAuthSession } from './auth-session';

type AuthMode = 'sign-in' | 'sign-up';

interface AuthPayload {
  token?: string;
  user?: Record<string, unknown>;
  error?: { message?: string };
}

async function readAuthPayload(response: Response): Promise<AuthPayload> {
  const raw = await response.text();
  if (!raw.trim()) {
    return { error: { message: `Request failed with ${response.status}.` } };
  }
  try {
    return JSON.parse(raw) as AuthPayload;
  } catch {
    return { error: { message: raw.slice(0, 200) || `Request failed with ${response.status}.` } };
  }
}

async function completeAuth(payload: AuthPayload): Promise<void> {
  if (!payload.token) {
    throw new Error(payload.error?.message ?? 'Authentication failed.');
  }
  setAuthSession(payload.token, payload.user);
  globalThis.location.assign('/dashboard');
}

export default function LandingPage() {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    async function resumeExistingSession(): Promise<void> {
      if (!hasAuthToken()) {
        return;
      }

      const token = getAuthToken();
      if (!token) {
        clearAuthToken();
        return;
      }

      const response = await fetch('/api/projects', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        globalThis.location.replace('/dashboard');
        return;
      }

      clearAuthToken();
    }

    void resumeExistingSession();
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(undefined);

    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');

    try {
      clearAuthToken();
      const endpoint = mode === 'sign-in' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'sign-in'
        ? { email, password }
        : {
            email,
            password,
            name: String(data.get('name') ?? ''),
            username: String(data.get('username') ?? ''),
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await readAuthPayload(response);
      if (!response.ok) {
        throw new Error(payload.error?.message ?? 'Authentication failed.');
      }
      await completeAuth(payload);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  async function signInDemo(): Promise<void> {
    setLoading(true);
    setError(undefined);
    try {
      clearAuthToken();
      const response = await fetch('/api/auth/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const payload = await readAuthPayload(response);
      if (!response.ok) {
        throw new Error(payload.error?.message ?? 'Demo login failed.');
      }
      await completeAuth(payload);
    } catch (demoError) {
      setError(demoError instanceof Error ? demoError.message : 'Demo login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="landing-page">
      <header className="landing-topbar">
        <div className="landing-brand">divband</div>
        <nav className="landing-topnav">
          <button type="button" className={mode === 'sign-in' ? 'active' : ''} onClick={() => setMode('sign-in')}>Sign in</button>
          <button type="button" className={mode === 'sign-up' ? 'active' : ''} onClick={() => setMode('sign-up')}>Sign up</button>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <p className="eyebrow">Multi-tenant hosting</p>
          <h1>Deploy projects to your own subdomain</h1>
          <p>
            Create projects, connect GitHub, provision Kubernetes namespaces, and publish to URLs like
            {' '}<code>my-app.yourname.divband.com</code>.
          </p>
          <ul className="landing-features">
            <li>Per-user namespaces on Kubernetes</li>
            <li>GitHub repo provisioning and deploy hooks</li>
            <li>In-browser VS Code workspace for each project</li>
          </ul>
        </section>

        <section className="landing-auth card">
          <h2>{mode === 'sign-in' ? 'Sign in' : 'Create your account'}</h2>
          <p>{mode === 'sign-in' ? 'Welcome back. Continue to your projects.' : 'Pick a username — it becomes part of every project URL.'}</p>
          {error ? <div className="alert alert-error">{error}</div> : null}
          <form onSubmit={(event) => void submitAuth(event)}>
            {mode === 'sign-up' ? (
              <>
                <label>
                  Full name
                  <input name="name" autoComplete="name" required />
                </label>
                <label>
                  Username
                  <input name="username" autoComplete="username" pattern="[a-zA-Z0-9-]{2,32}" required placeholder="javad" />
                </label>
              </>
            ) : null}
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={8} required />
            </label>
            <button type="submit" disabled={loading}>{loading ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
          </form>
          <div className="auth-footer">
            <button type="button" className="button-secondary" disabled={loading} onClick={() => void signInDemo()}>Try demo account</button>
            <button type="button" className="link-button" onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
              {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
