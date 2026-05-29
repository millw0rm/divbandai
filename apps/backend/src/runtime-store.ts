import { SqliteSnapshotPersistenceAdapter } from './persistence/sqlite.ts';
import { createBackendStore, hydrateBackendStore, snapshotBackendStore, type BackendStore, type PersistenceAdapter } from './store.ts';

export interface RuntimeStore {
  store: BackendStore;
  persistence: PersistenceAdapter;
  persist(): Promise<void>;
}

export async function createRuntimeStore(databaseUrl: string): Promise<RuntimeStore> {
  const persistence = new SqliteSnapshotPersistenceAdapter(databaseUrl);
  const snapshot = await persistence.load();
  const store = snapshot ? hydrateBackendStore(snapshot) : createBackendStore();

  return {
    store,
    persistence,
    persist: () => persistence.save(snapshotBackendStore(store)),
  };
}
