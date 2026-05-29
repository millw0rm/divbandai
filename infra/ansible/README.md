# Ansible infrastructure bootstrap

`infra/ansible` is the VM bootstrap layer for a divband platform environment. It prepares operator-supplied VMs, installs a container runtime, bootstraps a Kubernetes cluster, installs platform add-ons, connects GitLab, registers runners, and deploys the divband backend/frontend control plane.

## Supported Kubernetes distribution

The first supported Kubernetes bootstrap path is **k3s**. It is intended for a small persistent VM deployment where operators supply VM IP addresses or DNS names. The Kubernetes role is isolated at `roles/kubernetes` so a future kubeadm, Kubespray, or managed-cluster handoff can be added without changing the GitLab, add-on, or Divband application roles.

### Why k3s instead of minikube or Kubespray for the MVP?

| Option | Decision | Rationale |
| --- | --- | --- |
| k3s | Use for the VM-IP MVP bootstrap. | It gives Divband a real Kubernetes API, namespaces, RBAC, ingress, cert-manager, External Secrets, and multi-node worker capacity without forcing the operator to own the full kubeadm/Kubespray lifecycle on day one. |
| minikube | Use only for local developer testing. | It is optimized for a local workstation and is not the right persistent runtime for customer traffic, GitLab deployments, DNS/TLS, or multi-VM node lifecycle. |
| Kubespray | Keep as a future production option. | It is a good path when Divband needs kubeadm-style HA clusters and a team ready to manage more explicit Kubernetes networking, etcd, upgrades, and inventory complexity. It is heavier than needed for the first operator-run MVP pilot. |
| Managed Kubernetes | Prefer later when provider and budget are decided. | It reduces operations burden for a public business, but the current VM-IP bootstrap is meant to work before committing to a specific cloud provider. |

The role currently enforces this boundary with `kubernetes_distribution: k3s`; selecting another value fails fast until a second distribution implementation is added.

## Layout

- `ansible.cfg` — local defaults that point Ansible at `inventory.yml` and `roles/`.
- `inventory.example.yml` — copyable inventory with the expected host groups: `k8s_control_plane`, `k8s_workers`, `load_balancers`, `gitlab`, `runners`, and `monitoring`.
- `playbooks/site.yml` — main entry point for a full environment bootstrap.
- `playbooks/gitlab.yml` — targeted entry point for GitLab host installation or existing-endpoint configuration.
- `playbooks/runners.yml` — targeted entry point for installing and registering GitLab Runner hosts.
- `roles/common` — admin users, SSH hardening, firewall rules, base packages, and time sync.
- `roles/container_runtime` — installs `containerd` by default or Docker when `container_runtime_engine: docker` is set.
- `roles/kubernetes` — installs k3s control-plane and worker nodes, renders an endpoint kubeconfig, and fetches it to `artifacts/kubeconfig` for operator hand-off.
- `roles/ingress` — installs the nginx ingress controller.
- `roles/cert_manager` — installs cert-manager and applies an ACME `ClusterIssuer`.
- `roles/external_secrets` — installs External Secrets Operator and configures a `ClusterSecretStore`.
- `roles/observability` — installs metrics-server and a Fluent Bit DaemonSet as the initial metrics/logging agents.
- `roles/gitlab` — connects to an existing GitLab endpoint, installs self-hosted GitLab when `gitlab_mode: install` is selected, and can run the Terraform stack under `../gitlab/terraform`.
- `roles/gitlab_runner` — installs GitLab Runner, resolves project runner tags and authentication tokens from Terraform outputs, disables untagged jobs, and registers dedicated runners.
- `roles/divband_app` — deploys the backend/frontend control plane, mounts the generated kubeconfig into the backend, and points the backend at the Kubernetes template renderer.

## Integration points

This Ansible layer intentionally reuses existing repository paths instead of duplicating platform definitions:

- Kubernetes tenant templates are read from `infra/k8s/base/` and can be applied with `divband_apply_base_templates: true` after replacing placeholders or adapting the kustomization flow.
- GitLab tenant/project provisioning is delegated to the Terraform stack in `infra/gitlab/terraform/` when `gitlab_run_terraform: true` is set.
- The backend service uses `apps/backend/src/services/kubernetes.ts`, which defaults `KUBERNETES_TEMPLATE_DIR` to `infra/k8s/base` and can apply rendered manifests when `KUBERNETES_APPLY=true`.
- The backend runtime accepts `KUBERNETES_CONFIG_MODE=kubeconfig` and the operator-facing `KUBERNETES_MODE=kubeconfig`; Ansible sets both and mounts `KUBECONFIG` from the generated cluster kubeconfig secret.
- GitLab CI templates expect a base64 kubeconfig variable (`KUBE_CONFIG_B64`), and `infra/gitlab/terraform/projects.auto.tfvars.example` also shows the optional plain `KUBE_CONFIG` hand-off.

## 1. Copy the example inventory

From the repository root:

```sh
cp infra/ansible/inventory.example.yml infra/ansible/inventory.yml
```

Keep `inventory.yml` out of source control if it contains real IP addresses, hostnames, or secrets.

## 2. Add operator-supplied VM IP addresses

Edit `infra/ansible/inventory.yml` and replace each documentation address with the real VM IP or DNS name. Kubernetes nodes must use the inventory groups shown here:

```yaml
k8s_control_plane:
  hosts:
    cp-1:
      ansible_host: 10.0.10.11
k8s_workers:
  hosts:
    worker-1:
      ansible_host: 10.0.10.21
load_balancers:
  hosts:
    lb-1:
      ansible_host: 10.0.40.11
gitlab:
  hosts:
    gitlab-1:
      ansible_host: 10.0.20.11
runners:
  hosts:
    runner-1:
      ansible_host: 10.0.30.11
monitoring:
  hosts:
    monitoring-1:
      ansible_host: 10.0.50.11
```

Use the groups consistently:

- `k8s_control_plane` hosts run the Kubernetes API, create the k3s join token, and install cluster add-ons.
- `k8s_workers` hosts join the Kubernetes cluster as application nodes.
- `load_balancers` should expose `kubernetes_api_endpoint` and ingress traffic when you place the Kubernetes API or HTTP routing behind a stable VIP/DNS name.
- `gitlab` hosts either run GitLab or represent the existing GitLab endpoint that Terraform configures.
- `runners` hosts run GitLab Runner and need the runner authentication token from provisioning.
- `monitoring` is prepared by `common` now and reserved for follow-up roles outside the cluster.

## 3. Configure required variables and secrets

Set non-secret variables in `inventory.yml`, `group_vars/all.yml`, or environment-specific group vars. Put secrets in Ansible Vault, your CI secret store, or your operator password manager.

Required or commonly customized variables:

| Variable | Purpose |
| --- | --- |
| `ansible_user` / `ansible_ssh_private_key_file` | SSH account and key used to reach the VMs. |
| `divband_admin_users` | Operator accounts and SSH public keys to create on every host. |
| `divband_domain`, `divband_public_hostname` | Platform DNS names for the control plane and tenant routes. |
| `container_runtime_engine` | `containerd` by default; set to `docker` only when needed. |
| `kubernetes_distribution` | Must be `k3s` for this first bootstrap path. |
| `kubernetes_api_endpoint` | Stable API endpoint embedded into collected kubeconfigs and used by workers, usually `https://<load-balancer-or-first-control-plane>:6443`. |
| `kubernetes_kubeconfig_local_path` | Local operator artifact path for the collected kubeconfig; defaults to `infra/ansible/artifacts/kubeconfig`. |
| `kubernetes_kubeconfig_context` | Context name written into the collected kubeconfig. |
| `cert_manager_acme_email`, `cert_manager_acme_server`, `cert_manager_cluster_issuer` | ACME account and issuer settings. |
| `external_secrets_store_name` and provider settings | Must match the `REPLACE_WITH_CLUSTER_SECRET_STORE` value expected by `infra/k8s/base/external-secret.yaml`. |
| `observability_install_metrics_server`, `observability_install_fluent_bit` | Enable or disable the initial metrics and logging agents. |
| `gitlab_mode`, `gitlab_url`, `gitlab_external_url`, `gitlab_terraform_dir`, `gitlab_run_terraform` | Use `gitlab_mode: install` to self-host GitLab on the `gitlab` group, or `gitlab_mode: connect` to point Divband at an existing GitLab URL. |
| `gitlab_runner_project_key` | Required per runner host unless `gitlab_runner_token` is supplied from Vault. Use the Terraform project key, for example `acme/marketing`. |
| `gitlab_runner_token` | Runner authentication token created by GitLab provisioning. Use Vault/platform secrets for normal runs; the role can also read `runner_authentication_tokens` from Terraform outputs when `gitlab_runner_project_key` is set. |
| `gitlab_runner_tags` | Optional override for runner tags. Leave empty to use the project-specific `divband-*` tag exported by Terraform. |

### GitLab runner token handoff

When `gitlab_run_terraform: true`, the GitLab role can run `terraform init`/`apply` in `infra/gitlab/terraform` after the operator supplies `gitlab_token` and the desired tenants/projects. The runner role reads `runner_authentication_tokens` and `projects` from `infra/gitlab/terraform/outputs.tf`, selects the matching token and project-specific `divband-*` tag, and registers the runner with `--run-untagged=false`.

`runner_authentication_tokens` is a sensitive Terraform output. Treat Terraform output as the short-lived handoff boundary and move each value into the platform secret store immediately after apply:

1. Run `terraform -chdir=infra/gitlab/terraform output -json runner_authentication_tokens` only from a trusted operator workstation or CI job with protected logs.
2. Write each `tenant/project` token into the platform secret store path used for Ansible Vault or your external secret backend, for example `divband/gitlab/runners/acme/marketing/token`.
3. Reference that stored value as `vault_gitlab_runner_token` in host/group vars, or allow the runner playbook to read the Terraform output directly during the same protected provisioning run.
4. Do not commit tokens to inventory, Terraform variable files, or runner configuration examples.

## 4. Install Ansible dependencies

The roles use `ansible.posix` and `community.general` modules for authorized keys, timezone, and firewall management:

```sh
ansible-galaxy collection install -r infra/ansible/requirements.yml
```

## 5. Bootstrap the environment

Run the full site playbook from `infra/ansible`:

```sh
cd infra/ansible
ansible-playbook -i inventory.yml playbooks/site.yml --ask-vault-pass
```

Useful targeted runs:

```sh
ansible-playbook -i inventory.yml playbooks/site.yml --limit k8s_control_plane --ask-vault-pass
ansible-playbook -i inventory.yml playbooks/site.yml --limit k8s_workers --ask-vault-pass
ansible-playbook -i inventory.yml playbooks/gitlab.yml --ask-vault-pass
ansible-playbook -i inventory.yml playbooks/runners.yml --ask-vault-pass
ansible-playbook -i inventory.yml playbooks/site.yml --limit runners --ask-vault-pass
```

## 6. Kubeconfig hand-off

After the control-plane play finishes, Ansible renders an endpoint kubeconfig on the first control-plane host and fetches it to:

```sh
infra/ansible/artifacts/kubeconfig
```

Use that file for three hand-offs:

1. **Backend service** — the `divband_app` role creates a `divband-kubeconfig` Secret, mounts it at `/var/run/divband/kubeconfig/config`, and sets `KUBERNETES_MODE=kubeconfig`, `KUBERNETES_CONFIG_MODE=kubeconfig`, and `KUBECONFIG=/var/run/divband/kubeconfig/config`.
2. **GitLab CI base64 variable** — paste the value from `base64 -w0 infra/ansible/artifacts/kubeconfig` into the `KUBE_CONFIG_B64` secret shown in `infra/gitlab/terraform/projects.auto.tfvars.example`.
3. **GitLab CI plain kubeconfig variable** — when a job expects GitLab's `KUBE_CONFIG` convention, paste the raw file contents into the optional `KUBE_CONFIG` variable shown in the same Terraform example.

Do not commit collected kubeconfigs. Treat `infra/ansible/artifacts/` as an operator workstation output directory.

## Expected post-install checks

Run these validation commands after the playbook completes:

```sh
kubectl --kubeconfig infra/ansible/artifacts/kubeconfig get nodes -o wide
kubectl --kubeconfig infra/ansible/artifacts/kubeconfig get pods -A
kubectl --kubeconfig infra/ansible/artifacts/kubeconfig get clusterissuer
kubectl --kubeconfig infra/ansible/artifacts/kubeconfig get clustersecretstore
kubectl --kubeconfig infra/ansible/artifacts/kubeconfig -n ingress-nginx get deploy,svc
kubectl --kubeconfig infra/ansible/artifacts/kubeconfig -n cert-manager get deploy,pods
kubectl --kubeconfig infra/ansible/artifacts/kubeconfig -n external-secrets get deploy,pods
kubectl --kubeconfig infra/ansible/artifacts/kubeconfig -n observability get daemonset,pods
kubectl --kubeconfig infra/ansible/artifacts/kubeconfig -n divband-system get deploy,svc,ingress,secret/divband-kubeconfig
base64 -w0 infra/ansible/artifacts/kubeconfig
terraform -chdir=infra/gitlab/terraform output
```

Expected results:

- Every control-plane and worker node is `Ready`.
- `ingress-nginx`, `cert-manager`, `external-secrets`, metrics-server, and Fluent Bit pods are running.
- The configured `ClusterIssuer` is `Ready=True`.
- The `ClusterSecretStore` can authenticate to the external secret backend.
- `divband-backend` and `divband-frontend` deployments are available in `divband-system`.
- The backend deployment has the kubeconfig secret mounted and can run kubectl through `KUBERNETES_MODE=kubeconfig`/`KUBECONFIG`.
- GitLab project variables contain either `KUBE_CONFIG_B64` or the optional `KUBE_CONFIG` according to the deploy template used.
- GitLab runners appear online in GitLab and have the expected `divband` tags.
- The backend can render tenant manifests using `infra/k8s/base/` through `KUBERNETES_TEMPLATE_DIR`.
