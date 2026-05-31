import ProjectRoute from '../ProjectRoute';

export default async function ProjectRepositoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectRoute projectId={projectId} page="gitlab-repository-status" />;
}
