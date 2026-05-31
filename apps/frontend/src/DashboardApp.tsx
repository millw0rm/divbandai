'use client';

import { useEffect, useRef } from 'react';
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

export default function DashboardApp({ initialPage = 'sign-in', initialProjectId }: DashboardAppProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<DashboardController | undefined>(undefined);
  const initialState = createInitialDashboardState({
    currentPage: initialPage,
    selectedProjectId: initialProjectId,
  });

  useEffect(() => {
    if (!rootRef.current || controllerRef.current) {
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
        currentPage: 'sign-in',
        error: message,
      }));
    }
  }, []);

  return <div id="app" ref={rootRef} dangerouslySetInnerHTML={{ __html: renderDashboard(initialState) }} />;
}
