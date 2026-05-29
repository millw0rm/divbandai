import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';
import { URL } from 'node:url';
import { BackendService } from './backend-service.ts';
import { loadBackendConfig } from './config.ts';
import { createObjectStorage } from './services/object-storage.ts';
import { StaticServingService } from './services/static-serving.ts';
import { createManagedDnsProvider } from './services/managed-dns.ts';
import { createRuntimeStore } from './runtime-store.ts';
import type { ApiRequest, ApiResponse } from './models.ts';

const config = loadBackendConfig();
const runtimeStore = await createRuntimeStore(config.databaseUrl);
const objectStorage = createObjectStorage(config.objectStorage, localUploadBaseUrl());
const managedDnsProvider = createManagedDnsProvider(config.managedDns);
const staticServing = new StaticServingService(runtimeStore.store, { platformDomain: config.publicSiteDomain });
const backend = new BackendService(runtimeStore.store, {
  apiBaseUrl: config.apiBaseUrl,
  publicSiteDomain: config.publicSiteDomain,
  objectStorage,
  managedDnsProvider,
  managedDnsDefaultTtlSeconds: config.managedDns.defaultTtlSeconds,
  managedDnsPlatformIngressTarget: config.managedDns.platformIngressTarget,
  managedDnsApexRecordType: config.managedDns.apexRecordType,
});

const server = createServer(async (nodeRequest, nodeResponse) => {
  try {
    if (nodeRequest.method === 'GET' && nodeRequest.url === '/healthz') {
      send(nodeResponse, { status: 200, body: { ok: true } });
      return;
    }

    if (nodeRequest.method === 'PUT' && await handleLocalObjectUpload(nodeRequest, nodeResponse)) {
      await runtimeStore.persist();
      return;
    }

    if ((nodeRequest.method === 'GET' || nodeRequest.method === 'HEAD') && await handleStaticSiteRequest(nodeRequest, nodeResponse)) {
      return;
    }

    const apiRequest = await toApiRequest(nodeRequest);
    const apiResponse = await backend.handle(apiRequest);
    await runtimeStore.persist();
    send(nodeResponse, apiResponse);
  } catch (error) {
    send(nodeResponse, {
      status: 500,
      body: {
        error: {
          code: 'internal_error',
          message: error instanceof Error ? error.message : 'Unexpected backend error.',
        },
      },
    });
  }
});

server.listen(config.port, () => {
  console.log(`divband backend listening on ${config.apiBaseUrl} (port ${config.port})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void runtimeStore.close().finally(() => {
        process.exitCode = 0;
      });
    });
  });
}


function localUploadBaseUrl(): string {
  if (config.objectStorage.provider === 's3' || config.objectStorage.accessKeyId || config.objectStorage.secretAccessKey) {
    return `https://${config.uploadDomain}`;
  }
  return config.apiBaseUrl;
}

async function handleLocalObjectUpload(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (config.objectStorage.provider === 's3' || config.objectStorage.accessKeyId || config.objectStorage.secretAccessKey) {
    return false;
  }

  const url = new URL(request.url ?? '/', config.apiBaseUrl);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [bucket, ...keyParts] = parts;
  if (bucket !== objectStorage.bucket || keyParts.length === 0) {
    return false;
  }

  const key = keyParts.join('/');
  const expectedKey = url.searchParams.get('key');
  const expectedChecksum = url.searchParams.get('checksum');
  const expectedLength = Number.parseInt(url.searchParams.get('length') ?? '', 10);
  const expiresAt = url.searchParams.get('expires');
  if (expectedKey !== key || !expectedChecksum || !Number.isFinite(expectedLength) || !expiresAt) {
    send(response, { status: 400, body: { error: { code: 'invalid_upload_url', message: 'Upload URL is missing required constraints.' } } });
    return true;
  }
  if (Date.parse(expiresAt) <= Date.now()) {
    send(response, { status: 403, body: { error: { code: 'upload_url_expired', message: 'Upload URL has expired.' } } });
    return true;
  }

  const body = await readRawBody(request);
  const checksum = sha256Base64Url(body);
  if (body.byteLength !== expectedLength || checksum !== expectedChecksum) {
    send(response, { status: 400, body: { error: { code: 'upload_mismatch', message: 'Uploaded object does not match the presigned length or checksum.' } } });
    return true;
  }

  await objectStorage.putObject({ key, body, checksumSha256: checksum });
  send(response, { status: 200, body: { object: { bucket, key, contentLength: body.byteLength, checksumSha256: checksum } } });
  return true;
}

async function handleStaticSiteRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const host = request.headers.host;
  if (typeof host !== 'string') {
    return false;
  }

  const resolution = staticServing.resolve({ host, path: request.url ?? '/' });
  if (resolution.type === 'not-found' && resolution.reason === 'unknown-host') {
    return false;
  }
  if (resolution.type === 'not-found') {
    response.statusCode = 404;
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.end(`Static site object not found: ${resolution.reason}`);
    return true;
  }
  if (resolution.type === 'directory-listing') {
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><title>Index of ${escapeHtml(resolution.requestPath)}</title><ul>${resolution.entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`);
    return true;
  }

  const object = await objectStorage.getObject(resolution.storageKey);
  if (!object) {
    response.statusCode = 404;
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.end('Static site object metadata exists but storage content is missing.');
    return true;
  }
  response.statusCode = 200;
  response.setHeader('content-type', resolution.contentType);
  response.setHeader('content-length', object.body.byteLength);
  response.end(request.method === 'HEAD' ? undefined : object.body);
  return true;
}

async function readRawBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', resolve);
    request.on('error', reject);
  });
  return concat(chunks);
}

function sha256Base64Url(body: Uint8Array): string {
  return `sha256-${createHash('sha256').update(body).digest('base64url')}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character);
}

async function toApiRequest(request: IncomingMessage): Promise<ApiRequest> {
  const url = new URL(request.url ?? '/', config.apiBaseUrl);
  return {
    method: request.method ?? 'GET',
    path: `${url.pathname}${url.search}`,
    headers: normalizeHeaders(request.headers),
    body: await readJsonBody(request),
  };
}

function normalizeHeaders(headers: IncomingMessage['headers']): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return normalized;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', resolve);
    request.on('error', reject);
  });

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = new TextDecoder().decode(concat(chunks));
  return raw.trim() ? JSON.parse(raw) : undefined;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function send(response: ServerResponse, apiResponse: ApiResponse): void {
  response.statusCode = apiResponse.status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(apiResponse.body));
}
