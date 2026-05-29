# Terraform infrastructure

Terraform modules here provision platform resources outside application code.

Expected resource areas:

- Cloud account/project resources, IAM, networking, storage, and load balancer primitives.
- DNS zones, platform subdomains, custom-domain verification records, and routing targets.
- GitLab groups, projects, protected branches, CI/CD variables, deploy tokens, and project access tokens.
- GitLab runners, runner tags, cache buckets, and runner IAM boundaries.
- Container registry repositories and retention policies.
- Kubernetes clusters, node pools, ingress or Gateway API controllers, certificate controllers, and observability add-ons.

Root stacks should pass project slug, immutable project ID, owner path, namespace, runner tag, platform hostname, custom-domain configuration, and environment into these modules.
