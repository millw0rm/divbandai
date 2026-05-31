import '../src/styles.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'divband dashboard',
  description: 'divband dashboard for project provisioning, deployments, domains, environment variables, logs, and AI-assisted changes.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
