export type KubernetesConfigMode = 'disabled' | 'in_cluster' | 'kubeconfig';

export interface ObjectStorageConfig {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

export interface BackendRuntimeConfig {
  port: number;
  apiBaseUrl: string;
  publicSiteDomain: string;
  uploadDomain: string;
  databaseUrl: string;
  gitLabUrl: string;
  kubernetesConfigMode: KubernetesConfigMode;
  objectStorage: ObjectStorageConfig;
}

export function loadBackendConfig(env: Record<string, string | undefined> = process.env): BackendRuntimeConfig {
  const publicSiteDomain = required(env.PUBLIC_SITE_DOMAIN, 'PUBLIC_SITE_DOMAIN');
  const uploadDomain = env.UPLOAD_DOMAIN?.trim() || publicSiteDomain;

  return {
    port: integer(env.PORT, 3000),
    apiBaseUrl: required(env.API_BASE_URL, 'API_BASE_URL'),
    publicSiteDomain,
    uploadDomain,
    databaseUrl: env.DATABASE_URL?.trim() || 'sqlite://./data/divband-backend.sqlite',
    gitLabUrl: env.GITLAB_URL?.trim() || 'https://gitlab.com',
    kubernetesConfigMode: kubernetesMode(env.KUBERNETES_CONFIG_MODE),
    objectStorage: {
      endpoint: emptyToUndefined(env.OBJECT_STORAGE_ENDPOINT),
      region: emptyToUndefined(env.OBJECT_STORAGE_REGION),
      bucket: required(env.OBJECT_STORAGE_BUCKET, 'OBJECT_STORAGE_BUCKET'),
      accessKeyId: emptyToUndefined(env.OBJECT_STORAGE_ACCESS_KEY_ID),
      secretAccessKey: emptyToUndefined(env.OBJECT_STORAGE_SECRET_ACCESS_KEY),
      forcePathStyle: boolean(env.OBJECT_STORAGE_FORCE_PATH_STYLE, false),
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
