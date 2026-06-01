'use client';

import { useEffect, useRef, useState } from 'react';
import { hasAuthToken } from './auth-session';
import {
  createInitialDashboardState,
  mountDashboard,
  renderDashboard,
  type DashboardController,
  type DashboardPageId,
} from './dashboard';

export interface DashboardAppProps {
  initialPage?: DashboardPageId;
  initialProjectId?: string;
}

export default function DashboardApp({ initialPage = 'project-list', initialProjectId }: DashboardAppProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<DashboardController | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const initialState = createInitialDashboardState({
    currentPage: initialPage,
    selectedProjectId: initialProjectId,
  });

  useEffect(() => {
    if (!hasAuthToken()) {
      globalThis.location.replace('/');
      return;
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !rootRef.current || controllerRef.current) {
      return;
    }

    try {
      controllerRef.current = mountDashboard({
        root: rootRef.current,
        baseUrl: '/api',
        initialState,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dashboard failed to start.';
      rootRef.current.innerHTML = renderDashboard(createInitialDashboardState({
        currentPage: 'project-list',
        error: message,
      }));
    }
  }, [ready]);

  if (!ready) {
    return <div className="dashboard-boot"><div className="boot-card">Loading dashboard…</div></div>;
  }

  return <div id="app" ref={rootRef} dangerouslySetInnerHTML={{ __html: renderDashboard(initialState) }} />;
}
