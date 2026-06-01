import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DIVBAND_SIGNUP_INVITE_CODES = 'alpha-invite';
process.env.DIVBAND_EXPOSE_AUTH_TOKENS = '1';

const { BackendService } = await import('../src/backend-service.ts');
const { createBackendStore } = await import('../src/store.ts');

const backend = new BackendService(createBackendStore());

async function request(method, path, body, token) {
  const response = await backend.handle({
    method,
    path,
    headers: token ? { authorization: `Bearer ${token}`, 'x-forwarded-for': '127.0.0.1' } : { 'x-forwarded-for': '127.0.0.1' },
    body,
  });
  if (response.status >= 400) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

const first = await request('POST', '/auth/register', { email: 'owner@example.test', name: 'Owner', username: 'owner', password: 'correct horse', inviteCode: 'alpha-invite' });
assert.ok(first.emailVerificationToken, 'registration exposes verification token in test mode');
await request('POST', '/auth/verify-email', { token: first.emailVerificationToken });
const login = await request('POST', '/auth/login', { email: 'owner@example.test', password: 'correct horse' });
assert.ok(login.token, 'verified user can log in');

const projectBody = await request('POST', '/projects', { name: 'Smoke App', slug: 'smoke-app' }, login.token);
assert.equal(projectBody.project.platformHostname, 'smoke-app.owner.divband.com');
assert.equal(projectBody.project.workspaceHostname, 'code.smoke-app.owner.divband.com');
assert.equal(projectBody.project.namespace, 'user-owner');
await request('POST', `/projects/${projectBody.project.id}/platform-subdomain`, {}, login.token);
const deploymentBody = await request('POST', `/projects/${projectBody.project.id}/deployments`, { gitRef: 'main', commitSha: 'abc123' }, login.token);
assert.equal(deploymentBody.deployment.state, 'queued');
const statusBody = await request('GET', `/projects/${projectBody.project.id}/status`, undefined, login.token);
assert.ok(statusBody.platformSubdomainAttached, 'project has live platform hostname access');

const reset = await request('POST', '/auth/password-reset/request', { email: 'owner@example.test' });
assert.ok(reset.resetToken, 'password reset token is issued in test mode');
await request('POST', '/auth/password-reset/confirm', { token: reset.resetToken, password: 'new correct horse' });
await request('POST', '/auth/login', { email: 'owner@example.test', password: 'new correct horse' });

console.log('production controls smoke passed');
