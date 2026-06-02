import type { DomainDnsMode } from '../models.ts';
import type { ManagedDnsProvider, ManagedDnsRecordInput, ManagedDnsRecordType, ManagedDnsZone, ManagedDnsZoneInput } from './managed-dns.ts';

const DEFAULT_ARVAN_API_BASE = 'https://napi.arvancloud.ir/cdn/4.0/domains';
const DEFAULT_ARVAN_NAMESERVERS = ['ns1.arvancdn.ir', 'ns2.arvancdn.ir'];

export interface ArvanManagedDnsProviderOptions {
  token: string;
  apiBase?: string;
  defaultNameservers?: string[];
  autoRegisterDomain?: boolean;
}

interface ArvanDnsRecordRow {
  id: string;
  type: string;
  name: string;
  value: Record<string, unknown>;
}

export class ArvanManagedDnsProvider implements ManagedDnsProvider {
  readonly name = 'arvan';
  private readonly apiBase: string;
  private readonly token: string;
  private readonly defaultNameservers: string[];
  private readonly autoRegisterDomain: boolean;

  constructor(options: ArvanManagedDnsProviderOptions) {
    const trimmedToken = options.token.trim().replace(/^"|"$/g, '');
    if (!trimmedToken) {
      throw new Error('DNS_PROVIDER_TOKEN is required for the Arvan managed DNS provider.');
    }
    this.token = trimmedToken;
    this.apiBase = (options.apiBase ?? DEFAULT_ARVAN_API_BASE).replace(/\/+$/, '');
    this.defaultNameservers = options.defaultNameservers?.length
      ? options.defaultNameservers
      : DEFAULT_ARVAN_NAMESERVERS;
    this.autoRegisterDomain = options.autoRegisterDomain ?? true;
  }

  async ensureZone(input: ManagedDnsZoneInput): Promise<ManagedDnsZone> {
    const zoneDomain = await this.resolveZoneDomain(input.hostname);
    if (!zoneDomain) {
      throw new Error(`No Arvan CDN zone found for hostname ${input.hostname}. Register the domain in Arvan or enable auto-registration.`);
    }

    if (this.autoRegisterDomain && !input.existingProviderZoneId) {
      await this.registerDomainIfMissing(zoneDomain, input.mode);
    }

    const nameservers = await this.getAssignedNameservers(zoneDomain);
    return {
      id: zoneDomain,
      hostname: input.hostname,
      nameservers,
    };
  }

  async deleteZone(zoneId: string): Promise<void> {
    await this.request('DELETE', `/${encodeURIComponent(zoneId)}`);
  }

  async getAssignedNameservers(zoneId: string): Promise<string[]> {
    const fromDomain = await this.readNameserversFromDomain(zoneId);
    if (fromDomain.length > 0) {
      return fromDomain;
    }
    const fromNsRecords = await this.readNameserversFromDnsRecords(zoneId);
    if (fromNsRecords.length > 0) {
      return fromNsRecords;
    }
    return [...this.defaultNameservers];
  }

  async upsertRecord(zoneId: string, record: ManagedDnsRecordInput): Promise<void> {
    const relativeName = toRelativeRecordName(record.name, zoneId);
    const arvanType = toArvanRecordType(record.type);
    const payload = buildArvanRecordPayload(arvanType, relativeName, record.value, record.ttlSeconds ?? 300);
    const existing = await this.findDnsRecord(zoneId, relativeName, arvanType);

    if (existing && recordValuesMatch(existing, payload)) {
      return;
    }

    if (existing) {
      await this.request('DELETE', `/${encodeURIComponent(zoneId)}/dns-records/${encodeURIComponent(existing.id)}`);
    }

    try {
      await this.request('POST', `/${encodeURIComponent(zoneId)}/dns-records`, payload);
    } catch (error) {
      if (existing || !isDuplicateRecordError(error)) {
        throw error;
      }
    }
  }

  async deleteRecord(zoneId: string, name: string, type: ManagedDnsRecordType): Promise<void> {
    const relativeName = toRelativeRecordName(name, zoneId);
    const arvanType = toArvanRecordType(type);
    const existing = await this.findDnsRecord(zoneId, relativeName, arvanType);
    if (!existing) {
      return;
    }
    await this.request('DELETE', `/${encodeURIComponent(zoneId)}/dns-records/${encodeURIComponent(existing.id)}`);
  }

  private async registerDomainIfMissing(zoneDomain: string, mode: DomainDnsMode): Promise<void> {
    try {
      await this.request('GET', `/${encodeURIComponent(zoneDomain)}`);
      return;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    const domainType = mode === 'delegated_full_zone' ? 'full' : 'partial';
    await this.request('POST', '/dns-service', {
      domain: zoneDomain,
      domain_type: domainType,
      plan_level: 2,
    });
  }

  private async resolveZoneDomain(hostname: string): Promise<string | undefined> {
    const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
    const labels = normalized.split('.').filter(Boolean);
    if (labels.length < 2) {
      return undefined;
    }

    for (let start = 0; start <= labels.length - 2; start += 1) {
      const candidate = labels.slice(start).join('.');
      try {
        const body = await this.request<Record<string, unknown>>('GET', `/${encodeURIComponent(candidate)}`);
        if (body && typeof body.domain === 'string' && body.domain.toLowerCase() === candidate) {
          return candidate;
        }
        if (body && (body.id || body.domain)) {
          return candidate;
        }
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    }

    return normalized;
  }

  private async readNameserversFromDomain(zoneId: string): Promise<string[]> {
    try {
      const body = await this.request<Record<string, unknown>>('GET', `/${encodeURIComponent(zoneId)}`);
      return extractNameserverHosts(body);
    } catch {
      return [];
    }
  }

  private async readNameserversFromDnsRecords(zoneId: string): Promise<string[]> {
    const records = await this.listDnsRecords(zoneId);
    const hosts: string[] = [];
    for (const record of records) {
      if (record.type.toLowerCase() !== 'ns') {
        continue;
      }
      const host = readArvanValueHost(record.value, 'ns');
      if (host) {
        hosts.push(host.replace(/\.$/, '').toLowerCase());
      }
    }
    return [...new Set(hosts)];
  }

  private async listDnsRecords(zoneId: string): Promise<ArvanDnsRecordRow[]> {
    const collected: ArvanDnsRecordRow[] = [];
    let page = 1;
    let lastPage = 1;

    do {
      const body = await this.request<Record<string, unknown>>(
        'GET',
        `/${encodeURIComponent(zoneId)}/dns-records?per_page=100&page=${page}`,
      );
      const rows = extractDnsRecordRows(body);
      collected.push(...rows);
      const pagination = extractPagination(body);
      lastPage = pagination.lastPage;
      page += 1;
    } while (page <= lastPage);

    return collected;
  }

  private async findDnsRecord(zoneId: string, relativeName: string, arvanType: string): Promise<ArvanDnsRecordRow | undefined> {
    const records = await this.listDnsRecords(zoneId);
    const normalizedName = normalizeArvanRecordName(relativeName);
    return records.find(
      (record) => record.type.toLowerCase() === arvanType && normalizeArvanRecordName(record.name) === normalizedName,
    );
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      authorization: this.token,
      accept: 'application/json',
    };
    if (body !== undefined && method !== 'DELETE') {
      headers['content-type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Arvan CDN DNS API ${method} ${path} returned ${response.status}${text ? `: ${text}` : ''}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return undefined as T;
    }
    return await response.json() as T;
  }
}

export function toRelativeRecordName(recordName: string, zoneDomain: string): string {
  const zone = zoneDomain.trim().toLowerCase().replace(/\.$/, '');
  const candidate = recordName.trim().toLowerCase().replace(/\.$/, '');
  if (!candidate || candidate === zone) {
    return '@';
  }
  if (candidate === `*.${zone}`) {
    return '*';
  }
  const suffix = `.${zone}`;
  if (candidate.endsWith(suffix)) {
    const relative = candidate.slice(0, -suffix.length);
    return relative || '@';
  }
  return candidate;
}

export function toArvanRecordType(type: ManagedDnsRecordType): string {
  if (type === 'ALIAS' || type === 'ANAME') {
    return 'aname';
  }
  return type.toLowerCase();
}

export function buildArvanRecordPayload(
  arvanType: string,
  name: string,
  value: string | string[],
  ttlSeconds: number,
): Record<string, unknown> {
  const ttl = clampArvanTtl(ttlSeconds);
  const cloudDefault = ['a', 'aaaa', 'cname', 'aname'].includes(arvanType);

  if (arvanType === 'txt') {
    const text = Array.isArray(value) ? value.join(' ') : value;
    return {
      type: 'txt',
      name,
      ttl,
      cloud: false,
      value: { text },
    };
  }

  if (arvanType === 'cname') {
    const target = Array.isArray(value) ? value[0] : value;
    return {
      type: 'cname',
      name,
      ttl,
      cloud: true,
      value: {
        cname: {
          host: ensureFqdnHost(target),
          host_header: 'source',
          port: -1,
        },
      },
    };
  }

  if (arvanType === 'aname') {
    const target = Array.isArray(value) ? value[0] : value;
    return {
      type: 'aname',
      name,
      ttl,
      cloud: true,
      value: {
        aname: {
          location: ensureFqdnHost(target),
          host_header: 'source',
          port: -1,
        },
      },
    };
  }

  if (arvanType === 'aaaa') {
    const ips = Array.isArray(value) ? value : [value];
    return {
      type: 'aaaa',
      name,
      ttl,
      cloud: cloudDefault,
      value: {
        aaaa: ips.map((ip) => ({ ip, port: -1, weight: 100, country: '' })),
      },
    };
  }

  if (arvanType === 'a') {
    const ips = Array.isArray(value) ? value : [value];
    return {
      type: 'a',
      name,
      ttl,
      cloud: cloudDefault,
      value: {
        a: ips.map((ip) => ({ ip, port: -1, weight: 100, country: '' })),
      },
    };
  }

  throw new Error(`Arvan managed DNS does not support record type ${arvanType}.`);
}

function recordValuesMatch(existing: ArvanDnsRecordRow, payload: Record<string, unknown>): boolean {
  const existingText = serializeArvanRecordValue(existing).toLowerCase();
  const nextText = serializeArvanRecordValue({
    id: existing.id,
    type: String(payload.type ?? ''),
    name: String(payload.name ?? ''),
    value: payload.value as Record<string, unknown>,
  }).toLowerCase();
  return existingText === nextText;
}

function serializeArvanRecordValue(record: ArvanDnsRecordRow): string {
  return JSON.stringify({ type: record.type, name: record.name, value: record.value });
}

function extractDnsRecordRows(body: Record<string, unknown>): ArvanDnsRecordRow[] {
  const candidates = [body.data, body.records, body.items];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    const rows: ArvanDnsRecordRow[] = [];
    for (const item of candidate) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const row = item as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id : undefined;
      const type = typeof row.type === 'string' ? row.type : undefined;
      const name = typeof row.name === 'string' ? row.name : undefined;
      const value = row.value;
      if (id && type && name && value && typeof value === 'object') {
        rows.push({ id, type, name, value: value as Record<string, unknown> });
      }
    }
    if (rows.length > 0) {
      return rows;
    }
  }
  return [];
}

function extractPagination(body: Record<string, unknown>): { lastPage: number } {
  const meta = body.meta;
  if (meta && typeof meta === 'object') {
    const pagination = (meta as Record<string, unknown>).pagination;
    if (pagination && typeof pagination === 'object') {
      const last = (pagination as Record<string, unknown>).last_page;
      if (typeof last === 'number' && last > 0) {
        return { lastPage: last };
      }
    }
  }
  const lastPage = body.last_page;
  if (typeof lastPage === 'number' && lastPage > 0) {
    return { lastPage };
  }
  return { lastPage: 1 };
}

function extractNameserverHosts(body: Record<string, unknown>): string[] {
  const keys = ['nameservers', 'ns_records', 'name_servers'];
  for (const key of keys) {
    const value = body[key];
    if (!Array.isArray(value)) {
      continue;
    }
    const hosts = value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (entry && typeof entry === 'object') {
          const host = (entry as Record<string, unknown>).host ?? (entry as Record<string, unknown>).name;
          return typeof host === 'string' ? host : undefined;
        }
        return undefined;
      })
      .filter((host): host is string => Boolean(host));
    if (hosts.length > 0) {
      return [...new Set(hosts.map((host) => host.replace(/\.$/, '').toLowerCase()))];
    }
  }
  return [];
}

function readArvanValueHost(value: Record<string, unknown>, key: string): string | undefined {
  const nested = value[key];
  if (nested && typeof nested === 'object') {
    const host = (nested as Record<string, unknown>).host;
    if (typeof host === 'string') {
      return host;
    }
  }
  const text = value.text;
  if (typeof text === 'string') {
    return text;
  }
  return undefined;
}

function normalizeArvanRecordName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed === '' ? '@' : trimmed;
}

function ensureFqdnHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) {
    throw new Error('DNS record target host is required.');
  }
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

function clampArvanTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds)) {
    return 300;
  }
  return Math.min(86400, Math.max(60, Math.round(ttlSeconds)));
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

function isDuplicateRecordError(error: unknown): boolean {
  return error instanceof Error && /duplicate/i.test(error.message);
}

export function createArvanManagedDnsProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): ArvanManagedDnsProvider {
  const token = env.DNS_PROVIDER_TOKEN?.trim();
  if (!token) {
    throw new Error('DNS_PROVIDER_TOKEN is required when DNS_PROVIDER=arvan.');
  }
  const nameservers = env.DNS_PROVIDER_ARVAN_NAMESERVERS?.split(',').map((entry) => entry.trim()).filter(Boolean);
  const autoRegister = env.DNS_PROVIDER_ARVAN_AUTO_REGISTER_DOMAIN?.trim().toLowerCase();
  return new ArvanManagedDnsProvider({
    token,
    apiBase: env.DNS_PROVIDER_ENDPOINT?.trim() || DEFAULT_ARVAN_API_BASE,
    defaultNameservers: nameservers,
    autoRegisterDomain: autoRegister ? !['0', 'false', 'no', 'off'].includes(autoRegister) : true,
  });
}
