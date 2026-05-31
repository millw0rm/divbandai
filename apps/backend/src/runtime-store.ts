import { InMemorySnapshotPersistenceAdapter } from './persistence/memory.ts';
import { createBackendStore, hydrateBackendStore, snapshotBackendStore, type BackendStore, type PersistenceAdapter } from './store.ts';

export type PersistenceDriver = 'memory' | 'sqlite' | 'postgres';

export interface RuntimeStoreOptions {
  driver?: PersistenceDriver;
  databaseUrl?: string;
}

export interface RuntimeStore {
  store: BackendStore;
  persistence: PersistenceAdapter;
  persist(): Promise<void>;
  close(): Promise<void>;
}

export async function createRuntimeStore(options: RuntimeStoreOptions | string = {}): Promise<RuntimeStore> {
  const persistence = await createPersistenceAdapter(normalizeRuntimeStoreOptions(options));
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

async function createPersistenceAdapter(options: Required<RuntimeStoreOptions>): Promise<PersistenceAdapter> {
  if (options.driver === 'memory') {
    return new InMemorySnapshotPersistenceAdapter();
  }
  if (options.driver === 'postgres') {
    const { PostgresSnapshotPersistenceAdapter } = await import('./persistence/postgres.ts');
    return new PostgresSnapshotPersistenceAdapter(options.databaseUrl);
  }
  const { SqliteSnapshotPersistenceAdapter } = await import('./persistence/sqlite.ts');
  return new SqliteSnapshotPersistenceAdapter(options.databaseUrl);
}

function normalizeRuntimeStoreOptions(options: RuntimeStoreOptions | string): Required<RuntimeStoreOptions> {
  if (typeof options === 'string') {
    return inferOptionsFromDatabaseUrl(options);
  }

  if (options.driver) {
    return {
      driver: options.driver,
      databaseUrl: options.databaseUrl ?? defaultDatabaseUrl(options.driver),
    };
  }

  return inferOptionsFromDatabaseUrl(options.databaseUrl);
}

function inferOptionsFromDatabaseUrl(databaseUrl?: string): Required<RuntimeStoreOptions> {
  const trimmedUrl = databaseUrl?.trim();
  if (!trimmedUrl || trimmedUrl === 'memory://' || trimmedUrl === 'memory') {
    return { driver: 'memory', databaseUrl: 'memory://' };
  }
  if (trimmedUrl.startsWith('postgres://') || trimmedUrl.startsWith('postgresql://')) {
    return { driver: 'postgres', databaseUrl: trimmedUrl };
  }
  return { driver: 'sqlite', databaseUrl: trimmedUrl };
}

function defaultDatabaseUrl(driver: PersistenceDriver): string {
  if (driver === 'postgres') {
    throw new Error('A PostgreSQL DATABASE_URL is required when PERSISTENCE_DRIVER=postgres.');
  }
  if (driver === 'sqlite') {
    return 'sqlite://./data/divband-backend.sqlite';
  }
  return 'memory://';
}
