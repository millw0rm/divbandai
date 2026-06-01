import assert from 'node:assert/strict';

const { createBackendStore, hydrateBackendStore, snapshotBackendStore } = await import('../src/store.ts');

const store = createBackendStore();
store.users.set('user_restore', {
  id: 'user_restore',
  email: 'restore@example.test',
  name: 'Restore User',
  username: 'restore-user',
  createdAt: new Date(0).toISOString(),
  emailVerifiedAt: new Date(0).toISOString(),
  billingTier: 'free',
  billingStatus: 'trialing',
});
store.usersByEmail.set('restore@example.test', 'user_restore');
store.organizations.set('org_restore', {
  id: 'org_restore',
  name: 'Restore Org',
  slug: 'restore-org',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  billingTier: 'free',
  billingStatus: 'active',
});
store.projects.set('project_restore', {
  id: 'project_restore',
  organizationId: 'org_restore',
  ownerId: 'user_restore',
  slug: 'restore-app',
  name: 'Restore App',
  status: 'deployed',
  gitlabPath: 'restore-org/restore-app',
  namespace: 'project-restore-app',
  platformHostname: 'restore-app.restore-user.divband.com',
  workspaceHostname: 'code.restore-app.restore-user.divband.com',
  runnerTag: 'divband-restore-user-restore-app',
  namespaceProvisioned: true,
  platformSubdomainAttached: true,
  domains: [],
  deployments: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

const restored = hydrateBackendStore(snapshotBackendStore(store));
assert.equal(restored.users.get('user_restore')?.emailVerifiedAt, new Date(0).toISOString());
assert.equal(restored.organizations.get('org_restore')?.billingStatus, 'active');
assert.equal(restored.projects.get('project_restore')?.platformHostname, 'restore-app.restore-user.divband.com');
assert.equal(restored.projects.get('project_restore')?.workspaceHostname, 'code.restore-app.restore-user.divband.com');
console.log('restore smoke passed');
