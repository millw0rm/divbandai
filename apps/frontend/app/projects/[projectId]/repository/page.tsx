import { redirect } from 'next/navigation';

export default async function ProjectRepositoryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/projects/${encodeURIComponent(projectId)}`);
}
