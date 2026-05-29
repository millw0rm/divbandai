-- MVP relational schema for the divband backend runtime.
-- The current runtime adapter persists a snapshot in SQLite while these tables define
-- the stable shape for PostgreSQL/SQLite-backed adapters as the MVP hardens.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  oauth_provider TEXT
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  role TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  gitlab_path TEXT NOT NULL,
  namespace TEXT NOT NULL,
  platform_hostname TEXT NOT NULL,
  runner_tag TEXT NOT NULL,
  repository_url TEXT,
  namespace_provisioned INTEGER NOT NULL DEFAULT 0,
  platform_subdomain_attached INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  git_ref TEXT NOT NULL,
  commit_sha TEXT,
  environment TEXT,
  image TEXT,
  image_digest TEXT,
  pipeline_id TEXT,
  job_url TEXT,
  ingress_hostname TEXT,
  health_check_url TEXT,
  previous_deployment_id TEXT,
  rollback_of_deployment_id TEXT,
  started_at TEXT,
  finished_at TEXT,
  logs_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  verification_token TEXT NOT NULL,
  verification_record TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  certificate_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS environment_variables (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  protected INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS ai_change_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '[]',
  patch_json TEXT,
  branch_json TEXT,
  merge_request_json TEXT,
  ci_status_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publishes (
  slug TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  claim_token_hash TEXT,
  viewer TEXT,
  spa_mode INTEGER NOT NULL DEFAULT 0,
  ttl_seconds INTEGER NOT NULL,
  expires_at TEXT,
  live_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  publish_slug TEXT NOT NULL REFERENCES publishes(slug) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finalized_at TEXT
);

CREATE TABLE IF NOT EXISTS published_sites (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  current_version_id TEXT,
  platform_hostname TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  claim_token_hash TEXT,
  spa_mode INTEGER NOT NULL DEFAULT 0,
  viewer TEXT NOT NULL,
  password_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS published_versions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES published_sites(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finalized_at TEXT
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  version_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  uploads_json TEXT NOT NULL,
  skipped_json TEXT NOT NULL,
  scanner_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  site_id TEXT NOT NULL REFERENCES published_sites(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES published_versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  hash TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  PRIMARY KEY (site_id, version_id, path)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_change_requests_project_id ON ai_change_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_project_id ON audit_events(project_id);
