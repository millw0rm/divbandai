# divband backend

The backend API is responsible for project lifecycle orchestration.

Initial modules:

- `project-lifecycle.ts` defines project states and orchestration steps.
- Future implementation should add concrete GitLab, Kubernetes, DNS, certificate, audit, and AI clients.
