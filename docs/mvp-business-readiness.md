# MVP business readiness assessment

This assessment answers whether Divband is ready to receive a list of VM IP addresses, start the infrastructure, and operate as an MVP business.

## Short answer

Divband now has an infrastructure bootstrap path for an MVP pilot: an operator can copy the Ansible inventory, replace the example hosts with real VM IPs, configure required domains/tokens/secrets, and run the site playbook to prepare hosts, create a k3s cluster, install shared add-ons, connect GitLab, register runners, and deploy the Divband control plane.

That means the project is ready for an **operator-run MVP pilot** after real environment values are supplied. It is **not yet ready to be advertised as a fully self-service public paid business** without completing the product release checklist, durable provider integrations, operational monitoring, backups, billing, abuse controls, and security review.

## What is ready for VM-IP bootstrap

| Capability | Status | Evidence |
| --- | --- | --- |
| VM inventory model | Ready for operator configuration | `infra/ansible/inventory.example.yml` defines the expected host groups and example IP replacements. |
| Full bootstrap command | Ready for operator execution | `infra/ansible/playbooks/site.yml` is the main playbook for common host prep, Kubernetes, add-ons, GitLab, runners, and Divband app deployment. |
| Kubernetes cluster path | Ready for k3s-based MVP environments | The Ansible `kubernetes` role supports k3s control-plane and worker setup, kubeconfig rendering, and local kubeconfig artifact export. |
| Shared cluster add-ons | Ready as initial automation | The site playbook installs ingress, cert-manager, External Secrets, observability, and Divband app roles on the first control-plane node. |
| GitLab connection/provisioning layer | Ready as an operator-controlled step | The GitLab role supports connect/install modes, while `infra/gitlab/terraform` provisions tenant/project resources. |
| Runner setup | Ready after runner tokens exist | The runner role installs GitLab Runner and can resolve project-specific runner tags/tokens from Terraform outputs. |
| Tenant runtime templates | Ready as templates | `infra/k8s/base` contains namespace, quota, RBAC, network policy, workload, ingress, certificate, and ExternalSecret templates. |
| Reference architecture | Documented | `docs/vm-reference-architecture.md` describes minimal and production-oriented VM layouts and maps them to Ansible groups. |


## Kubernetes infrastructure recommendation

For this project, use **k3s for the VM-based MVP pilot**. Do not use minikube for persistent customer-facing infrastructure, and do not start with Kubespray unless the immediate goal is a larger kubeadm-style production cluster with a dedicated operations team.

| Option | Recommendation for Divband | Why | When to use it |
| --- | --- | --- | --- |
| k3s | **Default for VM-IP MVP** | Lightweight, fast to bootstrap on VPS/cloud-computer VMs, supports multi-node clusters, ingress, cert-manager, External Secrets, namespaces, RBAC, and network policies with much less operational weight than kubeadm/Kubespray. | Operator-run MVP pilots, private alpha, small production-like environments where simplicity matters. |
| minikube | **Local development only** | Excellent for a single developer machine, but it is not designed as the persistent multi-tenant runtime for real customer workloads, GitLab deployments, TLS, DNS, and node lifecycle operations. | Local demos and developer smoke tests. |
| Kubespray | **Defer until production scale needs it** | Powerful and mature for kubeadm-based clusters, but it adds inventory complexity, more moving parts, upgrade planning, and operational burden before Divband has proven product-market and traffic needs. | Later private-alpha/production migration when you need a more standard Kubernetes distribution, HA control plane discipline, explicit etcd/networking choices, or a team comfortable operating kubeadm clusters. |
| Managed Kubernetes | **Best long-term business path when budget/provider choice is clear** | Removes much of the cluster lifecycle burden, but depends on a cloud/provider decision and can increase monthly cost. | Public MVP or production if you want to focus on Divband product features instead of cluster operations. |

The current Ansible implementation intentionally matches this recommendation: the Kubernetes role defaults to `k3s`, and the role fails for other distributions until another implementation is explicitly added. That keeps the MVP path simple while preserving a future migration path to Kubespray, kubeadm, or managed Kubernetes.

## Values required before running on real VMs

Before running `ansible-playbook -i inventory.yml playbooks/site.yml`, configure these with real values:

1. SSH user, private key path, and operator public keys.
2. Real host IPs or DNS names in the Ansible inventory groups.
3. Platform domains and DNS records for the dashboard/API, tenant wildcard routing, GitLab if self-hosted, and ingress endpoint.
4. Kubernetes API endpoint or load-balancer endpoint.
5. cert-manager ACME email and issuer settings.
6. External secret backend endpoint and authentication material.
7. GitLab URL and provisioner token.
8. GitLab runner authentication tokens or Terraform output access for runner registration.
9. Divband backend/frontend image references or build/publish pipeline outputs.
10. Object-storage and database decisions for anything beyond a short-lived pilot.

## MVP pilot acceptance checks

After bootstrap, the environment should pass these checks before inviting a pilot customer:

```sh
ansible-playbook -i inventory.yml playbooks/site.yml --check
ansible-playbook -i inventory.yml playbooks/site.yml
kubectl get nodes -o wide
kubectl get pods -A
kubectl get clusterissuer
kubectl -n divband-system get deployments,services,secrets
terraform -chdir=infra/gitlab/terraform plan
terraform -chdir=infra/gitlab/terraform output
curl -fsS https://REPLACE_WITH_API_HOSTNAME/healthz
```

Expected outcomes:

- All Kubernetes nodes are `Ready`.
- ingress-nginx, cert-manager, External Secrets, metrics-server, logging, backend, and frontend workloads are running.
- The configured `ClusterIssuer` is ready or has an understood DNS/HTTP-01 remediation path.
- GitLab runners are online and tagged only for the projects they should deploy.
- The backend can render/apply tenant welcome manifests with `KUBERNETES_TEMPLATE_DIR`, `KUBERNETES_APPLY`, and `kubectl` in the backend container when a user creates a project.
- A test project created in the dashboard provisions `project-{slug}` with a welcome nginx page reachable at the platform hostname (DNS permitting); CI can later replace the welcome workload.

## Business readiness boundary

### Ready for

- Internal demos on persistent VMs.
- Founder/operator-driven pilot deployments.
- Private alpha environments where an operator can manually supervise DNS, secrets, runner tokens, and incident response.
- Validating the end-to-end GitLab/Kubernetes architecture before adding managed production dependencies.

### Not ready for, without more work

- Unsupervised public signup.
- Paid self-service hosting.
- Strong uptime/SLO promises.
- Automated billing and quota enforcement.
- Production-grade abuse handling for anonymous publishing.
- Fully automated provider DNS and custom-domain lifecycle for arbitrary customer domains.
- Production disaster recovery, backup restore drills, and incident staffing.

## Work required before public MVP business launch

Complete these before positioning Divband as a public MVP business:

1. Replace SQLite/local prototype persistence with a production database, migrations, backups, and restore tests.
2. Configure durable object storage for static publish artifacts, deployment artifacts, and backup handoff.
3. Harden authentication/session management and API token lifecycle.
4. Automate DNS, TLS, and custom-domain lifecycle checks end to end.
5. Add monitoring dashboards, alerts, log retention, audit views, and on-call runbooks.
6. Enforce plan quotas, rate limits, retention limits, and abuse scanning.
7. Add billing/tier enforcement if charging customers.
8. Run a security review covering auth, tenant isolation, GitLab tokens, Kubernetes RBAC, runner isolation, domain takeover, and secret handling.
9. Add end-to-end smoke tests for signup, project creation (auto welcome stack on k3s), optional GitLab project creation, CI deploy replacing welcome, platform hostname routing, custom-domain verification, and rollback.
10. Document support, terms, privacy, abuse reporting, incident response, and backup/restore processes.

## Recommended launch sequence

1. **Infrastructure smoke:** run the Ansible playbook on disposable VMs and validate cluster/add-on health.
2. **Operator pilot:** deploy one internal project using real GitLab and Kubernetes paths.
3. **Private alpha:** invite a small number of supervised users; keep manual approval for domains and deployments.
4. **Public MVP:** launch only after release checklist, monitoring, backup, auth, billing/limits, and security requirements are complete.

## Public self-service signup controls

Public signup must stay disabled or invite-only until the following production controls pass in the target environment:

| Control | Implementation gate |
| --- | --- |
| Email verification | `/auth/register` issues an expiring verification challenge and `/auth/verify-email` must set `emailVerifiedAt` before login or platform feature use. |
| Password reset | `/auth/password-reset/request` and `/auth/password-reset/confirm` create expiring one-time challenges, rotate the password hash, and revoke existing sessions. |
| Rate limiting | Auth, publish mutation, and deployment trigger routes consume per-client buckets before work starts. |
| Abuse detection | Static publishes reject executable/phishing/binary-abuse patterns, hosted deployments reject known abuse markers, and platform admins can restrict deployments for a project. |
| Tenant quotas and plan enforcement | Organizations carry billing tier/status; free/pro/team limits are enforced for projects, custom domains, deployments, and published sites. |
| Billing state | Past-due and cancelled tenants cannot create or mutate hosted resources until billing is updated by a platform administrator. |
| Backup/restore | `npm run smoke:restore --workspace @divband/backend` must pass after restoring a production-like snapshot. |
| Monitoring/alerting | `/admin/monitoring/signals` and the operations runbook cover auth, deployments, DNS, certificates, runners, and storage. |
| End-to-end smoke | `npm run smoke:controls --workspace @divband/backend` must pass for signup through project live-hostname access and password reset. |

Default posture: `DIVBAND_SIGNUP_MODE` is invite-only unless explicitly set to `public`. Keep it invite-only for pilots and set `DIVBAND_SIGNUP_INVITE_CODES` for controlled onboarding.

## Related documentation

| Topic | Document |
| --- | --- |
| Ansible/k3s bootstrap | [`infra/ansible/README.md`](../infra/ansible/README.md) |
| Per-project auto-provision | [`README.md`](../README.md#project-auto-provision-on-k3s) |
| Operator runbook | [`operations.md`](operations.md) |
| VM topology | [`vm-reference-architecture.md`](vm-reference-architecture.md) |
| Product checklist | [`product.md`](product.md#release-checklist) |
