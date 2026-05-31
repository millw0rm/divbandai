import DashboardApp from '../../../src/DashboardApp';

export default function ProjectRoute({ projectId, page }: { projectId: string; page: 'project-overview' | 'gitlab-repository-status' }) {
  return <DashboardApp initialPage={page} initialProjectId={projectId} />;
}
