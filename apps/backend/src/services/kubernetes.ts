import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Project } from '../models.ts';

export interface KubernetesNamespace {
  name: string;
  labels: Record<string, string>;
  manifests: string;
  applied: boolean;
}

export interface KubernetesProvisionOptions {
  baseDir?: string;
  apply?: boolean;
  environment?: string;
  values?: Partial<KubernetesTemplateValues>;
}

export interface KubernetesTemplateValues {
  REPLACE_WITH_PROJECT_ID: string;
  REPLACE_WITH_SLUG: string;
  REPLACE_WITH_ORGANIZATION_ID: string;
  REPLACE_WITH_OWNER_ID: string;
  REPLACE_WITH_TENANT_ID: string;
  REPLACE_WITH_ENVIRONMENT: string;
  REPLACE_WITH_PLATFORM_HOSTNAME: string;
  REPLACE_WITH_TLS_SECRET_NAME: string;
  REPLACE_WITH_CLUSTER_ISSUER: string;
  REPLACE_WITH_BACKEND_IMAGE: string;
  REPLACE_WITH_FRONTEND_IMAGE: string;
  REPLACE_WITH_STATIC_IMAGE: string;
  REPLACE_WITH_WEB_IMAGE: string;
  REPLACE_WITH_BACKEND_REPLICAS: string;
  REPLACE_WITH_FRONTEND_REPLICAS: string;
  REPLACE_WITH_STATIC_REPLICAS: string;
  REPLACE_WITH_WEB_REPLICAS: string;
  REPLACE_WITH_SERVICE_PORT: string;
  REPLACE_WITH_BACKEND_CONTAINER_PORT: string;
  REPLACE_WITH_BACKEND_HEALTH_PATH: string;
  REPLACE_WITH_FRONTEND_CONTAINER_PORT: string;
  REPLACE_WITH_FRONTEND_HEALTH_PATH: string;
  REPLACE_WITH_PUBLIC_SERVICE_NAME: string;
  REPLACE_WITH_PUBLIC_SERVICE_PORT: string;
  REPLACE_WITH_VERIFIED_CUSTOM_DOMAIN: string;
  REPLACE_WITH_INGRESS_CLASS: string;
  REPLACE_WITH_CLUSTER_SECRET_STORE: string;
  REPLACE_WITH_WEB_CONTAINER_PORT: string;
  REPLACE_WITH_WEB_HEALTH_PATH: string;
  REPLACE_WITH_BACKEND_CPU_REQUEST: string;
  REPLACE_WITH_BACKEND_MEMORY_REQUEST: string;
  REPLACE_WITH_BACKEND_CPU_LIMIT: string;
  REPLACE_WITH_BACKEND_MEMORY_LIMIT: string;
  REPLACE_WITH_FRONTEND_CPU_REQUEST: string;
  REPLACE_WITH_FRONTEND_MEMORY_REQUEST: string;
  REPLACE_WITH_FRONTEND_CPU_LIMIT: string;
  REPLACE_WITH_FRONTEND_MEMORY_LIMIT: string;
  REPLACE_WITH_STATIC_CPU_REQUEST: string;
  REPLACE_WITH_STATIC_MEMORY_REQUEST: string;
  REPLACE_WITH_STATIC_CPU_LIMIT: string;
  REPLACE_WITH_STATIC_MEMORY_LIMIT: string;
  REPLACE_WITH_WEB_CPU_REQUEST: string;
  REPLACE_WITH_WEB_MEMORY_REQUEST: string;
  REPLACE_WITH_WEB_CPU_LIMIT: string;
  REPLACE_WITH_WEB_MEMORY_LIMIT: string;
  REPLACE_WITH_QUOTA_REQUESTS_CPU: string;
  REPLACE_WITH_QUOTA_REQUESTS_MEMORY: string;
  REPLACE_WITH_QUOTA_REQUESTS_STORAGE: string;
  REPLACE_WITH_QUOTA_LIMITS_CPU: string;
  REPLACE_WITH_QUOTA_LIMITS_MEMORY: string;
  REPLACE_WITH_QUOTA_PVCS: string;
  REPLACE_WITH_QUOTA_PODS: string;
  REPLACE_WITH_QUOTA_SERVICES: string;
  REPLACE_WITH_QUOTA_INGRESSES: string;
  REPLACE_WITH_QUOTA_SECRETS: string;
  REPLACE_WITH_DEFAULT_CPU_LIMIT: string;
  REPLACE_WITH_DEFAULT_MEMORY_LIMIT: string;
  REPLACE_WITH_DEFAULT_CPU_REQUEST: string;
  REPLACE_WITH_DEFAULT_MEMORY_REQUEST: string;
  REPLACE_WITH_MAX_CPU_LIMIT: string;
  REPLACE_WITH_MAX_MEMORY_LIMIT: string;
  REPLACE_WITH_MIN_CPU_REQUEST: string;
  REPLACE_WITH_MIN_MEMORY_REQUEST: string;
  REPLACE_WITH_MAX_PVC_STORAGE: string;
  REPLACE_WITH_MIN_PVC_STORAGE: string;
  REPLACE_WITH_SECRET_STORE_NAME: string;
  REPLACE_WITH_SECRET_STORE_KIND: string;
}

const DEFAULT_TEMPLATE_FILES = [
  'tenant-namespace.yaml',
  'network-policy.yaml',
  'rbac.yaml',
  'external-secret.yaml',
  'frontend-deployment.yaml',
  'backend-deployment.yaml',
  'static-site-deployment.yaml',
  'ingress.yaml',
];
const moduleDir = dirname(fileURLToPath(import.meta.url));

export class KubernetesService {
  private readonly baseDir: string;
  private readonly shouldApply: boolean;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.baseDir = env.KUBERNETES_TEMPLATE_DIR?.trim() || resolve(moduleDir, '../../../../infra/k8s/base');
    this.shouldApply = ['1', 'true', 'yes', 'on'].includes((env.KUBERNETES_APPLY ?? '').toLowerCase());
  }

  async provisionNamespace(project: Project, options: KubernetesProvisionOptions = {}): Promise<KubernetesNamespace> {
    const values = { ...this.defaultValues(project, options.environment ?? 'production'), ...options.values };
    const manifests = this.renderBaseTemplates(options.baseDir ?? this.baseDir, values);
    const apply = options.apply ?? this.shouldApply;
    if (apply) {
      execFileSync('kubectl', ['apply', '-f', '-'], { input: manifests, stdio: ['pipe', 'pipe', 'pipe'] });
    }

    return {
      name: project.namespace,
      labels: {
        'app.kubernetes.io/managed-by': 'divband',
        'divband.io/project-id': project.id,
        'divband.io/project-slug': project.slug,
        'divband.io/tenant-id': project.organizationId,
        'divband.io/environment': values.REPLACE_WITH_ENVIRONMENT,
      },
      manifests,
      applied: apply,
    };
  }

  renderBaseTemplates(baseDir: string, values: KubernetesTemplateValues): string {
    const files = DEFAULT_TEMPLATE_FILES.filter((file) => readdirSync(baseDir).includes(file));
    const replacements = new Map(Object.entries(values));
    return files.map((file) => {
      let rendered = readFileSync(resolve(baseDir, file), 'utf8');
      for (const [token, value] of replacements) {
        rendered = rendered.replaceAll(token, escapeYamlScalar(value));
      }
      const unresolved = rendered.match(/REPLACE_WITH_[A-Z0-9_]+/g);
      if (unresolved) {
        throw new Error(`Unresolved Kubernetes template tokens in ${file}: ${[...new Set(unresolved)].join(', ')}`);
      }
      return rendered.trimEnd();
    }).join('\n---\n') + '\n';
  }

  private defaultValues(project: Project, environment: string): KubernetesTemplateValues {
    const imagePrefix = process.env.DIVBAND_DEFAULT_IMAGE_PREFIX?.replace(/\/+$/, '') || 'registry.gitlab.com/divband/base';
    return {
      REPLACE_WITH_PROJECT_ID: project.id,
      REPLACE_WITH_SLUG: project.slug,
      REPLACE_WITH_ORGANIZATION_ID: project.organizationId,
      REPLACE_WITH_OWNER_ID: project.ownerId,
      REPLACE_WITH_TENANT_ID: project.organizationId,
      REPLACE_WITH_ENVIRONMENT: environment,
      REPLACE_WITH_PLATFORM_HOSTNAME: project.platformHostname,
      REPLACE_WITH_TLS_SECRET_NAME: `${project.slug}-tls`,
      REPLACE_WITH_CLUSTER_ISSUER: process.env.CERT_MANAGER_CLUSTER_ISSUER || 'letsencrypt-prod',
      REPLACE_WITH_BACKEND_IMAGE: `${imagePrefix}/backend:latest`,
      REPLACE_WITH_FRONTEND_IMAGE: `${imagePrefix}/frontend:latest`,
      REPLACE_WITH_STATIC_IMAGE: `${imagePrefix}/static-site:latest`,
      REPLACE_WITH_WEB_IMAGE: `${imagePrefix}/web:latest`,
      REPLACE_WITH_BACKEND_REPLICAS: '1',
      REPLACE_WITH_FRONTEND_REPLICAS: '1',
      REPLACE_WITH_STATIC_REPLICAS: '1',
      REPLACE_WITH_WEB_REPLICAS: '1',
      REPLACE_WITH_SERVICE_PORT: '80',
      REPLACE_WITH_BACKEND_CONTAINER_PORT: '3000',
      REPLACE_WITH_BACKEND_HEALTH_PATH: '/healthz',
      REPLACE_WITH_FRONTEND_CONTAINER_PORT: '8080',
      REPLACE_WITH_FRONTEND_HEALTH_PATH: '/',
      REPLACE_WITH_PUBLIC_SERVICE_NAME: 'static-site',
      REPLACE_WITH_PUBLIC_SERVICE_PORT: '80',
      REPLACE_WITH_VERIFIED_CUSTOM_DOMAIN: project.platformHostname,
      REPLACE_WITH_INGRESS_CLASS: process.env.KUBERNETES_INGRESS_CLASS || 'nginx',
      REPLACE_WITH_CLUSTER_SECRET_STORE: process.env.EXTERNAL_SECRET_STORE_NAME || 'divband-tenant-secrets',
      REPLACE_WITH_WEB_CONTAINER_PORT: '8080',
      REPLACE_WITH_WEB_HEALTH_PATH: '/',
      REPLACE_WITH_BACKEND_CPU_REQUEST: '100m',
      REPLACE_WITH_BACKEND_MEMORY_REQUEST: '128Mi',
      REPLACE_WITH_BACKEND_CPU_LIMIT: '500m',
      REPLACE_WITH_BACKEND_MEMORY_LIMIT: '512Mi',
      REPLACE_WITH_FRONTEND_CPU_REQUEST: '50m',
      REPLACE_WITH_FRONTEND_MEMORY_REQUEST: '64Mi',
      REPLACE_WITH_FRONTEND_CPU_LIMIT: '250m',
      REPLACE_WITH_FRONTEND_MEMORY_LIMIT: '256Mi',
      REPLACE_WITH_STATIC_CPU_REQUEST: '25m',
      REPLACE_WITH_STATIC_MEMORY_REQUEST: '64Mi',
      REPLACE_WITH_STATIC_CPU_LIMIT: '250m',
      REPLACE_WITH_STATIC_MEMORY_LIMIT: '256Mi',
      REPLACE_WITH_WEB_CPU_REQUEST: '50m',
      REPLACE_WITH_WEB_MEMORY_REQUEST: '64Mi',
      REPLACE_WITH_WEB_CPU_LIMIT: '250m',
      REPLACE_WITH_WEB_MEMORY_LIMIT: '256Mi',
      REPLACE_WITH_QUOTA_REQUESTS_CPU: '2',
      REPLACE_WITH_QUOTA_REQUESTS_MEMORY: '4Gi',
      REPLACE_WITH_QUOTA_REQUESTS_STORAGE: '10Gi',
      REPLACE_WITH_QUOTA_LIMITS_CPU: '4',
      REPLACE_WITH_QUOTA_LIMITS_MEMORY: '8Gi',
      REPLACE_WITH_QUOTA_PVCS: '4',
      REPLACE_WITH_QUOTA_PODS: '20',
      REPLACE_WITH_QUOTA_SERVICES: '10',
      REPLACE_WITH_QUOTA_INGRESSES: '5',
      REPLACE_WITH_QUOTA_SECRETS: '20',
      REPLACE_WITH_DEFAULT_CPU_LIMIT: '250m',
      REPLACE_WITH_DEFAULT_MEMORY_LIMIT: '256Mi',
      REPLACE_WITH_DEFAULT_CPU_REQUEST: '50m',
      REPLACE_WITH_DEFAULT_MEMORY_REQUEST: '64Mi',
      REPLACE_WITH_MAX_CPU_LIMIT: '1',
      REPLACE_WITH_MAX_MEMORY_LIMIT: '1Gi',
      REPLACE_WITH_MIN_CPU_REQUEST: '10m',
      REPLACE_WITH_MIN_MEMORY_REQUEST: '32Mi',
      REPLACE_WITH_MAX_PVC_STORAGE: '10Gi',
      REPLACE_WITH_MIN_PVC_STORAGE: '1Gi',
      REPLACE_WITH_SECRET_STORE_NAME: process.env.EXTERNAL_SECRET_STORE_NAME || 'divband-tenant-secrets',
      REPLACE_WITH_SECRET_STORE_KIND: process.env.EXTERNAL_SECRET_STORE_KIND || 'ClusterSecretStore',
    };
  }
}

function escapeYamlScalar(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\$/g, '$$$$');
}
