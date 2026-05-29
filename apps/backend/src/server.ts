import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import process from 'node:process';
import { URL } from 'node:url';
import { BackendService } from './backend-service.ts';
import { loadBackendConfig } from './config.ts';
import { createRuntimeStore } from './runtime-store.ts';
import type { ApiRequest, ApiResponse } from './models.ts';

const config = loadBackendConfig();
const runtimeStore = await createRuntimeStore(config.databaseUrl);
const backend = new BackendService(runtimeStore.store);

const server = createServer(async (nodeRequest, nodeResponse) => {
  try {
    if (nodeRequest.method === 'GET' && nodeRequest.url === '/healthz') {
      send(nodeResponse, { status: 200, body: { ok: true } });
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
      process.exitCode = 0;
    });
  });
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
