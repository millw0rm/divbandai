import type { Project } from '../models.ts';

export interface KubernetesNamespace {
  name: string;
  labels: Record<string, string>;
}

export class KubernetesService {
  async provisionNamespace(project: Project): Promise<KubernetesNamespace> {
    return {
      name: project.namespace,
      labels: {
        'app.kubernetes.io/managed-by': 'divband',
        'divband.io/project-id': project.id,
      },
    };
  }
}
