import { execFileSync } from 'node:child_process';
import type { CertificateState, ProjectDomain } from '../models.ts';

interface KubernetesCertificateList {
  items?: Array<{
    status?: {
      conditions?: Array<{ type?: string; status?: string; reason?: string }>;
      notAfter?: string;
    };
  }>;
}

interface KubernetesIngressList {
  items?: Array<{
    spec?: { rules?: Array<{ host?: string }>; tls?: Array<{ hosts?: string[] }> };
    status?: { loadBalancer?: { ingress?: unknown[] } };
  }>;
}

interface KubernetesHttpRouteList {
  items?: Array<{
    spec?: { hostnames?: string[] };
    status?: { parents?: Array<{ conditions?: Array<{ type?: string; status?: string }> }> };
  }>;
}

export class CertificateStatusService {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  getStatus(domain: ProjectDomain): CertificateState {
    if (!domain.verified) {
      return 'not_requested';
    }

    const liveStatus = this.readLiveStatus(domain);
    if (liveStatus) {
      return liveStatus;
    }

    return domain.certificateStatus === 'not_requested' ? 'pending' : domain.certificateStatus;
  }

  markRequested(domain: ProjectDomain): ProjectDomain {
    return {
      ...domain,
      certificateStatus: domain.verified ? this.getStatus({ ...domain, certificateStatus: 'pending' }) : 'not_requested',
    };
  }

  private readLiveStatus(domain: ProjectDomain): CertificateState | undefined {
    const provider = this.env.CERTIFICATE_STATUS_PROVIDER?.trim() || 'kubernetes';
    if (provider === 'disabled') {
      return undefined;
    }
    if (provider === 'dns_provider') {
      return this.readDnsProviderStatus(domain);
    }
    return this.readKubernetesStatus(domain);
  }

  private readKubernetesStatus(domain: ProjectDomain): CertificateState | undefined {
    try {
      const certificate = this.kubectlJson<KubernetesCertificateList>([
        'get',
        'certificate',
        '--all-namespaces',
        '-l',
        `divband.io/hostname=${domain.hostname}`,
        '-o',
        'json',
      ]);
      const certStatus = certificateStatus(certificate);
      if (certStatus) {
        return certStatus;
      }

      const ingress = this.kubectlJson<KubernetesIngressList>([
        'get',
        'ingress',
        '--all-namespaces',
        '-l',
        `divband.io/hostname=${domain.hostname}`,
        '-o',
        'json',
      ]);
      if ((ingress.items ?? []).some((item) => ingressMatchesHost(item, domain.hostname) && (item.status?.loadBalancer?.ingress ?? []).length > 0)) {
        return 'pending';
      }

      const route = this.kubectlJson<KubernetesHttpRouteList>([
        'get',
        'httproute',
        '--all-namespaces',
        '-o',
        'json',
      ]);
      const matchingRoute = (route.items ?? []).find((item) => (item.spec?.hostnames ?? []).includes(domain.hostname));
      if (matchingRoute) {
        const accepted = (matchingRoute.status?.parents ?? []).flatMap((parent) => parent.conditions ?? []).find((condition) => condition.type === 'Accepted');
        return accepted?.status === 'False' ? 'failed' : 'pending';
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private readDnsProviderStatus(domain: ProjectDomain): CertificateState | undefined {
    const template = this.env.DNS_PROVIDER_CERTIFICATE_STATUS_URL?.trim();
    const token = this.env.DNS_PROVIDER_API_TOKEN?.trim();
    if (!template || !token) {
      return undefined;
    }

    const url = template.replaceAll('{hostname}', encodeURIComponent(domain.hostname));
    const command = this.env.DNS_PROVIDER_STATUS_COMMAND?.trim();
    if (!command) {
      return undefined;
    }

    try {
      const output = execFileSync(command, [url, token], { encoding: 'utf8' }).trim().toLowerCase();
      if (output.includes('issued') || output.includes('active')) {
        return 'issued';
      }
      if (output.includes('failed') || output.includes('error')) {
        return 'failed';
      }
      if (output.includes('pending') || output.includes('validating')) {
        return 'pending';
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private kubectlJson<T>(args: string[]): T {
    return JSON.parse(execFileSync('kubectl', args, { encoding: 'utf8' })) as T;
  }
}

function certificateStatus(list: KubernetesCertificateList): CertificateState | undefined {
  const certificate = (list.items ?? [])[0];
  const ready = certificate?.status?.conditions?.find((condition) => condition.type === 'Ready');
  if (!ready) {
    return undefined;
  }
  if (ready.status === 'True') {
    return 'issued';
  }
  if (ready.reason === 'Failed' || ready.reason === 'Denied') {
    return 'failed';
  }
  return 'pending';
}


function ingressMatchesHost(item: NonNullable<KubernetesIngressList['items']>[number], hostname: string): boolean {
  return (item.spec?.rules ?? []).some((rule) => rule.host === hostname)
    || (item.spec?.tls ?? []).some((tls) => (tls.hosts ?? []).includes(hostname));
}
