import { PostgresSnapshotPersistenceAdapter } from './persistence/postgres.ts';
import { SqliteSnapshotPersistenceAdapter } from './persistence/sqlite.ts';
import { createBackendStore, hydrateBackendStore, snapshotBackendStore, type BackendStore, type PersistenceAdapter } from './store.ts';

export interface RuntimeStore {
  store: BackendStore;
  persistence: PersistenceAdapter;
  persist(): Promise<void>;
  close(): Promise<void>;
}

export async function createRuntimeStore(databaseUrl: string): Promise<RuntimeStore> {
  const persistence = createPersistenceAdapter(databaseUrl);
  if ('initialize' in persistence && typeof persistence.initialize === 'function') {
    await persistence.initialize();
  }
  const snapshot = await persistence.load();
  const store = snapshot ? hydrateBackendStore(snapshot) : createBackendStore();

  return {
    store,
    persistence,
    persist: () => persistence.save(snapshotBackendStore(store)),
    close: async () => {
      if ('close' in persistence && typeof persistence.close === 'function') {
        await persistence.close();
      }
    },
  };
}

function createPersistenceAdapter(databaseUrl: string): PersistenceAdapter {
  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    return new PostgresSnapshotPersistenceAdapter(databaseUrl);
  }
  return new SqliteSnapshotPersistenceAdapter(databaseUrl);
}
