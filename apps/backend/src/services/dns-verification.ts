import { Resolver, resolve4, resolve6, resolveTxt } from 'node:dns/promises';
import { createSocket } from 'node:dgram';
import { createId } from '../utils.ts';

export interface DnsVerificationChallenge {
  token: string;
  recordName: string;
  recordType: 'TXT';
  recordValue: string;
}

export interface DnsDelegationConflictRecord {
  source: string;
  type: 'A' | 'AAAA' | 'CNAME';
  values: string[];
}

export interface DnsDelegationVerificationResult {
  verified: boolean;
  reason?: string;
  observedNameservers: string[];
  parentNameservers: string[];
  publicResolverNameservers: string[];
  missingNameservers: string[];
  unexpectedNameservers: string[];
  conflictRecords: DnsDelegationConflictRecord[];
}

interface NameserverObservation {
  source: string;
  records: string[];
}

const DNS_NOT_READY_CODES = new Set(['ENOTFOUND', 'ENODATA', 'ETIMEOUT', 'SERVFAIL', 'ECONNREFUSED', 'EAI_AGAIN']);
const DEFAULT_PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];
const DNS_TYPE = { A: 1, NS: 2, CNAME: 5, AAAA: 28 } as const;

export class DnsVerificationService {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  createChallenge(hostname: string): DnsVerificationChallenge {
    const token = createId('dns');
    return {
      token,
      recordName: `_divband.${hostname}`,
      recordType: 'TXT',
      recordValue: `divband-verification=${token}`,
    };
  }

  async verify(hostname: string, expectedToken: string, observedToken?: string): Promise<boolean> {
    const expectedValue = `divband-verification=${expectedToken}`;
    if (this.testShortcutsEnabled() && (observedToken === expectedToken || hostname.endsWith('.test'))) {
      return true;
    }

    const records = [
      ...await this.lookupTxtRecords(`_divband.${hostname}`),
      ...await this.lookupTxtRecords(`_divband-challenge.${hostname}`),
    ];
    return records.some((record) => record === expectedValue || record === expectedToken);
  }

  async verifyDelegation(hostname: string, expectedNameservers: string[]): Promise<DnsDelegationVerificationResult> {
    const normalizedHostname = normalizeDnsName(hostname);
    const expected = uniqueNormalizedNames(expectedNameservers);
    if (expected.length === 0) {
      return this.delegationResult(false, [], [], [], [], [], [], 'Delegation cannot be verified because no managed-provider nameservers are assigned yet.');
    }

    const [publicObservations, parentObservations, conflicts] = await Promise.all([
      this.queryPublicResolverNameservers(normalizedHostname),
      this.queryParentNameservers(normalizedHostname),
      this.queryDelegationPointConflicts(normalizedHostname),
    ]);

    const publicResolverNameservers = uniqueNormalizedNames(publicObservations.flatMap((observation) => observation.records));
    const parentNameservers = uniqueNormalizedNames(parentObservations.flatMap((observation) => observation.records));
    const observedNameservers = uniqueNormalizedNames([...publicResolverNameservers, ...parentNameservers]);
    const missingNameservers = expected.filter((nameserver) => !observedNameservers.includes(nameserver));
    const unexpectedNameservers = observedNameservers.filter((nameserver) => !expected.includes(nameserver));
    const queriedSources = publicObservations.length + parentObservations.length;
    const sourceFailures = [...publicObservations, ...parentObservations].filter((observation) => observation.records.length === 0).length;

    if (conflicts.length > 0) {
      return this.delegationResult(false, observedNameservers, parentNameservers, publicResolverNameservers, missingNameservers, unexpectedNameservers, conflicts, formatConflictReason(normalizedHostname, conflicts));
    }

    if (observedNameservers.length === 0) {
      return this.delegationResult(false, observedNameservers, parentNameservers, publicResolverNameservers, missingNameservers, unexpectedNameservers, conflicts, `Missing delegation: no NS records for ${normalizedHostname} were visible from public resolvers or authoritative parent nameservers. Add NS records pointing to ${expected.join(', ')}.`);
    }

    if (missingNameservers.length > 0 && unexpectedNameservers.length > 0) {
      return this.delegationResult(false, observedNameservers, parentNameservers, publicResolverNameservers, missingNameservers, unexpectedNameservers, conflicts, `Partial delegation with stale nameservers: ${normalizedHostname} is missing ${missingNameservers.join(', ')} and still returns unexpected NS records ${unexpectedNameservers.join(', ')}. Replace the delegation with ${expected.join(', ')}.`);
    }

    if (missingNameservers.length > 0) {
      return this.delegationResult(false, observedNameservers, parentNameservers, publicResolverNameservers, missingNameservers, unexpectedNameservers, conflicts, `Partial delegation: ${normalizedHostname} is missing expected NS records ${missingNameservers.join(', ')}. Publish the complete managed-provider nameserver set: ${expected.join(', ')}.`);
    }

    if (unexpectedNameservers.length > 0) {
      return this.delegationResult(false, observedNameservers, parentNameservers, publicResolverNameservers, missingNameservers, unexpectedNameservers, conflicts, `Stale nameservers: ${normalizedHostname} still returns unexpected NS records ${unexpectedNameservers.join(', ')}. Remove them so only ${expected.join(', ')} remain.`);
    }

    if (queriedSources > 0 && sourceFailures > 0) {
      return this.delegationResult(false, observedNameservers, parentNameservers, publicResolverNameservers, missingNameservers, unexpectedNameservers, conflicts, `Partial delegation: some public resolvers or parent nameservers have not observed the complete NS set for ${normalizedHostname} yet. Wait for DNS propagation, then retry.`);
    }

    return this.delegationResult(true, observedNameservers, parentNameservers, publicResolverNameservers, [], [], []);
  }

  private async lookupTxtRecords(recordName: string): Promise<string[]> {
    try {
      const answers = await resolveTxt(recordName);
      return answers.map((chunks) => chunks.join(''));
    } catch (error) {
      if (isDnsNotReadyError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async queryPublicResolverNameservers(hostname: string): Promise<NameserverObservation[]> {
    const resolvers = this.publicResolvers();
    return Promise.all(resolvers.map(async (server) => ({
      source: `public resolver ${server}`,
      records: await this.resolveNsWithServer(hostname, server),
    })));
  }

  private async queryParentNameservers(hostname: string): Promise<NameserverObservation[]> {
    const authoritativeServers = await this.parentAuthoritativeServers(hostname);
    return Promise.all(authoritativeServers.map(async (server) => ({
      source: `parent nameserver ${server}`,
      records: await this.queryAuthoritativeRecords(hostname, 'NS', server, true),
    })));
  }

  private async queryDelegationPointConflicts(hostname: string): Promise<DnsDelegationConflictRecord[]> {
    const authoritativeServers = await this.parentAuthoritativeServers(hostname);
    const conflictSets = await Promise.all(authoritativeServers.map(async (server) => {
      const [a, aaaa, cname] = await Promise.all([
        this.queryAuthoritativeRecords(hostname, 'A', server, false),
        this.queryAuthoritativeRecords(hostname, 'AAAA', server, false),
        this.queryAuthoritativeRecords(hostname, 'CNAME', server, false),
      ]);
      return [
        ...recordConflict(`parent nameserver ${server}`, 'A', a),
        ...recordConflict(`parent nameserver ${server}`, 'AAAA', aaaa),
        ...recordConflict(`parent nameserver ${server}`, 'CNAME', cname),
      ];
    }));
    return conflictSets.flat();
  }

  private async parentAuthoritativeServers(hostname: string): Promise<string[]> {
    const parentZone = parentDnsZone(hostname);
    if (!parentZone) {
      return [];
    }

    const parentNameservers = await this.resolveNsWithDefault(parentZone);
    const parentAddresses = await Promise.all(parentNameservers.map(async (nameserver) => this.addressesForNameserver(nameserver)));
    return uniqueNormalizedAddresses(parentAddresses.flat());
  }

  private async queryAuthoritativeRecords(hostname: string, recordType: 'A' | 'AAAA' | 'CNAME' | 'NS', server: string, includeAuthority: boolean): Promise<string[]> {
    try {
      return uniqueNormalizedNames(await queryDnsServer(hostname, recordType, server, includeAuthority));
    } catch (error) {
      if (isDnsNotReadyError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async resolveNsWithDefault(hostname: string): Promise<string[]> {
    try {
      const resolver = new Resolver({ timeout: 2500, tries: 2 });
      return uniqueNormalizedNames(await resolver.resolveNs(hostname));
    } catch (error) {
      if (isDnsNotReadyError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async resolveNsWithServer(hostname: string, server: string): Promise<string[]> {
    return uniqueNormalizedNames(await this.resolveRecordsWithServer(hostname, 'NS', server));
  }

  private async resolveRecordsWithServer(hostname: string, recordType: 'A' | 'AAAA' | 'CNAME' | 'NS', server: string): Promise<string[]> {
    try {
      const resolver = new Resolver({ timeout: 2500, tries: 2 });
      resolver.setServers([server]);
      if (recordType === 'NS') {
        return await resolver.resolveNs(hostname);
      }
      if (recordType === 'CNAME') {
        return await resolver.resolveCname(hostname);
      }
      if (recordType === 'AAAA') {
        return await resolver.resolve6(hostname);
      }
      return await resolver.resolve4(hostname);
    } catch (error) {
      if (isDnsNotReadyError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async addressesForNameserver(nameserver: string): Promise<string[]> {
    const [ipv4, ipv6] = await Promise.all([
      resolve4(nameserver).catch((error: unknown) => isDnsNotReadyError(error) ? [] : Promise.reject(error)),
      resolve6(nameserver).catch((error: unknown) => isDnsNotReadyError(error) ? [] : Promise.reject(error)),
    ]);
    return [...ipv4, ...ipv6];
  }

  private publicResolvers(): string[] {
    const configured = this.env.DIVBAND_DNS_PUBLIC_RESOLVERS ?? this.env.DNS_PUBLIC_RESOLVERS;
    const resolvers = configured?.split(',').map((resolver) => resolver.trim()).filter(Boolean) ?? [];
    return resolvers.length > 0 ? resolvers : DEFAULT_PUBLIC_RESOLVERS;
  }

  private delegationResult(
    verified: boolean,
    observedNameservers: string[],
    parentNameservers: string[],
    publicResolverNameservers: string[],
    missingNameservers: string[],
    unexpectedNameservers: string[],
    conflictRecords: DnsDelegationConflictRecord[],
    reason?: string,
  ): DnsDelegationVerificationResult {
    return {
      verified,
      reason,
      observedNameservers,
      parentNameservers,
      publicResolverNameservers,
      missingNameservers,
      unexpectedNameservers,
      conflictRecords,
    };
  }

  private testShortcutsEnabled(): boolean {
    return ['1', 'true', 'yes', 'on'].includes((this.env.DIVBAND_ALLOW_TEST_DNS_VERIFICATION ?? '').toLowerCase());
  }
}

function recordConflict(source: string, type: DnsDelegationConflictRecord['type'], values: string[]): DnsDelegationConflictRecord[] {
  return values.length > 0 ? [{ source, type, values: uniqueNormalizedNames(values) }] : [];
}

function formatConflictReason(hostname: string, conflicts: DnsDelegationConflictRecord[]): string {
  const summaries = conflicts.map((conflict) => `${conflict.type} ${conflict.values.join(', ')} from ${conflict.source}`);
  return `Conflicting records: ${hostname} has non-NS records at the delegation point (${summaries.join('; ')}). Remove conflicting A, AAAA, or CNAME records before delegating the zone.`;
}

function parentDnsZone(hostname: string): string | undefined {
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length <= 1) {
    return undefined;
  }
  return labels.slice(1).join('.');
}

function normalizeDnsName(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/u, '');
}

function uniqueNormalizedNames(values: string[]): string[] {
  return [...new Set(values.map(normalizeDnsName).filter(Boolean))].sort();
}

function uniqueNormalizedAddresses(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function isDnsNotReadyError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return DNS_NOT_READY_CODES.has(String((error as { code?: unknown }).code));
  }
  return false;
}

async function queryDnsServer(hostname: string, recordType: keyof typeof DNS_TYPE, server: string, includeAuthority: boolean): Promise<string[]> {
  const query = buildDnsQuery(hostname, DNS_TYPE[recordType]);
  const family = server.includes(':') ? 'udp6' : 'udp4';
  const socket = createSocket(family);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      resolve([]);
    }, 2500);

    socket.once('error', (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
    socket.once('message', (message) => {
      clearTimeout(timeout);
      socket.close();
      try {
        resolve(parseDnsRecords(message, query.id, DNS_TYPE[recordType], includeAuthority));
      } catch (error) {
        reject(error);
      }
    });
    socket.send(query.packet, 53, server, (error) => {
      if (error) {
        clearTimeout(timeout);
        socket.close();
        reject(error);
      }
    });
  });
}

function buildDnsQuery(hostname: string, recordType: number): { id: number; packet: Uint8Array } {
  const id = Math.floor(Math.random() * 65535);
  const question = encodeDnsName(hostname);
  const packet = new Uint8Array(12 + question.length + 4);
  const view = new DataView(packet.buffer);
  view.setUint16(0, id);
  view.setUint16(2, 0);
  view.setUint16(4, 1);
  packet.set(question, 12);
  const questionEnd = 12 + question.length;
  view.setUint16(questionEnd, recordType);
  view.setUint16(questionEnd + 2, 1);
  return { id, packet };
}

function encodeDnsName(hostname: string): Uint8Array {
  const labels = hostname.split('.').filter(Boolean);
  const bytes: number[] = [];
  for (const label of labels) {
    bytes.push(label.length, ...new TextEncoder().encode(label));
  }
  bytes.push(0);
  return new Uint8Array(bytes);
}

function parseDnsRecords(message: Uint8Array, queryId: number, recordType: number, includeAuthority: boolean): string[] {
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  if (message.byteLength < 12 || view.getUint16(0) !== queryId) {
    return [];
  }

  const responseCode = view.getUint16(2) & 0x000f;
  if (responseCode !== 0) {
    return [];
  }

  const questionCount = view.getUint16(4);
  const answerCount = view.getUint16(6);
  const authorityCount = view.getUint16(8);
  let offset = 12;
  for (let index = 0; index < questionCount; index += 1) {
    offset = skipDnsName(message, offset) + 4;
  }

  const records: string[] = [];
  const parseCount = includeAuthority ? answerCount + authorityCount : answerCount;
  for (let index = 0; index < parseCount; index += 1) {
    const parsed = parseDnsRecord(message, offset, recordType);
    offset = parsed.nextOffset;
    records.push(...parsed.values);
  }
  return records;
}

function parseDnsRecord(message: Uint8Array, offset: number, requestedType: number): { nextOffset: number; values: string[] } {
  const recordOffset = skipDnsName(message, offset);
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  if (recordOffset + 10 > message.byteLength) {
    return { nextOffset: message.byteLength, values: [] };
  }

  const type = view.getUint16(recordOffset);
  const dataLength = view.getUint16(recordOffset + 8);
  const dataOffset = recordOffset + 10;
  const nextOffset = dataOffset + dataLength;
  if (type !== requestedType || nextOffset > message.byteLength) {
    return { nextOffset, values: [] };
  }

  if (type === DNS_TYPE.NS || type === DNS_TYPE.CNAME) {
    return { nextOffset, values: [readDnsName(message, dataOffset).name] };
  }
  if (type === DNS_TYPE.A && dataLength === 4) {
    return { nextOffset, values: [Array.from(message.slice(dataOffset, dataOffset + 4)).join('.')] };
  }
  if (type === DNS_TYPE.AAAA && dataLength === 16) {
    const parts: string[] = [];
    for (let index = 0; index < 16; index += 2) {
      parts.push(((message[dataOffset + index] << 8) | message[dataOffset + index + 1]).toString(16));
    }
    return { nextOffset, values: [parts.join(':')] };
  }
  return { nextOffset, values: [] };
}

function skipDnsName(message: Uint8Array, offset: number): number {
  return readDnsName(message, offset).nextOffset;
}

function readDnsName(message: Uint8Array, offset: number): { name: string; nextOffset: number } {
  const labels: string[] = [];
  let cursor = offset;
  let nextOffset = offset;
  let jumped = false;
  for (let depth = 0; depth < 32; depth += 1) {
    if (cursor >= message.byteLength) {
      return { name: labels.join('.'), nextOffset: message.byteLength };
    }
    const length = message[cursor];
    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= message.byteLength) {
        return { name: labels.join('.'), nextOffset: message.byteLength };
      }
      const pointer = ((length & 0x3f) << 8) | message[cursor + 1];
      if (!jumped) {
        nextOffset = cursor + 2;
      }
      cursor = pointer;
      jumped = true;
      continue;
    }
    if (length === 0) {
      if (!jumped) {
        nextOffset = cursor + 1;
      }
      return { name: labels.join('.'), nextOffset };
    }
    const labelStart = cursor + 1;
    const labelEnd = labelStart + length;
    if (labelEnd > message.byteLength) {
      return { name: labels.join('.'), nextOffset: message.byteLength };
    }
    labels.push(new TextDecoder().decode(message.slice(labelStart, labelEnd)));
    cursor = labelEnd;
  }
  return { name: labels.join('.'), nextOffset };
}
