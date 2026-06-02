/**
 * Optional infrastructure presets. Set `divband_infrastructure_profile` / `DIVBAND_INFRASTRUCTURE_PROFILE`
 * to `arvan` to apply Arvan Cloud-friendly defaults for object storage and delegated DNS.
 * Explicit env vars always win over profile defaults.
 */

export type InfrastructureProfileName = 'default' | 'arvan';

export const INFRASTRUCTURE_PROFILE_ENV = 'DIVBAND_INFRASTRUCTURE_PROFILE';

const PROFILE_DEFAULTS: Record<InfrastructureProfileName, Record<string, string>> = {
  default: {},
  arvan: {
    OBJECT_STORAGE_PROVIDER: 's3',
    OBJECT_STORAGE_ENDPOINT: 'https://s3.ir-thr-at1.arvanstorage.ir',
    OBJECT_STORAGE_REGION: 'ir-thr-at1',
    OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    DNS_PROVIDER: 'arvan',
    DNS_PROVIDER_ENDPOINT: 'https://napi.arvancloud.ir/cdn/4.0/domains',
    DNS_PROVIDER_APEX_RECORD_TYPE: 'ANAME',
    DNS_PROVIDER_ARVAN_NAMESERVERS: 'ns1.arvancdn.ir,ns2.arvancdn.ir',
    DNS_PROVIDER_ARVAN_AUTO_REGISTER_DOMAIN: 'true',
  },
};

export interface InfrastructureProfileSummary {
  name: InfrastructureProfileName;
  description: string;
  appliedDefaults: string[];
}

export function getInfrastructureProfile(env: Record<string, string | undefined>): InfrastructureProfileName {
  const raw = env[INFRASTRUCTURE_PROFILE_ENV]?.trim().toLowerCase();
  if (raw === 'arvan') {
    return 'arvan';
  }
  return 'default';
}

export function resolveInfrastructureEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const profile = getInfrastructureProfile(env);
  const resolved: Record<string, string | undefined> = { ...env };
  const defaults = PROFILE_DEFAULTS[profile];

  for (const [key, value] of Object.entries(defaults)) {
    if (!resolved[key]?.trim()) {
      resolved[key] = value;
    }
  }

  resolved[INFRASTRUCTURE_PROFILE_ENV] = profile;
  return resolved;
}

export function describeInfrastructureProfile(env: Record<string, string | undefined>): InfrastructureProfileSummary {
  const profile = getInfrastructureProfile(env);
  const defaults = PROFILE_DEFAULTS[profile];
  const appliedDefaults = Object.keys(defaults).filter((key) => !env[key]?.trim());

  const descriptions: Record<InfrastructureProfileName, string> = {
    default: 'Generic S3-compatible storage and optional HTTP managed DNS (no vendor preset).',
    arvan: 'Arvan Object Storage (AOS) and Arvan CDN DNS for delegated custom domains.',
  };

  return {
    name: profile,
    description: descriptions[profile],
    appliedDefaults,
  };
}

export function listInfrastructureProfiles(): InfrastructureProfileName[] {
  return ['default', 'arvan'];
}

/** Apply profile defaults to `process.env` without overriding variables already set. */
export function applyInfrastructureProfileToProcessEnv(
  env: Record<string, string | undefined> = process.env,
): InfrastructureProfileName {
  const profile = getInfrastructureProfile(env);
  const defaults = PROFILE_DEFAULTS[profile];
  for (const [key, value] of Object.entries(defaults)) {
    if (!env[key]?.trim()) {
      process.env[key] = value;
    }
  }
  process.env[INFRASTRUCTURE_PROFILE_ENV] = profile;
  return profile;
}
