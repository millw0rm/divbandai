import type { CertificateState, ProjectDomain } from '../models.ts';

export class CertificateStatusService {
  getStatus(domain: ProjectDomain): CertificateState {
    if (!domain.verified) {
      return 'not_requested';
    }

    return domain.certificateStatus === 'not_requested' ? 'pending' : domain.certificateStatus;
  }

  markRequested(domain: ProjectDomain): ProjectDomain {
    return {
      ...domain,
      certificateStatus: domain.verified ? 'pending' : 'not_requested',
    };
  }
}
