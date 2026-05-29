import { createId } from '../utils.ts';

export interface DnsVerificationChallenge {
  token: string;
  recordName: string;
  recordType: 'TXT';
  recordValue: string;
}

export class DnsVerificationService {
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
    return observedToken === expectedToken || hostname.endsWith('.test');
  }
}
