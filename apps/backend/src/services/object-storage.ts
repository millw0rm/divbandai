import type { ObjectStorageConfig } from '../config.ts';
import { PUBLISHING_LIMITS } from '../publishing/limits.ts';

export interface PresignPutInput {
  key: string;
  contentType: string;
  contentLength: number;
  checksumSha256: string;
  expiresAt: string;
}

export interface PresignedPutObject {
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface StoredObjectMetadata {
  key: string;
  contentLength: number;
  checksumSha256: string;
}

export interface ObjectStorage {
  bucket: string;
  stagingPrefix: string;
  livePrefix: string;
  presignPut(input: PresignPutInput): PresignedPutObject;
  headObject(key: string): Promise<StoredObjectMetadata | undefined>;
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

export interface ObjectStorageOptions extends Partial<ObjectStorageConfig> {
  uploadBaseUrl?: string;
  stagingPrefix?: string;
  livePrefix?: string;
}

export class InMemoryObjectStorage implements ObjectStorage {
  readonly bucket: string;
  readonly stagingPrefix: string;
  readonly livePrefix: string;
  private readonly uploadBaseUrl: string;
  private readonly objects = new Map<string, StoredObjectMetadata>();

  constructor(options: ObjectStorageOptions = {}) {
    this.bucket = options.bucket ?? 'divband-local';
    this.stagingPrefix = this.normalizePrefix(options.stagingPrefix ?? 'staging');
    this.livePrefix = this.normalizePrefix(options.livePrefix ?? 'sites');
    this.uploadBaseUrl = (options.uploadBaseUrl ?? 'https://uploads.divband.local').replace(/\/+$/, '');
  }

  presignPut(input: PresignPutInput): PresignedPutObject {
    const expiresInSeconds = Math.max(0, Math.min(PUBLISHING_LIMITS.uploadPlan.expiresInSeconds, Math.ceil((Date.parse(input.expiresAt) - Date.now()) / 1000)));
    const params = new URLSearchParams({
      bucket: this.bucket,
      key: input.key,
      expires: input.expiresAt,
      checksum: input.checksumSha256,
      length: String(input.contentLength),
    });
    return {
      url: `${this.uploadBaseUrl}/${encodeURIComponent(this.bucket)}/${input.key.split('/').map(encodeURIComponent).join('/')}?${params.toString()}`,
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.contentLength),
        'x-amz-checksum-sha256': input.checksumSha256,
        'x-divband-content-sha256': input.checksumSha256,
      },
      expiresInSeconds,
    };
  }

  async headObject(key: string): Promise<StoredObjectMetadata | undefined> {
    return this.objects.get(key);
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const source = this.objects.get(sourceKey);
    if (!source) {
      throw new Error(`Object not found: ${sourceKey}`);
    }
    this.objects.set(destinationKey, { ...source, key: destinationKey });
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  putUploadedObject(metadata: StoredObjectMetadata): void {
    this.objects.set(metadata.key, metadata);
  }

  private normalizePrefix(prefix: string): string {
    return prefix.replace(/^\/+|\/+$/g, '');
  }
}
