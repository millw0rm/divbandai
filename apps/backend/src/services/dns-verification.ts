import { resolveTxt } from 'node:dns/promises';
import { createId } from '../utils.ts';

export interface DnsVerificationChallenge {
  token: string;
  recordName: string;
  recordType: 'TXT';
  recordValue: string;
}

export class DnsVerificationService {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  createChallenge(hostname: string): DnsVerificationChallenge {
    const token = createId('dns');
    return {
      token,
      recordName: `_divband-challenge.${hostname}`,
      recordType: 'TXT',
      recordValue: `divband-verification=${token}`,
    };
  }

  async verify(hostname: string, expectedToken: string, observedToken?: string): Promise<boolean> {
    const expectedValue = `divband-verification=${expectedToken}`;
    if (this.testShortcutsEnabled() && (observedToken === expectedToken || hostname.endsWith('.test'))) {
      return true;
    }

    const records = await this.lookupTxtRecords(`_divband-challenge.${hostname}`);
    return records.some((record) => record === expectedValue || record === expectedToken);
  }

  private async lookupTxtRecords(recordName: string): Promise<string[]> {
    try {
      const answers = await resolveTxt(recordName);
      return answers.map((chunks) => chunks.join(''));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        const code = String((error as { code?: unknown }).code);
        if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ETIMEOUT' || code === 'SERVFAIL') {
          return [];
        }
      }
      throw error;
    }
  }

  private testShortcutsEnabled(): boolean {
    return ['1', 'true', 'yes', 'on'].includes((this.env.DIVBAND_ALLOW_TEST_DNS_VERIFICATION ?? '').toLowerCase());
  }
}
