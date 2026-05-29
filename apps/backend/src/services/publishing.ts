import type {
  AuthActor,
  Publish,
  PublishFileManifest,
  PublishRequest,
  PublishResponse,
  PublishUploadPlan,
  PublishVersion,
  PublishedSite,
  UploadSession,
} from '../models.ts';
import type { BackendStore } from '../store.ts';
import { PUBLISHING_LIMITS } from '../publishing/limits.ts';
import { createId, normalizeSlug, nowIso } from '../utils.ts';
import { InMemoryObjectStorage, type ObjectStorage } from './object-storage.ts';

export interface PublishingServiceOptions {
  apiBaseUrl?: string;
  publicSiteDomain?: string;
  objectStorage?: ObjectStorage;
}

export class PublishingService {
  private readonly apiBaseUrl: string;
  private readonly publicSiteDomain: string;
  private readonly objectStorage: ObjectStorage;

  constructor(private readonly store: BackendStore, options: PublishingServiceOptions = {}) {
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://api.divband.local';
    this.publicSiteDomain = options.publicSiteDomain ?? 'divband.site';
    this.objectStorage = options.objectStorage ?? new InMemoryObjectStorage();
  }

  async create(input: PublishRequest, actor?: AuthActor): Promise<PublishResponse> {
    const files = this.filesFromInput(input.files);
    this.requireWithinLimits(files);
    const timestamp = nowIso();
    const slug = this.reserveSlug(input.slug, this.slugFromFiles(files));
    const anonymous = !actor || input.anonymous === true;
    const ttlSeconds = this.ttlSeconds(input.ttlSeconds);
    const expiresAt = anonymous ? this.expiresAt(ttlSeconds) : undefined;
    const claimToken = anonymous ? this.randomToken('claim') : undefined;
    const version = this.createVersion(files, timestamp);
    const publish: Publish = {
      slug,
      ownerUserId: anonymous ? undefined : actor?.user.id,
      claimTokenHash: claimToken ? await this.hashSecret(claimToken) : undefined,
      viewer: this.optionalTrimmedString(input.viewer),
      spaMode: input.spaMode === true,
      ttlSeconds,
      expiresAt,
      versions: [version],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const uploads = this.uploadPlan(slug, version.id, files);
    this.store.publishes.set(slug, publish);
    this.store.uploadSessions.set(version.id, this.uploadSession(publish, version.id, uploads, [], timestamp));
    return this.responseFor(publish, version, uploads, [], claimToken);
  }

  async update(slug: string, input: PublishRequest & { claimToken?: unknown }, actor?: AuthActor): Promise<PublishResponse> {
    const publish = this.requirePublish(slug);
    await this.requireWriteAccess(publish, actor, input.claimToken);
    this.requireNotExpired(publish);
    const files = this.filesFromInput(input.files);
    this.requireWithinLimits(files);
    const previousFiles = this.liveOrLatestVersion(publish)?.files ?? [];
    const skipped = files.filter((file) => previousFiles.some((previous) => previous.path === file.path && previous.hash === file.hash));
    const uploads = files.filter((file) => !skipped.some((skippedFile) => skippedFile.path === file.path));
    const version = this.createVersion(files, nowIso());

    publish.versions.push(version);
    publish.viewer = this.optionalTrimmedString(input.viewer) ?? publish.viewer;
    publish.spaMode = typeof input.spaMode === 'boolean' ? input.spaMode : publish.spaMode;
    if (typeof input.ttlSeconds !== 'undefined') {
      publish.ttlSeconds = this.ttlSeconds(input.ttlSeconds);
      if (!publish.ownerUserId) {
        publish.expiresAt = this.expiresAt(publish.ttlSeconds);
      }
    }
    publish.updatedAt = nowIso();

    const uploadPlans = this.uploadPlan(publish.slug, version.id, uploads);
    this.store.uploadSessions.set(version.id, this.uploadSession(publish, version.id, uploadPlans, skipped, version.createdAt));
    return this.responseFor(publish, version, uploadPlans, skipped);
  }

  async finalize(slug: string, versionId: unknown): Promise<Publish> {
    if (typeof versionId !== 'string' || !versionId.trim()) {
      throw new Error('versionId is required.');
    }
    const publish = this.requirePublish(slug);
    this.requireNotExpired(publish);
    const version = publish.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new Error('Publish version not found.');
    }

    if (version.status === 'live' && publish.liveVersionId === version.id) {
      return publish;
    }

    const session = this.requireUploadSession(version.id);
    this.requireSessionReady(session);
    await this.verifyManifestObjects(version.files, session);

    const timestamp = nowIso();
    const site = this.upsertPublishedSite(publish, timestamp);
    this.store.publishedVersions.set(version.id, {
      id: version.id,
      siteId: site.id,
      state: 'live',
      createdAt: version.createdAt,
      finalizedAt: timestamp,
    });
    const publishedFiles = await this.promoteFiles(site, version.id, version.files, session);
    this.store.publishedFiles = this.store.publishedFiles.filter((file) => !(file.siteId === site.id && file.versionId === version.id));
    this.store.publishedFiles.push(...publishedFiles);

    version.status = 'live';
    version.finalizedAt = timestamp;
    publish.liveVersionId = version.id;
    publish.updatedAt = timestamp;
    site.currentVersionId = version.id;
    site.expiresAt = publish.expiresAt;
    site.spaMode = publish.spaMode;
    site.viewer = publish.viewer ?? 'static';
    site.updatedAt = timestamp;
    return publish;
  }

  async claim(slug: string, claimToken: unknown, actor: AuthActor): Promise<Publish> {
    const publish = this.requirePublish(slug);
    if (publish.ownerUserId) {
      throw new Error('Publish is already claimed.');
    }
    this.requireNotExpired(publish);
    if (!(await this.claimTokenMatches(publish, claimToken))) {
      throw new Error('A valid claimToken is required.');
    }

    publish.ownerUserId = actor.user.id;
    publish.claimTokenHash = undefined;
    publish.expiresAt = undefined;
    publish.updatedAt = nowIso();
    return publish;
  }

  get(slug: string): Publish {
    const publish = this.requirePublish(slug);
    this.requireNotExpired(publish);
    return publish;
  }

  list(actor: AuthActor): Publish[] {
    return [...this.store.publishes.values()].filter((publish) => publish.ownerUserId === actor.user.id);
  }

  async delete(slug: string, actor?: AuthActor, claimToken?: unknown): Promise<Publish> {
    const publish = this.requirePublish(slug);
    await this.requireWriteAccess(publish, actor, claimToken);
    this.store.publishes.delete(slug);
    publish.updatedAt = nowIso();
    return publish;
  }

  private responseFor(publish: Publish, version: PublishVersion, uploads: PublishUploadPlan[], skipped: PublishFileManifest[], claimToken?: string): PublishResponse {
    const expiresInSeconds = publish.expiresAt ? Math.max(0, Math.ceil((Date.parse(publish.expiresAt) - Date.now()) / 1000)) : publish.ttlSeconds;
    return {
      slug: publish.slug,
      siteUrl: this.siteUrl(publish.slug),
      upload: {
        versionId: version.id,
        uploads,
        skipped,
      },
      finalizeUrl: `${this.apiBaseUrl}/api/v1/publish/${publish.slug}/finalize`,
      expiresInSeconds,
      claimToken,
      claimUrl: claimToken ? `${this.apiBaseUrl}/api/v1/publish/${publish.slug}/claim` : undefined,
      expiresAt: publish.expiresAt,
    };
  }

  private createVersion(files: PublishFileManifest[], timestamp: string): PublishVersion {
    return {
      id: createId('publish_version'),
      status: 'pending',
      files,
      createdAt: timestamp,
    };
  }

  private uploadPlan(slug: string, versionId: string, files: PublishFileManifest[]): PublishUploadPlan[] {
    const expiresAt = new Date(Date.now() + PUBLISHING_LIMITS.uploadPlan.expiresInSeconds * 1000).toISOString();
    return files.map((file) => {
      const storageKey = this.stagingObjectStorageKey(slug, versionId, file.path);
      const presigned = this.objectStorage.presignPut({
        key: storageKey,
        contentType: file.contentType,
        contentLength: file.size,
        checksumSha256: file.hash,
        expiresAt,
      });
      return {
        path: file.path,
        method: 'PUT',
        url: presigned.url,
        headers: presigned.headers,
        expiresInSeconds: presigned.expiresInSeconds,
        storageBucket: this.objectStorage.bucket,
        storageKey,
        checksumSha256: file.hash,
        contentLength: file.size,
        expiresAt,
      };
    });
  }


  private uploadSession(publish: Publish, versionId: string, uploads: PublishUploadPlan[], skipped: PublishFileManifest[], createdAt: string): UploadSession {
    const expiresAt = uploads.reduce((earliest, upload) => (Date.parse(upload.expiresAt) < Date.parse(earliest) ? upload.expiresAt : earliest), publish.expiresAt ?? new Date(Date.now() + PUBLISHING_LIMITS.uploadPlan.expiresInSeconds * 1000).toISOString());
    return {
      versionId,
      slug: publish.slug,
      expiresAt,
      uploads,
      skipped,
      scannerStatus: 'clean',
      createdAt,
    };
  }

  private requireUploadSession(versionId: string): UploadSession {
    const session = this.store.uploadSessions.get(versionId);
    if (!session) {
      throw new Error('Upload session not found.');
    }
    return session;
  }

  private requireSessionReady(session: UploadSession): void {
    if (Date.parse(session.expiresAt) <= Date.now()) {
      throw new Error('Upload session has expired.');
    }
    if (session.scannerStatus !== 'clean') {
      throw new Error('Upload scanner has not approved this publish.');
    }
  }

  private async verifyManifestObjects(files: PublishFileManifest[], session: UploadSession): Promise<void> {
    for (const file of files) {
      const upload = session.uploads.find((item) => item.path === file.path);
      if (!upload) {
        if (session.skipped.some((item) => item.path === file.path && item.hash === file.hash && item.size === file.size)) {
          const existing = this.findReusablePublishedFile(session.slug, file);
          if (!existing || !(await this.objectStorage.headObject(existing.storageKey))) {
            throw new Error(`Reusable object is missing for ${file.path}.`);
          }
          continue;
        }
        throw new Error(`Upload plan missing for ${file.path}.`);
      }
      if (Date.parse(upload.expiresAt) <= Date.now()) {
        throw new Error(`Upload URL has expired for ${file.path}.`);
      }
      const object = await this.objectStorage.headObject(upload.storageKey);
      if (!object) {
        throw new Error(`Uploaded object is missing for ${file.path}.`);
      }
      if (object.contentLength !== file.size || object.checksumSha256 !== file.hash) {
        throw new Error(`Uploaded object metadata does not match manifest for ${file.path}.`);
      }
    }
  }

  private upsertPublishedSite(publish: Publish, timestamp: string): PublishedSite {
    const existing = this.store.publishedSites.get(publish.slug);
    if (existing) {
      return existing;
    }
    const site: PublishedSite = {
      id: createId('published_site'),
      slug: publish.slug,
      ownerId: publish.ownerUserId,
      platformHostname: `${publish.slug}.${this.publicSiteDomain}`,
      expiresAt: publish.expiresAt,
      claimTokenHash: publish.claimTokenHash,
      spaMode: publish.spaMode,
      viewer: publish.viewer ?? 'static',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.publishedSites.set(site.slug, site);
    return site;
  }

  private async promoteFiles(site: PublishedSite, versionId: string, files: PublishFileManifest[], session: UploadSession) {
    return Promise.all(files.map(async (file) => {
      const upload = session.uploads.find((item) => item.path === file.path);
      const storageKey = upload?.storageKey ? this.liveObjectStorageKey(site.slug, versionId, file.path) : (this.findReusablePublishedFile(site.slug, file)?.storageKey ?? this.liveObjectStorageKey(site.slug, versionId, file.path));
      if (upload) {
        await this.objectStorage.copyObject(upload.storageKey, storageKey);
      }
      return {
        siteId: site.id,
        versionId,
        path: file.path,
        size: file.size,
        contentType: file.contentType,
        hash: file.hash,
        storageKey,
      };
    }));
  }


  private findReusablePublishedFile(slug: string, file: PublishFileManifest) {
    const site = this.store.publishedSites.get(slug);
    if (!site) {
      return undefined;
    }
    return this.store.publishedFiles.find((publishedFile) => publishedFile.siteId === site.id && publishedFile.path === file.path && publishedFile.hash === file.hash && publishedFile.size === file.size);
  }

  private stagingObjectStorageKey(slug: string, versionId: string, path: string): string {
    return `${this.objectStorage.stagingPrefix}/${slug}/${versionId}/${this.normalizeObjectPath(path)}`;
  }

  private liveObjectStorageKey(slug: string, versionId: string, path: string): string {
    return `${this.objectStorage.livePrefix}/${slug}/versions/${versionId}/${this.normalizeObjectPath(path)}`;
  }

  private normalizeObjectPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  }

  private async requireWriteAccess(publish: Publish, actor: AuthActor | undefined, claimToken: unknown): Promise<void> {
    if (actor && publish.ownerUserId === actor.user.id) {
      return;
    }
    if (!publish.ownerUserId && (await this.claimTokenMatches(publish, claimToken))) {
      return;
    }
    throw new Error('A valid claimToken or bearer API key is required to update this publish.');
  }

  private async claimTokenMatches(publish: Publish, claimToken: unknown): Promise<boolean> {
    if (typeof claimToken !== 'string' || !publish.claimTokenHash) {
      return false;
    }
    const candidate = await this.hashSecret(claimToken);
    return this.safeEqual(candidate, publish.claimTokenHash);
  }

  private requirePublish(slug: string): Publish {
    const publish = this.store.publishes.get(slug);
    if (!publish) {
      throw new Error('Publish not found.');
    }
    return publish;
  }

  private liveOrLatestVersion(publish: Publish): PublishVersion | undefined {
    return publish.versions.find((version) => version.id === publish.liveVersionId) ?? publish.versions.at(-1);
  }

  private filesFromInput(files: unknown): PublishFileManifest[] {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('At least one file is required.');
    }
    return files.map((file) => this.fileFromInput(file));
  }

  private requireWithinLimits(files: PublishFileManifest[]): void {
    if (files.length > PUBLISHING_LIMITS.anonymous.maxFiles) {
      throw new Error(`Publish includes too many files. Maximum is ${PUBLISHING_LIMITS.anonymous.maxFiles}.`);
    }

    const largestFile = Math.max(...files.map((file) => file.size));
    if (largestFile > PUBLISHING_LIMITS.anonymous.maxFileBytes) {
      throw new Error(`Publish includes a file larger than ${PUBLISHING_LIMITS.anonymous.maxFileBytes} bytes.`);
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > PUBLISHING_LIMITS.anonymous.maxTotalBytes) {
      throw new Error(`Publish is larger than ${PUBLISHING_LIMITS.anonymous.maxTotalBytes} bytes.`);
    }
  }

  private fileFromInput(input: unknown): PublishFileManifest {
    if (!this.isRecord(input)) {
      throw new Error('Each file must be an object.');
    }
    const path = typeof input.path === 'string' ? input.path.replace(/\\/g, '/').replace(/^\/+/, '') : '';
    const contentType = typeof input.contentType === 'string' ? input.contentType.trim() : '';
    const hash = typeof input.hash === 'string' ? input.hash.trim() : '';
    const size = typeof input.size === 'number' ? input.size : Number.NaN;
    if (!path || path.includes('..') || path.startsWith('.git/')) {
      throw new Error('Each file requires a safe path.');
    }
    if (!Number.isFinite(size) || size < 0) {
      throw new Error('Each file requires a non-negative size.');
    }
    if (!contentType) {
      throw new Error('Each file requires contentType.');
    }
    if (!hash) {
      throw new Error('Each file requires hash.');
    }
    return { path, size, contentType, hash };
  }

  private slugFromFiles(files: PublishFileManifest[]): string {
    const indexFile = files.find((file) => file.path.endsWith('index.html'));
    const base = indexFile?.path.split('/').at(-2) ?? files[0]?.path.split('/')[0] ?? 'site';
    return normalizeSlug(base) || 'site';
  }

  private reserveSlug(requestedSlug: unknown, fallbackBase: string): string {
    if (typeof requestedSlug === 'string' && requestedSlug.trim()) {
      const slug = normalizeSlug(requestedSlug);
      if (!slug) {
        throw new Error('slug must include at least one letter or number.');
      }
      if (this.slugTaken(slug)) {
        throw new Error('Publish slug is already in use.');
      }
      return slug;
    }
    return this.uniqueSlug(fallbackBase);
  }

  private uniqueSlug(base: string): string {
    let candidate = `${base}-${this.randomSlugSuffix()}`;
    let suffix = 1;
    while (this.slugTaken(candidate)) {
      suffix += 1;
      candidate = `${base}-${this.randomSlugSuffix()}-${suffix}`;
    }
    return candidate;
  }

  private slugTaken(slug: string): boolean {
    return this.store.publishes.has(slug) || this.store.publishedSites.has(slug);
  }

  private ttlSeconds(value: unknown): number {
    if (typeof value === 'undefined') {
      return PUBLISHING_LIMITS.anonymous.defaultTtlSeconds;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error('ttlSeconds must be a positive number.');
    }
    return Math.min(Math.floor(value), PUBLISHING_LIMITS.anonymous.maxTtlSeconds);
  }

  private expiresAt(ttlSeconds: number): string {
    return new Date(Date.now() + ttlSeconds * 1000).toISOString();
  }

  private siteUrl(slug: string): string {
    return `https://${slug}.${this.publicSiteDomain}`;
  }

  private optionalTrimmedString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private requireNotExpired(publish: Publish): void {
    if (!publish.ownerUserId && publish.expiresAt && Date.parse(publish.expiresAt) <= Date.now()) {
      throw new Error('Publish has expired.');
    }
  }

  private randomToken(prefix: string, byteLength = 32): string {
    const bytes = this.randomBytes(byteLength);
    return `${prefix}_${this.base64Url(bytes)}`;
  }

  private randomSlugSuffix(): string {
    return this.hex(this.randomBytes(12));
  }

  private randomBytes(byteLength: number): Uint8Array {
    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  private hex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private base64Url(bytes: Uint8Array): string {
    let value = '';
    for (const byte of bytes) {
      value += String.fromCharCode(byte);
    }
    return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private async hashSecret(secret: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return `sha256:${this.base64Url(new Uint8Array(digest))}`;
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);
    let difference = leftBytes.byteLength ^ rightBytes.byteLength;
    const maxLength = Math.max(leftBytes.byteLength, rightBytes.byteLength);
    for (let index = 0; index < maxLength; index += 1) {
      difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
    }
    return difference === 0;
  }
}
