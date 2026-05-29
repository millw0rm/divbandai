import type {
  AuthActor,
  Publish,
  PublishFileManifest,
  PublishRequest,
  PublishResponse,
  PublishUploadPlan,
  PublishVersion,
} from '../models';
import type { BackendStore } from '../store';
import { createId, normalizeSlug, nowIso } from '../utils';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 30;

export class PublishingService {
  constructor(private readonly store: BackendStore) {}

  async create(input: PublishRequest, actor?: AuthActor): Promise<PublishResponse> {
    const files = this.filesFromInput(input.files);
    const timestamp = nowIso();
    const slug = this.uniqueSlug(this.slugFromFiles(files));
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

    this.store.publishes.set(slug, publish);
    return this.responseFor(publish, version, this.uploadPlan(files), [], claimToken);
  }

  async update(slug: string, input: PublishRequest & { claimToken?: unknown }, actor?: AuthActor): Promise<PublishResponse> {
    const publish = this.requirePublish(slug);
    await this.requireWriteAccess(publish, actor, input.claimToken);
    this.requireNotExpired(publish);
    const files = this.filesFromInput(input.files);
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

    return this.responseFor(publish, version, this.uploadPlan(uploads), skipped);
  }

  finalize(slug: string, versionId: unknown): Publish {
    if (typeof versionId !== 'string' || !versionId.trim()) {
      throw new Error('versionId is required.');
    }
    const publish = this.requirePublish(slug);
    this.requireNotExpired(publish);
    const version = publish.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new Error('Publish version not found.');
    }

    version.status = 'live';
    version.finalizedAt = nowIso();
    publish.liveVersionId = version.id;
    publish.updatedAt = nowIso();
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

  list(actor: AuthActor): Publish[] {
    return [...this.store.publishes.values()].filter((publish) => publish.ownerUserId === actor.user.id);
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
      finalizeUrl: `https://api.divband.local/api/v1/publish/${publish.slug}/finalize`,
      expiresInSeconds,
      claimToken,
      claimUrl: claimToken ? `https://api.divband.local/api/v1/publish/${publish.slug}/claim` : undefined,
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

  private uploadPlan(files: PublishFileManifest[]): PublishUploadPlan[] {
    return files.map((file) => ({
      path: file.path,
      method: 'PUT',
      url: `https://uploads.divband.local/${encodeURIComponent(file.hash)}/${encodeURIComponent(file.path)}`,
      headers: {
        'content-type': file.contentType,
        'x-divband-content-sha256': file.hash,
      },
      expiresInSeconds: 900,
    }));
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

  private uniqueSlug(base: string): string {
    let candidate = `${base}-${this.randomSlugSuffix()}`;
    let suffix = 1;
    while (this.store.publishes.has(candidate)) {
      suffix += 1;
      candidate = `${base}-${this.randomSlugSuffix()}-${suffix}`;
    }
    return candidate;
  }

  private ttlSeconds(value: unknown): number {
    if (typeof value === 'undefined') {
      return DEFAULT_TTL_SECONDS;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error('ttlSeconds must be a positive number.');
    }
    return Math.min(Math.floor(value), MAX_TTL_SECONDS);
  }

  private expiresAt(ttlSeconds: number): string {
    return new Date(Date.now() + ttlSeconds * 1000).toISOString();
  }

  private siteUrl(slug: string): string {
    return `https://${slug}.divband.site`;
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
