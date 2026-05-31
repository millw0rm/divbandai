import type { BackendStoreSnapshot, PersistenceAdapter } from '../store.ts';

export class InMemorySnapshotPersistenceAdapter implements PersistenceAdapter {
  private snapshot?: BackendStoreSnapshot;

  constructor(initialSnapshot?: BackendStoreSnapshot) {
    this.snapshot = initialSnapshot ? cloneSnapshot(initialSnapshot) : undefined;
  }

  async load(): Promise<BackendStoreSnapshot | undefined> {
    return this.snapshot ? cloneSnapshot(this.snapshot) : undefined;
  }

  async save(snapshot: BackendStoreSnapshot): Promise<void> {
    this.snapshot = cloneSnapshot(snapshot);
  }
}

function cloneSnapshot(snapshot: BackendStoreSnapshot): BackendStoreSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as BackendStoreSnapshot;
}
