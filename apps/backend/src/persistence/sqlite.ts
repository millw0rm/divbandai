import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BackendStoreSnapshot, PersistenceAdapter } from '../store.ts';

interface SnapshotRow {
  payload: string;
}

export class SqliteSnapshotPersistenceAdapter implements PersistenceAdapter {
  private readonly databasePath: string;
  private readonly database: DatabaseSync;

  constructor(databaseUrl: string) {
    this.databasePath = this.pathFromDatabaseUrl(databaseUrl);
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS backend_snapshots (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async load(): Promise<BackendStoreSnapshot | undefined> {
    const row = this.database.prepare('SELECT payload FROM backend_snapshots WHERE id = ?').get('default') as SnapshotRow | undefined;
    return row ? (JSON.parse(row.payload) as BackendStoreSnapshot) : undefined;
  }

  async save(snapshot: BackendStoreSnapshot): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO backend_snapshots (id, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `)
      .run('default', JSON.stringify(snapshot), new Date().toISOString());
  }

  close(): void {
    this.database.close();
  }

  private pathFromDatabaseUrl(databaseUrl: string): string {
    if (databaseUrl.startsWith('sqlite://')) {
      return resolve(databaseUrl.slice('sqlite://'.length));
    }
    if (databaseUrl.startsWith('file:')) {
      return resolve(databaseUrl.slice('file:'.length));
    }
    throw new Error('Only sqlite:// and file: DATABASE_URL values are supported by the MVP backend runtime.');
  }
}
