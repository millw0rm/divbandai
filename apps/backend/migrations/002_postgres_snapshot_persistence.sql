-- PostgreSQL production persistence for the backend runtime snapshot adapter.
-- Run this migration against the database referenced by DATABASE_URL before
-- starting production API replicas.

CREATE TABLE IF NOT EXISTS backend_snapshots (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backend_snapshots_updated_at ON backend_snapshots(updated_at);
