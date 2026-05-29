# Terraform infrastructure

Terraform modules here should provision platform resources outside application code:

- GitLab projects and CI settings.
- Kubernetes tenant namespaces and policies.
- DNS records and custom-domain verification support.

Root stacks should pass project slug, owner path, namespace, runner tag, and domain configuration into these modules.
