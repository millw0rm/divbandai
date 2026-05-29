import type { Publish, PublishedSite } from '../models';
import type { BackendStore } from '../store';

export interface PublishExpiryCleanupResult {
  deletedPublishes: string[];
  deletedSites: string[];
  deletedVersions: string[];
  deletedStorageKeys: string[];
  deletedUploadSessions: string[];
}

export class PublishExpiryService {
  constructor(private readonly store: BackendStore) {}

  cleanupExpiredAnonymousPublishes(now = new Date()): PublishExpiryCleanupResult {
    const result: PublishExpiryCleanupResult = {
      deletedPublishes: [],
      deletedSites: [],
      deletedVersions: [],
      deletedStorageKeys: [],
      deletedUploadSessions: [],
    };

    for (const publish of [...this.store.publishes.values()]) {
      if (!this.isExpiredAnonymousPublish(publish, now)) {
        continue;
      }
      this.deletePublish(publish, result);
    }

    for (const site of [...this.store.publishedSites.values()]) {
      if (!this.isExpiredAnonymousSite(site, now)) {
        continue;
      }
      this.deletePublishedSite(site, result);
    }

    return result;
  }

  private isExpiredAnonymousPublish(publish: Publish, now: Date): boolean {
    return !publish.ownerUserId && this.isExpired(publish.expiresAt, now);
  }

  private isExpiredAnonymousSite(site: PublishedSite, now: Date): boolean {
    return !site.ownerId && this.isExpired(site.expiresAt, now);
  }

  private isExpired(expiresAt: string | undefined, now: Date): boolean {
    return typeof expiresAt === 'string' && Date.parse(expiresAt) <= now.getTime();
  }

  private deletePublish(publish: Publish, result: PublishExpiryCleanupResult): void {
    this.store.publishes.delete(publish.slug);
    result.deletedPublishes.push(publish.slug);

    for (const version of publish.versions) {
      result.deletedVersions.push(version.id);
      this.deleteUploadSession(version.id, result);
      for (const file of version.files) {
        result.deletedStorageKeys.push(this.publishObjectStorageKey(publish.slug, version.id, file.path));
      }
    }
  }

  private deletePublishedSite(site: PublishedSite, result: PublishExpiryCleanupResult): void {
    this.store.publishedSites.delete(site.slug);
    result.deletedSites.push(site.slug);

    for (const version of [...this.store.publishedVersions.values()].filter((item) => item.siteId === site.id)) {
      this.store.publishedVersions.delete(version.id);
      result.deletedVersions.push(version.id);
      this.deleteUploadSession(version.id, result);
    }

    const retainedFiles = [];
    for (const file of this.store.publishedFiles) {
      if (file.siteId === site.id) {
        result.deletedStorageKeys.push(file.storageKey || this.publishObjectStorageKey(site.slug, file.versionId, file.path));
      } else {
        retainedFiles.push(file);
      }
    }
    this.store.publishedFiles = retainedFiles;
  }

  private deleteUploadSession(versionId: string, result: PublishExpiryCleanupResult): void {
    if (this.store.uploadSessions.delete(versionId)) {
      result.deletedUploadSessions.push(versionId);
    }
  }

  private publishObjectStorageKey(slug: string, versionId: string, path: string): string {
    return `sites/${slug}/versions/${versionId}/${this.normalizeObjectPath(path)}`;
  }

  private normalizeObjectPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  }
}
