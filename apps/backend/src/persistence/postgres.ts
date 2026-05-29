import type { BackendStoreSnapshot, PersistenceAdapter } from '../store.ts';

interface SnapshotRow {
  payload: BackendStoreSnapshot | string;
}

type PgPool = import('pg').Pool;

export class PostgresSnapshotPersistenceAdapter implements PersistenceAdapter {
  private poolInstance?: PgPool;

  constructor(private readonly databaseUrl: string) {}

  async initialize(): Promise<void> {
    await (await this.pool()).query(`
      CREATE TABLE IF NOT EXISTS backend_snapshots (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  async load(): Promise<BackendStoreSnapshot | undefined> {
    const result = await (await this.pool()).query<SnapshotRow>('SELECT payload FROM backend_snapshots WHERE id = $1', ['default']);
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return typeof row.payload === 'string' ? (JSON.parse(row.payload) as BackendStoreSnapshot) : row.payload;
  }

  async save(snapshot: BackendStoreSnapshot): Promise<void> {
    await (await this.pool()).query(
      `
        INSERT INTO backend_snapshots (id, payload, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `,
      ['default', JSON.stringify(snapshot)],
    );
  }

  async close(): Promise<void> {
    if (this.poolInstance) {
      await this.poolInstance.end();
    }
  }

  private async pool(): Promise<PgPool> {
    if (!this.poolInstance) {
      const pg = await import('pg');
      this.poolInstance = new pg.default.Pool({ connectionString: this.databaseUrl });
    }
    return this.poolInstance;
  }
}
