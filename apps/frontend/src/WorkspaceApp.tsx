'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAuthToken } from './auth-session';

interface RepositoryFile {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size?: number;
}

interface ProjectInfo {
  id: string;
  name: string;
  slug: string;
  workspaceHostname: string;
  repositoryUrl?: string;
}

const starterFiles: Record<string, string> = {
  'README.md': '# Project\n\nEdit files here. Connect GitHub to sync with your repository.\n',
  'index.html': '<!doctype html>\n<html>\n  <head>\n    <title>My site</title>\n  </head>\n  <body>\n    <h1>Hello from divband</h1>\n  </body>\n</html>\n',
};

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export default function WorkspaceApp({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectInfo | undefined>();
  const [files, setFiles] = useState<RepositoryFile[]>([]);
  const [selectedPath, setSelectedPath] = useState('README.md');
  const [editorValue, setEditorValue] = useState(starterFiles['README.md']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [savedAt, setSavedAt] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(undefined);
      try {
        const projectResponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { headers: authHeaders() });
        const projectBody = await projectResponse.json() as { project?: ProjectInfo; error?: { message?: string } };
        if (!projectResponse.ok) {
          throw new Error(projectBody.error?.message ?? 'Could not load project.');
        }
        if (cancelled || !projectBody.project) {
          return;
        }

        setProject(projectBody.project);

        const contentsResponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}/repository/contents`, { headers: authHeaders() });
        const contentsBody = await contentsResponse.json() as { files?: RepositoryFile[] };
        const repoFiles = contentsResponse.ok && contentsBody.files?.length ? contentsBody.files : Object.keys(starterFiles).map((path) => ({
          name: path.split('/').pop() ?? path,
          path,
          type: 'file' as const,
        }));

        if (cancelled) {
          return;
        }

        setFiles(repoFiles.filter((file) => file.type === 'file'));
        const firstPath = repoFiles.find((file) => file.type === 'file')?.path ?? 'README.md';
        setSelectedPath(firstPath);
        setEditorValue(starterFiles[firstPath] ?? `# ${projectBody.project.name}\n\nStart editing your project files.\n`);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Workspace failed to load.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const fileList = useMemo(
    () => [...files].sort((left, right) => left.path.localeCompare(right.path)),
    [files],
  );

  function selectFile(path: string): void {
    setSelectedPath(path);
    setEditorValue(starterFiles[path] ?? `# ${path}\n\nFile preview is available after GitHub repository sync.\n`);
  }

  function saveDraft(): void {
    starterFiles[selectedPath] = editorValue;
    setSavedAt(new Date().toLocaleTimeString());
  }

  if (loading) {
    return <div className="workspace-boot">Loading workspace…</div>;
  }

  if (error || !project) {
    return (
      <div className="workspace-boot">
        <p>{error ?? 'Project not found.'}</p>
        <a href={`/projects/${encodeURIComponent(projectId)}`}>Back to project</a>
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-titlebar">
        <div className="workspace-titlebar-left">
          <a className="workspace-back" href={`/projects/${encodeURIComponent(projectId)}`}>← Dashboard</a>
          <strong>{project.name}</strong>
          <span className="workspace-host">{project.workspaceHostname}</span>
        </div>
        <div className="workspace-titlebar-right">
          <span className="workspace-badge">Local workspace</span>
          <button type="button" onClick={saveDraft}>Save draft</button>
          {savedAt ? <span className="workspace-saved">Saved {savedAt}</span> : null}
        </div>
      </header>
      <div className="workspace-body">
        <aside className="workspace-activity">
          <span title="Explorer">▣</span>
        </aside>
        <aside className="workspace-sidebar">
          <p className="workspace-sidebar-title">Explorer</p>
          <ul className="workspace-tree">
            {fileList.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={file.path === selectedPath ? 'active' : ''}
                  onClick={() => selectFile(file.path)}
                >
                  {file.name}
                </button>
              </li>
            ))}
          </ul>
          {!project.repositoryUrl ? (
            <p className="workspace-note">Connect GitHub on the dashboard to load real repository files.</p>
          ) : null}
        </aside>
        <main className="workspace-editor">
          <div className="workspace-tabs">
            <span>{selectedPath}</span>
          </div>
          <textarea
            className="workspace-textarea"
            value={editorValue}
            onChange={(event) => setEditorValue(event.target.value)}
            spellCheck={false}
          />
        </main>
      </div>
    </div>
  );
}
