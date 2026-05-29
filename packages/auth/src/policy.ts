export type ProjectRole = 'owner' | 'admin' | 'developer' | 'viewer';

export type ProjectPermission =
  | 'project:read'
  | 'project:admin'
  | 'project:archive'
  | 'project:provision_gitlab'
  | 'project:provision_kubernetes'
  | 'domain:manage'
  | 'deployment:trigger'
  | 'secret:read'
  | 'secret:manage'
  | 'member:manage'
  | 'token:manage'
  | 'ai:request_change';

const rolePermissions: Record<ProjectRole, ProjectPermission[]> = {
  owner: [
    'project:read',
    'project:admin',
    'project:archive',
    'project:provision_gitlab',
    'project:provision_kubernetes',
    'domain:manage',
    'deployment:trigger',
    'secret:read',
    'secret:manage',
    'member:manage',
    'token:manage',
    'ai:request_change',
  ],
  admin: [
    'project:read',
    'project:admin',
    'project:provision_gitlab',
    'project:provision_kubernetes',
    'domain:manage',
    'deployment:trigger',
    'secret:read',
    'secret:manage',
    'member:manage',
    'token:manage',
    'ai:request_change',
  ],
  developer: ['project:read', 'deployment:trigger', 'secret:read', 'ai:request_change'],
  viewer: ['project:read'],
};

const roleRank: Record<ProjectRole, number> = {
  viewer: 0,
  developer: 1,
  admin: 2,
  owner: 3,
};

export function can(role: ProjectRole, permission: ProjectPermission): boolean {
  return rolePermissions[role].includes(permission);
}

export function roleAtLeast(role: ProjectRole, minimumRole: ProjectRole): boolean {
  return roleRank[role] >= roleRank[minimumRole];
}

export function assignableRoles(actorRole: ProjectRole): ProjectRole[] {
  if (actorRole === 'owner') {
    return ['owner', 'admin', 'developer', 'viewer'];
  }
  if (actorRole === 'admin') {
    return ['admin', 'developer', 'viewer'];
  }

  return [];
}
