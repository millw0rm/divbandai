import { NextResponse, type NextRequest } from 'next/server';
import type { ApiRequest, ApiResponse, BackendRuntimeConfig, RuntimeStore } from '@divband/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

interface BackendRuntime {
  backend: { handle(request: ApiRequest): Promise<ApiResponse> };
  runtimeStore: RuntimeStore;
  config: BackendRuntimeConfig;
}

let backendRuntimePromise: Promise<BackendRuntime> | undefined;

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

async function handle(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const pathSegments = (await context.params).path ?? [];
  if (request.method === 'GET' && pathSegments.length === 1 && pathSegments[0] === 'healthz') {
    return NextResponse.json({ ok: true });
  }

  const { backend, runtimeStore } = await getBackendRuntime();
  const apiRequest = await toApiRequest(request, pathSegments);
  const response = await backend.handle(apiRequest);
  await runtimeStore.persist();
  if (request.method === 'GET' && (pathSegments.join('/') === 'auth/github/callback' || pathSegments.join('/') === 'auth/callback/github')) {
    const redirectTo = redirectPath(response.body);
    if (redirectTo) {
      return NextResponse.redirect(new URL(redirectTo, browserSafeOrigin(request)));
    }
    if (response.status >= 400) {
      return NextResponse.redirect(new URL(callbackErrorPath(response.body), browserSafeOrigin(request)));
    }
  }
  return NextResponse.json(response.body, { status: response.status });
}

async function getBackendRuntime(): Promise<BackendRuntime> {
  backendRuntimePromise ??= createBackendRuntime();
  return backendRuntimePromise;
}

async function createBackendRuntime(): Promise<BackendRuntime> {
  applyLocalDefaults();

  const {
    BackendService,
    createManagedDnsProvider,
    createObjectStorage,
    createRuntimeStore,
    seedDemoData,
    loadBackendConfig,
  } = await import('@divband/backend');

  const config = loadBackendConfig();
  const runtimeStore = await createRuntimeStore({
    driver: config.persistenceDriver,
    databaseUrl: config.databaseUrl,
  });
  await seedDemoData(runtimeStore.store, { enabled: config.seedDemoData, env: process.env });
  const objectStorage = createObjectStorage(config.objectStorage, localUploadBaseUrl(config));
  const managedDnsProvider = createManagedDnsProvider(config.managedDns);
  const backend = new BackendService(runtimeStore.store, {
    apiBaseUrl: config.apiBaseUrl,
    publicSiteDomain: config.publicSiteDomain,
    objectStorage,
    managedDnsProvider,
    managedDnsDefaultTtlSeconds: config.managedDns.defaultTtlSeconds,
    managedDnsPlatformIngressTarget: config.managedDns.platformIngressTarget,
    managedDnsApexRecordType: config.managedDns.apexRecordType,
    requireEmailVerification: config.requireEmailVerification,
  });

  return { backend, runtimeStore, config };
}

function applyLocalDefaults(): void {
  process.env.API_BASE_URL ??= 'http://localhost:3000';
  process.env.PUBLIC_SITE_DOMAIN ??= 'localhost.test';
  process.env.UPLOAD_DOMAIN ??= 'uploads.localhost.test';
  process.env.PERSISTENCE_DRIVER ??= 'memory';
  process.env.GITLAB_URL ??= 'https://gitlab.com';
  process.env.SOURCE_CONTROL_PROVIDER ??= 'github';
  process.env.KUBERNETES_CONFIG_MODE ??= 'disabled';
  process.env.KUBERNETES_TEMPLATE_DIR ??= '../../infra/k8s/base';
  process.env.OBJECT_STORAGE_BUCKET ??= 'divband-local';
  process.env.OBJECT_STORAGE_REGION ??= 'us-east-1';
  process.env.DIVBAND_SIGNUP_MODE ??= 'public';
  process.env.DIVBAND_REQUIRE_EMAIL_VERIFICATION ??= '0';
  process.env.DIVBAND_SEED_DEMO_DATA ??= '1';
}

function localUploadBaseUrl(config: BackendRuntimeConfig): string {
  if (config.objectStorage.provider === 's3' || config.objectStorage.accessKeyId || config.objectStorage.secretAccessKey) {
    return `https://${config.uploadDomain}`;
  }
  return config.apiBaseUrl;
}

async function toApiRequest(request: NextRequest, pathSegments: string[]): Promise<ApiRequest> {
  const path = backendPath(pathSegments, request.nextUrl.search);
  return {
    method: request.method,
    path,
    headers: Object.fromEntries(request.headers.entries()),
    body: await requestBody(request),
  };
}

function backendPath(pathSegments: string[], search: string): string {
  const normalizedPath = pathSegments.length === 0
    ? '/'
    : pathSegments[0] === 'v1'
      ? `/api/${pathSegments.map(encodeURIComponent).join('/')}`
      : `/${pathSegments.map(encodeURIComponent).join('/')}`;
  return `${normalizedPath}${search}`;
}

function redirectPath(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const value = (body as { redirectTo?: unknown }).redirectTo;
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : undefined;
}

function callbackErrorPath(body: unknown): string {
  const message = errorMessage(body) ?? 'GitHub authorization failed.';
  return `/#gitlab-repository-status?github_error=${encodeURIComponent(message)}`;
}

function errorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const error = (body as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : undefined;
}

function browserSafeOrigin(request: NextRequest): string {
  if (request.nextUrl.hostname === '0.0.0.0') {
    return `${request.nextUrl.protocol}//localhost:${request.nextUrl.port || '3000'}`;
  }
  return request.nextUrl.origin;
}

async function requestBody(request: NextRequest): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  const raw = await request.text();
  return raw.trim() ? JSON.parse(raw) : undefined;
}
