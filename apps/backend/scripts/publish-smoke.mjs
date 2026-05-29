import { createHash } from 'node:crypto';
import { BackendService, createBackendStore, InMemoryObjectStorage, StaticServingService } from '../src/index.ts';

const store = createBackendStore();
const objectStorage = new InMemoryObjectStorage({ uploadBaseUrl: 'http://localhost:3000' });
const backend = new BackendService(store, {
  apiBaseUrl: 'http://localhost:3000',
  publicSiteDomain: 'localhost.test',
  objectStorage,
});
const staticServing = new StaticServingService(store, { platformDomain: 'localhost.test' });

const body = new TextEncoder().encode('<!doctype html><h1>divband publish smoke</h1>');
const hash = `sha256-${createHash('sha256').update(body).digest('base64url')}`;

const createResponse = await backend.handle({
  method: 'POST',
  path: '/api/v1/publish',
  body: {
    slug: 'smoke-site',
    spaMode: true,
    ttlSeconds: 300,
    files: [
      {
        path: 'index.html',
        size: body.byteLength,
        contentType: 'text/html; charset=utf-8',
        hash,
      },
    ],
  },
  headers: {},
});

assertStatus(createResponse.status, 202, 'create publish session');
const createBody = createResponse.body;
const upload = createBody.upload.uploads[0];
if (!upload) {
  throw new Error('Expected a presigned upload plan.');
}

await objectStorage.putObject({ key: upload.storageKey, body, checksumSha256: hash });

const finalizeResponse = await backend.handle({
  method: 'POST',
  path: '/api/v1/publish/smoke-site/finalize',
  body: { versionId: createBody.upload.versionId },
  headers: {},
});
assertStatus(finalizeResponse.status, 200, 'finalize publish');

const resolution = staticServing.resolve({ host: 'smoke-site.localhost.test', path: '/' });
if (resolution.type !== 'object') {
  throw new Error(`Expected static object resolution, received ${resolution.type}.`);
}
const served = await objectStorage.getObject(resolution.storageKey);
if (!served || new TextDecoder().decode(served.body) !== new TextDecoder().decode(body)) {
  throw new Error('Served object content did not match uploaded content.');
}

console.log('publish smoke passed');

function assertStatus(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected HTTP ${expected}, got ${actual}`);
  }
}
