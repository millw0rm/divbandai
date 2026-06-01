import WorkspaceApp from '../../../../src/WorkspaceApp';

export default async function WorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <WorkspaceApp projectId={projectId} />;
}
