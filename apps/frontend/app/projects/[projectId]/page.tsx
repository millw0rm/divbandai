import ProjectRoute from './ProjectRoute';

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectRoute projectId={projectId} page="project-overview" />;
}
