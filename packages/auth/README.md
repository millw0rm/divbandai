# divband auth package

Shared authentication and authorization definitions for backend and future workers.

The package defines project roles, project permissions, role-to-permission policy, role hierarchy helpers, and assignment rules. Backend services must use these helpers before invoking GitLab, Kubernetes, DNS, certificate, deployment, or secret-management boundaries.
