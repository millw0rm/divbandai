import { createHash, createHmac } from 'node:crypto';
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
    this.stagingPrefix = normalizePrefix(options.stagingPrefix ?? 'staging');
    this.livePrefix = normalizePrefix(options.livePrefix ?? 'sites');
    this.uploadBaseUrl = (options.uploadBaseUrl ?? 'https://uploads.divband.local').replace(/\/+$/, '');
  }

  presignPut(input: PresignPutInput): PresignedPutObject {
    const expiresInSeconds = secondsUntil(input.expiresAt);
    const params = new URLSearchParams({
      bucket: this.bucket,
      key: input.key,
      expires: input.expiresAt,
      checksum: input.checksumSha256,
      length: String(input.contentLength),
    });
    return {
      url: `${this.uploadBaseUrl}/${encodeURIComponent(this.bucket)}/${input.key.split('/').map(encodeURIComponent).join('/')}?${params.toString()}`,
      headers: uploadHeaders(input),
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
}

export interface S3ObjectStorageOptions extends ObjectStorageConfig {
  uploadBaseUrl?: string;
}

export class S3ObjectStorage implements ObjectStorage {
  readonly bucket: string;
  readonly stagingPrefix: string;
  readonly livePrefix: string;
  private readonly endpoint?: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly forcePathStyle: boolean;

  constructor(options: S3ObjectStorageOptions) {
    if (!options.bucket) {
      throw new Error('OBJECT_STORAGE_BUCKET is required for S3 object storage.');
    }
    if (!options.accessKeyId || !options.secretAccessKey) {
      throw new Error('OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY are required for S3 object storage.');
    }
    this.bucket = options.bucket;
    this.endpoint = options.endpoint?.replace(/\/+$/, '');
    this.region = options.region ?? 'us-east-1';
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.forcePathStyle = options.forcePathStyle;
    this.stagingPrefix = normalizePrefix(options.stagingPrefix);
    this.livePrefix = normalizePrefix(options.livePrefix);
  }

  presignPut(input: PresignPutInput): PresignedPutObject {
    const expiresInSeconds = secondsUntil(input.expiresAt);
    const url = this.objectUrl(input.key);
    const headers = uploadHeaders(input);
    return {
      url: this.presignUrl('PUT', url, headers, expiresInSeconds),
      headers,
      expiresInSeconds,
    };
  }

  async headObject(key: string): Promise<StoredObjectMetadata | undefined> {
    const response = await this.signedFetch('HEAD', this.objectUrl(key));
    if (response.status === 404) {
      return undefined;
    }
    await this.requireOk(response, `head object ${key}`);
    const contentLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
    const checksumSha256 = response.headers.get('x-amz-meta-divband-sha256') ?? response.headers.get('x-amz-checksum-sha256');
    if (!checksumSha256) {
      throw new Error(`Object metadata missing checksum for ${key}.`);
    }
    return { key, contentLength, checksumSha256 };
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const headers = {
      'x-amz-copy-source': `/${this.bucket}/${encodeS3Key(sourceKey)}`,
      'x-amz-metadata-directive': 'COPY',
    };
    const response = await this.signedFetch('PUT', this.objectUrl(destinationKey), headers);
    await this.requireOk(response, `copy object ${sourceKey} to ${destinationKey}`);
  }

  async deleteObject(key: string): Promise<void> {
    const response = await this.signedFetch('DELETE', this.objectUrl(key));
    await this.requireOk(response, `delete object ${key}`);
  }

  private async signedFetch(method: string, url: URL, headers: Record<string, string> = {}): Promise<Response> {
    const signedHeaders = this.authorizationHeaders(method, url, headers);
    return fetch(url, { method, headers: { ...headers, ...signedHeaders } });
  }

  private async requireOk(response: Response, action: string): Promise<void> {
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to ${action}: S3 returned ${response.status}${body ? ` ${body}` : ''}`);
    }
  }

  private objectUrl(key: string): URL {
    const encodedKey = encodeS3Key(key);
    if (this.endpoint) {
      const url = new URL(this.endpoint);
      if (this.forcePathStyle) {
        url.pathname = joinUrlPath(url.pathname, this.bucket, encodedKey);
      } else {
        url.hostname = `${this.bucket}.${url.hostname}`;
        url.pathname = joinUrlPath(url.pathname, encodedKey);
      }
      return url;
    }

    if (this.forcePathStyle) {
      return new URL(`https://s3.${this.region}.amazonaws.com/${encodeURIComponent(this.bucket)}/${encodedKey}`);
    }
    return new URL(`https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodedKey}`);
  }

  private presignUrl(method: string, url: URL, headers: Record<string, string>, expiresInSeconds: number): string {
    const signingTime = signingTimestamp(new Date());
    const scope = this.credentialScope(signingTime.shortDate);
    const signedHeaders = this.signedHeaderNames({ ...headers, host: url.host });
    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Credential', `${this.accessKeyId}/${scope}`);
    url.searchParams.set('X-Amz-Date', signingTime.longDate);
    url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
    url.searchParams.set('X-Amz-SignedHeaders', signedHeaders.join(';'));

    const signature = this.signature(method, url, { ...headers, host: url.host }, signedHeaders, signingTime.longDate, scope, 'UNSIGNED-PAYLOAD');
    url.searchParams.set('X-Amz-Signature', signature);
    return url.toString();
  }

  private authorizationHeaders(method: string, url: URL, headers: Record<string, string>): Record<string, string> {
    const signingTime = signingTimestamp(new Date());
    const scope = this.credentialScope(signingTime.shortDate);
    const allHeaders = {
      ...headers,
      host: url.host,
      'x-amz-content-sha256': EMPTY_SHA256,
      'x-amz-date': signingTime.longDate,
    };
    const signedHeaders = this.signedHeaderNames(allHeaders);
    const signature = this.signature(method, url, allHeaders, signedHeaders, signingTime.longDate, scope, EMPTY_SHA256);
    return {
      'x-amz-content-sha256': EMPTY_SHA256,
      'x-amz-date': signingTime.longDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
    };
  }

  private signature(method: string, url: URL, headers: Record<string, string>, signedHeaders: string[], amzDate: string, scope: string, payloadHash: string): string {
    const canonicalRequest = [
      method,
      url.pathname || '/',
      canonicalQuery(url),
      canonicalHeaders(headers, signedHeaders),
      signedHeaders.join(';'),
      payloadHash,
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    return hmacHex(this.signingKey(scope.slice(0, 8)), stringToSign);
  }

  private signingKey(shortDate: string): Uint8Array {
    const dateKey = hmac(`AWS4${this.secretAccessKey}`, shortDate);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, 's3');
    return hmac(serviceKey, 'aws4_request');
  }

  private credentialScope(shortDate: string): string {
    return `${shortDate}/${this.region}/s3/aws4_request`;
  }

  private signedHeaderNames(headers: Record<string, string>): string[] {
    return Object.keys(headers).map((name) => name.toLowerCase()).sort();
  }
}

export function createObjectStorage(config: ObjectStorageConfig, uploadBaseUrl: string): ObjectStorage {
  if (config.provider === 'memory') {
    return new InMemoryObjectStorage({ ...config, uploadBaseUrl });
  }
  if (config.provider === 's3' || hasS3Credentials(config)) {
    return new S3ObjectStorage(config);
  }
  return new InMemoryObjectStorage({ ...config, uploadBaseUrl });
}

function hasS3Credentials(config: ObjectStorageConfig): boolean {
  return Boolean(config.accessKeyId && config.secretAccessKey);
}

function uploadHeaders(input: PresignPutInput): Record<string, string> {
  return {
    'content-type': input.contentType,
    'x-amz-checksum-sha256': input.checksumSha256,
    'x-amz-meta-divband-sha256': input.checksumSha256,
    'x-divband-content-sha256': input.checksumSha256,
  };
}

function secondsUntil(expiresAt: string): number {
  return Math.max(0, Math.min(PUBLISHING_LIMITS.uploadPlan.expiresInSeconds, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)));
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, '');
}

function encodeS3Key(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function joinUrlPath(...parts: string[]): string {
  return parts
    .map((part, index) => (index === 0 ? part.replace(/\/+$/g, '') : part.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

function signingTimestamp(date: Date): { shortDate: string; longDate: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { shortDate: iso.slice(0, 8), longDate: iso };
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .sort(([leftName, leftValue], [rightName, rightValue]) => leftName === rightName ? leftValue.localeCompare(rightValue) : leftName.localeCompare(rightName))
    .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
    .join('&');
}

function canonicalHeaders(headers: Record<string, string>, signedHeaders: string[]): string {
  const normalized = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')]));
  return signedHeaders.map((name) => `${name}:${normalized.get(name) ?? ''}\n`).join('');
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Uint8Array, value: string): Uint8Array {
  return createHmac('sha256', key).update(value).digest();
}

function hmacHex(key: string | Uint8Array, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

const EMPTY_SHA256 = sha256Hex('');
