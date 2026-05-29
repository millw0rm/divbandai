export type ProjectRole = 'owner' | 'admin' | 'developer' | 'viewer';

export type ProjectPermission =
  | 'project:read'
  | 'project:admin'
  | 'domain:manage'
  | 'deployment:trigger'
  | 'secret:manage'
  | 'ai:request_change';

const rolePermissions: Record<ProjectRole, ProjectPermission[]> = {
  owner: ['project:read', 'project:admin', 'domain:manage', 'deployment:trigger', 'secret:manage', 'ai:request_change'],
  admin: ['project:read', 'domain:manage', 'deployment:trigger', 'secret:manage', 'ai:request_change'],
  developer: ['project:read', 'deployment:trigger', 'ai:request_change'],
  viewer: ['project:read'],
};

export function can(role: ProjectRole, permission: ProjectPermission): boolean {
  return rolePermissions[role].includes(permission);
}
