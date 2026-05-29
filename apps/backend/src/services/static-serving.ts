import type { PublishedFile, PublishedSite } from '../models.ts';
import type { BackendStore } from '../store.ts';

export interface StaticServingOptions {
  platformDomain?: string;
  listingMode?: 'directory-listing' | 'not-found';
  customHostnames?: ReadonlyMap<string, string>;
}

export interface StaticServeRequest {
  host: string;
  path: string;
}

export type StaticServeResolution =
  | StaticServeObjectResolution
  | StaticServeDirectoryListingResolution
  | StaticServeNotFoundResolution;

export interface StaticServeObjectResolution {
  type: 'object';
  slug: string;
  versionId: string;
  requestPath: string;
  filePath: string;
  storageKey: string;
  contentType: string;
  size: number;
}

export interface StaticServeDirectoryListingResolution {
  type: 'directory-listing';
  slug: string;
  versionId: string;
  requestPath: string;
  directoryPath: string;
  entries: string[];
}

export interface StaticServeNotFoundResolution {
  type: 'not-found';
  host: string;
  requestPath: string;
  reason: 'unknown-host' | 'no-live-version' | 'missing-object';
}

export class StaticServingService {
  private readonly platformDomain: string;
  private readonly listingMode: 'directory-listing' | 'not-found';
  private readonly customHostnames: ReadonlyMap<string, string>;

  constructor(private readonly store: BackendStore, options: StaticServingOptions = {}) {
    this.platformDomain = options.platformDomain ?? 'divband.ir';
    this.listingMode = options.listingMode ?? 'not-found';
    this.customHostnames = options.customHostnames ?? new Map<string, string>();
  }

  resolve(request: StaticServeRequest): StaticServeResolution {
    const host = this.normalizeHost(request.host);
    const requestPath = this.normalizeRequestPath(request.path);
    const site = this.siteForHost(host);
    if (!site) {
      return { type: 'not-found', host, requestPath, reason: 'unknown-host' };
    }
    if (!site.currentVersionId) {
      return { type: 'not-found', host, requestPath, reason: 'no-live-version' };
    }

    const files = this.filesFor(site, site.currentVersionId);
    const resolvedFile = this.resolveFilePath(requestPath, files, site.spaMode);
    if (resolvedFile) {
      return this.objectResolution(site, requestPath, resolvedFile);
    }

    if (this.listingMode === 'directory-listing') {
      const entries = this.directoryEntries(requestPath, files);
      if (entries.length > 0) {
        return {
          type: 'directory-listing',
          slug: site.slug,
          versionId: site.currentVersionId,
          requestPath,
          directoryPath: this.directoryPath(requestPath),
          entries,
        };
      }
    }

    return { type: 'not-found', host, requestPath, reason: 'missing-object' };
  }

  objectStorageKey(slug: string, versionId: string, path: string): string {
    return `sites/${slug}/versions/${versionId}/${this.normalizeObjectPath(path)}`;
  }

  private siteForHost(host: string): PublishedSite | undefined {
    const customSlug = this.customHostnames.get(host);
    if (customSlug) {
      return this.store.publishedSites.get(customSlug);
    }

    return [...this.store.publishedSites.values()].find((site) => site.platformHostname === host) ?? this.siteForPlatformSubdomain(host);
  }

  private siteForPlatformSubdomain(host: string): PublishedSite | undefined {
    const suffix = `.${this.platformDomain}`;
    if (!host.endsWith(suffix)) {
      return undefined;
    }
    const slug = host.slice(0, -suffix.length);
    return slug ? this.store.publishedSites.get(slug) : undefined;
  }

  private filesFor(site: PublishedSite, versionId: string): PublishedFile[] {
    return this.store.publishedFiles.filter((file) => file.siteId === site.id && file.versionId === versionId);
  }

  private resolveFilePath(requestPath: string, files: PublishedFile[], spaMode: boolean): PublishedFile | undefined {
    const normalized = this.normalizeObjectPath(requestPath);
    const candidates = normalized ? [normalized, `${normalized}/index.html`] : ['index.html'];
    const exact = candidates.map((candidate) => this.findFile(files, candidate)).find(Boolean);
    if (exact) {
      return exact;
    }
    if (spaMode) {
      return this.findFile(files, 'index.html');
    }
    return undefined;
  }

  private findFile(files: PublishedFile[], path: string): PublishedFile | undefined {
    return files.find((file) => file.path === path || file.storageKey.endsWith(`/${path}`));
  }

  private objectResolution(site: PublishedSite, requestPath: string, file: PublishedFile): StaticServeObjectResolution {
    const versionId = site.currentVersionId ?? file.versionId;
    return {
      type: 'object',
      slug: site.slug,
      versionId,
      requestPath,
      filePath: file.path,
      storageKey: file.storageKey || this.objectStorageKey(site.slug, versionId, file.path),
      contentType: file.contentType,
      size: file.size,
    };
  }

  private directoryEntries(requestPath: string, files: PublishedFile[]): string[] {
    const directory = this.directoryPath(requestPath);
    const prefix = directory ? `${directory}/` : '';
    const entries = new Set<string>();
    for (const file of files) {
      if (!file.path.startsWith(prefix) || file.path === prefix) {
        continue;
      }
      const [entry] = file.path.slice(prefix.length).split('/');
      if (entry) {
        entries.add(entry);
      }
    }
    return [...entries].sort();
  }

  private directoryPath(requestPath: string): string {
    const normalized = this.normalizeObjectPath(requestPath);
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  }

  private normalizeHost(host: string): string {
    return host.toLowerCase().split(':')[0]?.trim() ?? '';
  }

  private normalizeRequestPath(path: string): string {
    const [pathname = '/'] = path.split('?');
    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  }

  private normalizeObjectPath(path: string): string {
    return this.normalizeRequestPath(path).replace(/^\/+/, '').replace(/\/+$/, '');
  }
}
