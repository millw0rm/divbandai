import type { DomainDnsMode, Project, ProjectDomain } from '../models.ts';
import { createArvanManagedDnsProviderFromEnv } from './arvan-managed-dns.ts';

export type ManagedDnsRecordType = 'A' | 'AAAA' | 'ALIAS' | 'ANAME' | 'CNAME' | 'TXT' | 'NS';

export interface ManagedDnsRecordInput {
  name: string;
  type: ManagedDnsRecordType;
  value: string | string[];
  ttlSeconds?: number;
}

export interface ManagedDnsZoneInput {
  hostname: string;
  mode: DomainDnsMode;
  projectId: string;
  organizationId: string;
  existingProviderZoneId?: string;
}

export interface ManagedDnsZone {
  id: string;
  hostname: string;
  nameservers: string[];
}

export interface ManagedDnsProvider {
  readonly name: string;
  ensureZone(input: ManagedDnsZoneInput): Promise<ManagedDnsZone>;
  deleteZone(zoneId: string): Promise<void>;
  getAssignedNameservers(zoneId: string): Promise<string[]>;
  upsertRecord(zoneId: string, record: ManagedDnsRecordInput): Promise<void>;
  deleteRecord(zoneId: string, name: string, type: ManagedDnsRecordType): Promise<void>;
}

export interface ManagedDnsServiceOptions {
  defaultTtlSeconds?: number;
  platformIngressTarget?: string;
  apexRecordType?: 'ALIAS' | 'ANAME' | 'A' | 'AAAA';
}

export interface ManagedDnsConfig {
  provider: 'disabled' | 'http' | 'arvan';
  endpoint?: string;
  token?: string;
  defaultTtlSeconds: number;
  platformIngressTarget?: string;
  apexRecordType: 'ALIAS' | 'ANAME' | 'A' | 'AAAA';
}

export class ManagedDnsService {
  private readonly defaultTtlSeconds: number;
  private readonly platformIngressTarget?: string;
  private readonly apexRecordType: 'ALIAS' | 'ANAME' | 'A' | 'AAAA';

  constructor(private readonly provider: ManagedDnsProvider = new DisabledManagedDnsProvider(), options: ManagedDnsServiceOptions = {}) {
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 300;
    this.platformIngressTarget = options.platformIngressTarget;
    this.apexRecordType = options.apexRecordType ?? 'ALIAS';
  }

  isEnabled(): boolean {
    return !(this.provider instanceof DisabledManagedDnsProvider);
  }

  async ensureDelegatedZone(project: Project, domain: ProjectDomain): Promise<ProjectDomain> {
    if (!isDelegatedDnsMode(domain.dnsMode)) {
      return domain;
    }

    const zone = await this.provider.ensureZone({
      hostname: domain.hostname,
      mode: domain.dnsMode,
      projectId: project.id,
      organizationId: project.organizationId,
      existingProviderZoneId: domain.providerZoneId,
    });

    domain.providerZoneId = zone.id;
    domain.assignedNameservers = zone.nameservers.length > 0 ? zone.nameservers : await this.provider.getAssignedNameservers(zone.id);
    return domain;
  }

  async deleteDelegatedZone(domain: ProjectDomain): Promise<void> {
    if (domain.providerZoneId && isDelegatedDnsMode(domain.dnsMode)) {
      await this.provider.deleteZone(domain.providerZoneId);
    }
  }

  async createVerificationRecord(domain: ProjectDomain): Promise<void> {
    const zone = this.requireZone(domain);
    await zone.provider.upsertRecord(zone.id, {
      name: domain.verificationName,
      type: 'TXT',
      value: domain.verificationValue,
      ttlSeconds: this.defaultTtlSeconds,
    });
  }

  async createApplicationRecord(project: Project, domain: ProjectDomain): Promise<void> {
    const zone = this.requireZone(domain);
    const target = this.applicationTarget(project, domain);
    await zone.provider.upsertRecord(zone.id, {
      name: domain.hostname,
      type: Array.isArray(target) ? 'A' : this.applicationRecordType(domain, target),
      value: target,
      ttlSeconds: this.defaultTtlSeconds,
    });
  }

  async createWildcardRecord(project: Project, domain: ProjectDomain): Promise<void> {
    const zone = this.requireZone(domain);
    const target = this.applicationTarget(project, domain);
    await zone.provider.upsertRecord(zone.id, {
      name: `*.${domain.hostname}`,
      type: Array.isArray(target) ? 'A' : this.applicationRecordType(domain, target),
      value: target,
      ttlSeconds: this.defaultTtlSeconds,
    });
  }

  async createAcmeChallengeRecord(domain: ProjectDomain, value: string, recordName?: string): Promise<void> {
    const zone = this.requireZone(domain);
    await zone.provider.upsertRecord(zone.id, {
      name: this.acmeChallengeName(domain, recordName),
      type: 'TXT',
      value,
      ttlSeconds: this.defaultTtlSeconds,
    });
  }

  async deleteAcmeChallengeRecord(domain: ProjectDomain, recordName?: string): Promise<void> {
    const zone = this.requireZone(domain);
    await zone.provider.deleteRecord(zone.id, this.acmeChallengeName(domain, recordName), 'TXT');
  }

  private acmeChallengeName(domain: ProjectDomain, recordName?: string): string {
    const candidate = recordName?.trim().toLowerCase();
    if (!candidate) {
      return `_acme-challenge.${domain.hostname}`;
    }
    if (candidate.startsWith('_acme-challenge.') && (candidate === `_acme-challenge.${domain.hostname}` || candidate.endsWith(`.${domain.hostname}`))) {
      return candidate;
    }
    throw new Error('ACME challenge record must be an _acme-challenge name inside the delegated DNS zone.');
  }

  private requireZone(domain: ProjectDomain): { provider: ManagedDnsProvider; id: string } {
    if (!domain.providerZoneId || !isDelegatedDnsMode(domain.dnsMode)) {
      throw new Error('Managed DNS zone is required for this operation.');
    }
    return { provider: this.provider, id: domain.providerZoneId };
  }

  private applicationTarget(project: Project, domain: ProjectDomain): string | string[] {
    const configuredTarget = this.platformIngressTarget ?? project.platformHostname;
    return domain.dnsTarget ?? configuredTarget;
  }

  private applicationRecordType(domain: ProjectDomain, target: string): ManagedDnsRecordType {
    if (domain.dnsMode === 'delegated_full_zone' && domain.hostname.split('.').length === 2) {
      return this.apexRecordType;
    }
    return looksLikeIpAddress(target) ? (target.includes(':') ? 'AAAA' : 'A') : 'CNAME';
  }
}

export class DisabledManagedDnsProvider implements ManagedDnsProvider {
  readonly name = 'disabled';

  async ensureZone(input: ManagedDnsZoneInput): Promise<ManagedDnsZone> {
    return { id: input.existingProviderZoneId ?? '', hostname: input.hostname, nameservers: [] };
  }

  async deleteZone(): Promise<void> {}

  async getAssignedNameservers(): Promise<string[]> {
    return [];
  }

  async upsertRecord(): Promise<void> {
    throw new Error('Managed DNS provider is disabled.');
  }

  async deleteRecord(): Promise<void> {}
}

export interface HttpManagedDnsProviderOptions {
  endpoint: string;
  token: string;
  name?: string;
}

export class HttpManagedDnsProvider implements ManagedDnsProvider {
  readonly name: string;
  private readonly endpoint: string;
  private readonly token: string;

  constructor(options: HttpManagedDnsProviderOptions) {
    if (!options.endpoint) {
      throw new Error('DNS_PROVIDER_ENDPOINT is required for the HTTP DNS provider.');
    }
    if (!options.token) {
      throw new Error('DNS_PROVIDER_TOKEN is required for the HTTP DNS provider.');
    }
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.token = options.token;
    this.name = options.name ?? 'http';
  }

  async ensureZone(input: ManagedDnsZoneInput): Promise<ManagedDnsZone> {
    const response = await this.request<ManagedDnsZone>('PUT', `/zones/${encodeURIComponent(input.hostname)}`, input);
    return response;
  }

  async deleteZone(zoneId: string): Promise<void> {
    await this.request('DELETE', `/zones/${encodeURIComponent(zoneId)}`);
  }

  async getAssignedNameservers(zoneId: string): Promise<string[]> {
    const response = await this.request<{ nameservers: string[] }>('GET', `/zones/${encodeURIComponent(zoneId)}/nameservers`);
    return response.nameservers;
  }

  async upsertRecord(zoneId: string, record: ManagedDnsRecordInput): Promise<void> {
    await this.request('PUT', `/zones/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(record.name)}/${record.type}`, record);
  }

  async deleteRecord(zoneId: string, name: string, type: ManagedDnsRecordType): Promise<void> {
    await this.request('DELETE', `/zones/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(name)}/${type}`);
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Managed DNS provider ${this.name} returned ${response.status}${text ? ` ${text}` : ''}.`);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return await response.json() as T;
  }
}

export function createManagedDnsProvider(config: ManagedDnsConfig): ManagedDnsProvider {
  if (config.provider === 'http') {
    return new HttpManagedDnsProvider({ endpoint: config.endpoint ?? '', token: config.token ?? '' });
  }
  if (config.provider === 'arvan') {
    return createArvanManagedDnsProviderFromEnv({
      DNS_PROVIDER_TOKEN: config.token,
      DNS_PROVIDER_ENDPOINT: config.endpoint,
      DNS_PROVIDER_ARVAN_NAMESERVERS: process.env.DNS_PROVIDER_ARVAN_NAMESERVERS,
      DNS_PROVIDER_ARVAN_AUTO_REGISTER_DOMAIN: process.env.DNS_PROVIDER_ARVAN_AUTO_REGISTER_DOMAIN,
    });
  }
  return new DisabledManagedDnsProvider();
}

function isDelegatedDnsMode(dnsMode: DomainDnsMode): boolean {
  return dnsMode === 'delegated_sub_zone' || dnsMode === 'delegated_full_zone';
}

function looksLikeIpAddress(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':');
}
