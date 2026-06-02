import { resolveInfrastructureEnv } from './infrastructure-profile.ts';

export type KubernetesConfigMode = 'disabled' | 'in_cluster' | 'kubeconfig';

export type ObjectStorageProvider = 'auto' | 'memory' | 's3';

export type ManagedDnsProviderName = 'disabled' | 'http' | 'arvan';

export type PersistenceDriver = 'memory' | 'sqlite' | 'postgres';

export interface ObjectStorageConfig {
  provider: ObjectStorageProvider;
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  stagingPrefix: string;
  livePrefix: string;
}

export interface ManagedDnsConfig {
  provider: ManagedDnsProviderName;
  endpoint?: string;
  token?: string;
  defaultTtlSeconds: number;
  platformIngressTarget?: string;
  apexRecordType: 'ALIAS' | 'ANAME' | 'A' | 'AAAA';
}

export interface BackendRuntimeConfig {
  port: number;
  apiBaseUrl: string;
  publicSiteDomain: string;
  uploadDomain: string;
  persistenceDriver: PersistenceDriver;
  databaseUrl?: string;
  gitLabUrl: string;
  kubernetesConfigMode: KubernetesConfigMode;
  requireEmailVerification: boolean;
  seedDemoData: boolean;
  objectStorage: ObjectStorageConfig;
  managedDns: ManagedDnsConfig;
}

export function loadBackendConfig(env: Record<string, string | undefined> = process.env): BackendRuntimeConfig {
  const resolvedEnv = resolveInfrastructureEnv(env);
  const publicSiteDomain = required(resolvedEnv.PUBLIC_SITE_DOMAIN, 'PUBLIC_SITE_DOMAIN');
  const uploadDomain = resolvedEnv.UPLOAD_DOMAIN?.trim() || publicSiteDomain;

  return {
    port: integer(resolvedEnv.PORT, 3000),
    apiBaseUrl: required(resolvedEnv.API_BASE_URL, 'API_BASE_URL'),
    publicSiteDomain,
    uploadDomain,
    persistenceDriver: persistenceDriver(resolvedEnv.PERSISTENCE_DRIVER, resolvedEnv.DATABASE_URL),
    databaseUrl: emptyToUndefined(resolvedEnv.DATABASE_URL),
    gitLabUrl: resolvedEnv.GITLAB_URL?.trim() || 'https://gitlab.com',
    kubernetesConfigMode: kubernetesMode(resolvedEnv.KUBERNETES_CONFIG_MODE ?? resolvedEnv.KUBERNETES_MODE),
    requireEmailVerification: boolean(resolvedEnv.DIVBAND_REQUIRE_EMAIL_VERIFICATION, true),
    seedDemoData: boolean(resolvedEnv.DIVBAND_SEED_DEMO_DATA, resolvedEnv.NODE_ENV !== 'production'),
    objectStorage: {
      provider: objectStorageProvider(resolvedEnv.OBJECT_STORAGE_PROVIDER),
      endpoint: emptyToUndefined(resolvedEnv.OBJECT_STORAGE_ENDPOINT),
      region: emptyToUndefined(resolvedEnv.OBJECT_STORAGE_REGION),
      bucket: required(resolvedEnv.OBJECT_STORAGE_BUCKET, 'OBJECT_STORAGE_BUCKET'),
      accessKeyId: emptyToUndefined(resolvedEnv.OBJECT_STORAGE_ACCESS_KEY_ID),
      secretAccessKey: emptyToUndefined(resolvedEnv.OBJECT_STORAGE_SECRET_ACCESS_KEY),
      forcePathStyle: boolean(resolvedEnv.OBJECT_STORAGE_FORCE_PATH_STYLE, false),
      stagingPrefix: resolvedEnv.OBJECT_STORAGE_STAGING_PREFIX?.trim() || 'staging',
      livePrefix: resolvedEnv.OBJECT_STORAGE_LIVE_PREFIX?.trim() || 'sites',
    },
    managedDns: {
      provider: managedDnsProvider(resolvedEnv.DNS_PROVIDER),
      endpoint: emptyToUndefined(resolvedEnv.DNS_PROVIDER_ENDPOINT),
      token: emptyToUndefined(resolvedEnv.DNS_PROVIDER_TOKEN),
      defaultTtlSeconds: integer(resolvedEnv.DNS_PROVIDER_DEFAULT_TTL_SECONDS, 300),
      platformIngressTarget: emptyToUndefined(resolvedEnv.DNS_PROVIDER_PLATFORM_INGRESS_TARGET),
      apexRecordType: managedDnsApexRecordType(resolvedEnv.DNS_PROVIDER_APEX_RECORD_TYPE),
    },
  };
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }
  return trimmed;
}

function integer(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function managedDnsProvider(value: string | undefined): ManagedDnsProviderName {
  if (value === 'http' || value === 'disabled' || value === 'arvan') {
    return value;
  }
  return 'disabled';
}

function managedDnsApexRecordType(value: string | undefined): ManagedDnsConfig['apexRecordType'] {
  if (value === 'ALIAS' || value === 'ANAME' || value === 'A' || value === 'AAAA') {
    return value;
  }
  return 'ALIAS';
}

function objectStorageProvider(value: string | undefined): ObjectStorageProvider {
  if (value === 'memory' || value === 's3' || value === 'auto') {
    return value;
  }
  return 'auto';
}

function persistenceDriver(value: string | undefined, databaseUrl: string | undefined): PersistenceDriver {
  if (value === 'memory' || value === 'sqlite' || value === 'postgres') {
    return value;
  }
  const trimmedDatabaseUrl = databaseUrl?.trim();
  if (trimmedDatabaseUrl?.startsWith('postgres://') || trimmedDatabaseUrl?.startsWith('postgresql://')) {
    return 'postgres';
  }
  if (trimmedDatabaseUrl?.startsWith('sqlite://') || trimmedDatabaseUrl?.startsWith('file:')) {
    return 'sqlite';
  }
  return 'memory';
}

function kubernetesMode(value: string | undefined): KubernetesConfigMode {
  if (value === 'in_cluster' || value === 'kubeconfig' || value === 'disabled') {
    return value;
  }
  return 'disabled';
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
