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
- `roles/ingress` — installs the nginx ingress controller and, for the VM load-balancer path, pins its Service to stable NodePorts.
- `roles/cert_manager` — installs cert-manager and applies an ACME `ClusterIssuer`.
- `roles/external_secrets` — installs External Secrets Operator and configures a `ClusterSecretStore`.
- `roles/observability` — installs metrics-server and a Fluent Bit DaemonSet as the initial metrics/logging agents.
- `roles/load_balancer` — installs HAProxy/keepalived on `load_balancers` hosts to forward `:6443` to Kubernetes control-plane nodes and public `:80`/`:443` to ingress-nginx nodes.
- `roles/gitlab` — connects to an existing GitLab endpoint, installs self-hosted GitLab when `gitlab_mode: install` is selected, and can run the Terraform stack under `../gitlab/terraform`.
- `roles/gitlab_runner` — validates that a runner token source exists before package installation, resolves project runner tags and authentication tokens from Terraform outputs or Vault, disables untagged jobs, and registers dedicated runners.
- `roles/divband_app` — deploys the backend/frontend control plane, mounts the generated kubeconfig into the backend, and points the backend at the Kubernetes template renderer.

## Integration points

This Ansible layer intentionally reuses existing repository paths instead of duplicating platform definitions:

- Kubernetes tenant templates are read from `infra/k8s/base/` and can be applied with `divband_apply_base_templates: true` after replacing placeholders or adapting the kustomization flow.
- GitLab tenant/project provisioning is delegated to the Terraform stack in `infra/gitlab/terraform/` when `gitlab_run_terraform: true` is set.
- Bootstrap phase order, Ansible vs Terraform ownership, and the planner CLI are documented in [`docs/infrastructure-orchestration.md`](../../docs/infrastructure-orchestration.md) and [`infra/orchestration/`](../orchestration/).
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
- `load_balancers` run the HAProxy/keepalived path from `roles/load_balancer`; they expose `kubernetes_api_endpoint` on TCP `6443` and public HTTP/HTTPS on TCP `80`/`443`.
- `gitlab` hosts either run GitLab or represent the existing GitLab endpoint that Terraform configures.
- `runners` hosts run GitLab Runner and need the runner authentication token from provisioning.
- `monitoring` is prepared by `common` now and reserved for follow-up roles outside the cluster.

## 3. Configure required variables and secrets

Set non-secret variables in `inventory.yml`, `group_vars/all.yml`, or environment-specific group vars. Put secrets in Ansible Vault, your CI secret store, or your operator password manager.

### Production inventory checklist

Before running [`scripts/deploy-production.sh`](../../scripts/deploy-production.sh) or `make deploy-production`, verify that `infra/ansible/inventory.yml` or the environment-specific inventory/group vars contain the production values below. These are the exact locations where operators normally put VM IPs, SSH keys, DNS resolvers, and application image references.

| Field | Where to set it | Production value to provide |
| --- | --- | --- |
| `ansible_user` | `all.vars`, group vars, or host vars | SSH login user that exists on every VM. |
| `ansible_ssh_private_key_file` | `all.vars`, group vars, or host vars | Path on the operator workstation or CI runner to the private key used for VM access. Do not commit private keys. |
| `ansible_host` under `k8s_control_plane` | Each host in the `k8s_control_plane.hosts` map | Control-plane VM IP address or DNS name. |
| `ansible_host` under `k8s_workers` | Each host in the `k8s_workers.hosts` map | Worker VM IP address or DNS name. |
| `ansible_host` under `load_balancers` | Each host in the `load_balancers.hosts` map | HAProxy/keepalived VM IP address or DNS name. |
| `ansible_host` under `gitlab` | Each host in the `gitlab.hosts` map | Self-hosted GitLab VM IP/DNS name, or the VM that represents the existing GitLab integration endpoint. |
| `ansible_host` under `runners` | Each host in the `runners.hosts` map | GitLab Runner VM IP address or DNS name. |
| `ansible_host` under `monitoring` | Each host in the `monitoring.hosts` map | Monitoring VM IP address or DNS name. |
| `public_vip` | `load_balancers.vars` or a load-balancer host var | Floating public address managed by keepalived. Point platform DNS at this address when using HA. |
| `kubernetes_api_endpoint` | `all.vars` or environment group vars | Stable API URL, normally `https://<public_vip-or-lb-dns>:6443`; workers and collected kubeconfigs use this value. |
| `common_configure_systemd_resolved` | `all.vars` or host/group vars | Set to `true` only when Ansible should manage VM resolver configuration through systemd-resolved. |
| `common_dns_resolvers` | `all.vars` or host/group vars | Recursive DNS resolver IPs that each VM should use when `common_configure_systemd_resolved: true`. |
| `divband_backend_image_repository` | `all.vars`, environment group vars, or `DIVBAND_BACKEND_IMAGE_REPOSITORY` for the wrapper | Backend image repository that k3s pulls, for example `registry.gitlab.com/divband/control-plane/backend`. |
| `divband_frontend_image_repository` | `all.vars`, environment group vars, or `DIVBAND_FRONTEND_IMAGE_REPOSITORY` for the wrapper | Frontend image repository that k3s pulls, for example `registry.gitlab.com/divband/control-plane/frontend`. |
| `divband_image_tag` | `all.vars`, environment group vars, or `TAG`/`DIVBAND_IMAGE_TAG` for the wrapper | Immutable image tag to deploy, for example a Git SHA or release tag. |

Minimal production inventory shape:

```yaml
all:
  vars:
    ansible_user: ubuntu
    ansible_ssh_private_key_file: ~/.ssh/divband-production
    kubernetes_api_endpoint: https://203.0.113.10:6443
    common_configure_systemd_resolved: true
    common_dns_resolvers:
      - 178.22.122.100
      - 185.51.200.2
    divband_backend_image_repository: registry.gitlab.com/divband/control-plane/backend
    divband_frontend_image_repository: registry.gitlab.com/divband/control-plane/frontend
    divband_image_tag: v1.0.0

k8s_control_plane:
  hosts:
    cp-1:
      ansible_host: 10.0.10.11
k8s_workers:
  hosts:
    worker-1:
      ansible_host: 10.0.10.21
load_balancers:
  vars:
    public_vip: 203.0.113.10
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

The monorepo is **not copied to each VM** during production deployment. Build and push backend/frontend container images first, then run Ansible with `divband_backend_image_repository`, `divband_frontend_image_repository`, and `divband_image_tag` pointing at those pushed images. The `divband_app` role renders Kubernetes manifests with those image references, and k3s pulls the images from the registry onto the cluster nodes. The wrapper command performs the build/push/deploy sequence for you:

```sh
REGISTRY=registry.gitlab.com/divband/control-plane TAG=v1.0.0 ./scripts/deploy-production.sh
# or
make deploy-production REGISTRY=registry.gitlab.com/divband/control-plane TAG=v1.0.0
```

Required or commonly customized variables:

| Variable | Purpose |
| --- | --- |
| `ansible_user` / `ansible_ssh_private_key_file` | SSH account and key used to reach the VMs. |
| `divband_admin_users` | Operator accounts and SSH public keys to create on every host. |
| `divband_domain`, `divband_public_hostname` | Platform DNS names for the control plane and tenant routes. |
| `container_runtime_engine` | `containerd` by default; set to `docker` only when needed. |
| `kubernetes_distribution` | Must be `k3s` for this first bootstrap path. |
| `kubernetes_api_endpoint` | Stable API endpoint embedded into collected kubeconfigs and used by workers, usually `https://<load-balancer-vip-or-first-control-plane>:6443`. When `load_balancers` has `public_vip`, use that VIP or its DNS name. |
| `public_ingress_target` | Inventory group name, or explicit backend list, that HAProxy uses for ingress HTTP/HTTPS backends. Defaults to `k8s_workers`. |
| `ingress_nginx_service_type`, `ingress_nginx_http_node_port`, `ingress_nginx_https_node_port` | Expose ingress-nginx on stable node ports for the HAProxy path; defaults are `NodePort`, `32080`, and `32443`. |
| `public_vip` | Optional per-load-balancer floating address managed by keepalived. Point platform DNS and `kubernetes_api_endpoint` at this value when using a VIP. |
| `common_configure_systemd_resolved`, `common_dns_resolvers`, `common_dns_fallback_resolvers`, `common_dns_domains` | Optional host-level DNS resolver settings for systemd-resolved. Use these only when the VMs need specific recursive resolvers or search/routing domains. |
| `kubernetes_k3s_resolv_conf` | Optional resolver file path passed to k3s with `--resolv-conf`; leave empty unless k3s or pod DNS resolution does not follow the desired host resolver path. |
| `kubernetes_kubeconfig_local_path` | Local operator artifact path for the collected kubeconfig; defaults to `infra/ansible/artifacts/kubeconfig`. |
| `kubernetes_kubeconfig_context` | Context name written into the collected kubeconfig. |
| `cert_manager_acme_email`, `cert_manager_acme_server`, `cert_manager_cluster_issuer` | ACME account and issuer settings. |
| `external_secrets_store_name` and provider settings | Must match the `REPLACE_WITH_CLUSTER_SECRET_STORE` value expected by `infra/k8s/base/external-secret.yaml`. |
| `observability_install_metrics_server`, `observability_install_fluent_bit` | Enable or disable the initial metrics and logging agents. |
| `gitlab_mode`, `gitlab_url`, `gitlab_external_url`, `gitlab_terraform_dir`, `gitlab_run_terraform` | Use `gitlab_mode: install` to self-host GitLab on the `gitlab` group, or `gitlab_mode: connect` to point Divband at an existing GitLab URL. The site playbook provisions or connects GitLab before deploying the Divband app so these values are ready for the backend. |
| `divband_gitlab_url`, `divband_gitlab_token` / `divband_gitlab_access_token`, `divband_gitlab_namespace_id` | Backend GitLab connection settings. Store credentials and optional namespace IDs in Ansible Vault or an external secret source; the `divband_app` role renders them into the `divband-backend-env` Kubernetes Secret and injects them with `secretKeyRef`. |
| `gitlab_runner_project_key` | Required per runner host unless `gitlab_runner_token` is supplied from Vault. Use the Terraform project key, for example `acme/marketing`. |
| `gitlab_runner_token` / `vault_gitlab_runner_token` | Runner authentication token created by Terraform GitLab provisioning. Use Vault/platform secrets for normal runs; the role can also read `runner_authentication_tokens` from Terraform outputs when `gitlab_runner_project_key` is set. |
| `gitlab_runner_allow_terraform_token_lookup` | Defaults to `true`; when no Vault token is present, allows the runner role to query Terraform outputs on the Ansible controller. Set to `false` if runners must only consume Vault-provided tokens. |
| `gitlab_runner_tags` | Optional override for runner tags. Leave empty to use the project-specific `divband-*` tag exported by Terraform. |

### Host resolver DNS

Set `common_configure_systemd_resolved: true` with a non-empty `common_dns_resolvers` list when the VMs themselves must use specific recursive DNS resolvers, for example provider-approved resolvers or private resolvers reachable from the host network. On systemd hosts, the `common` role writes `/etc/systemd/resolved.conf.d/divband.conf` and restarts `systemd-resolved`. `common_dns_fallback_resolvers` and `common_dns_domains` are optional and map to systemd-resolved `FallbackDNS=` and `Domains=` entries.

This option controls host or VM name resolution before and outside Kubernetes. It does not create or update public platform DNS records such as `divband_public_hostname`, tenant domains, or load-balancer records, and it does not configure Kubernetes CoreDNS behavior inside the cluster. Manage public records with your DNS provider and manage cluster DNS with Kubernetes/CoreDNS configuration if those behaviors need to change.

When k3s or pod DNS resolution does not follow the desired host resolver path, optionally pass an explicit resolver file to k3s on both server and agent installs:

```yaml
kubernetes_k3s_resolv_conf: /run/systemd/resolve/resolv.conf
```

Leave `kubernetes_k3s_resolv_conf` empty for normal installs; set it only for resolver-path troubleshooting or host resolver layouts where k3s should read a specific resolv.conf file.

### Divband backend GitLab secret handoff

The backend receives GitLab connection settings from the `divband-backend-env` Kubernetes Secret, not from literal Deployment environment values. Set `divband_gitlab_url`, exactly one of `divband_gitlab_token` or `divband_gitlab_access_token`, and optional `divband_gitlab_namespace_id` from Ansible Vault variables such as `vault_divband_gitlab_token` and `vault_divband_gitlab_namespace_id`. During `playbooks/site.yml`, GitLab connection/installation and Terraform token preparation run before the `divband_app` play, then the app role renders the Secret and references `GITLAB_URL`, `GITLAB_TOKEN`/`GITLAB_ACCESS_TOKEN`, and `GITLAB_NAMESPACE_ID` through Kubernetes `secretKeyRef` entries.

### GitLab runner token lifecycle

The supported fresh-environment flow is **Terraform creates GitLab projects and project-scoped runners first, then Ansible consumes the outputs**. The Ansible runner role does not create runners itself, and the backend does not provision project-scoped runners after project creation in this VM bootstrap path.

1. Configure tenants/projects in `infra/gitlab/terraform/projects.auto.tfvars` with a stable `runner_tag` for each project. Terraform creates one `gitlab_user_runner` per project and exports two handoff outputs:
   - `runner_token_handoff` — non-sensitive project key, runner ID, runner tag, and token output name for operator visibility.
   - `runner_authentication_tokens` — sensitive map keyed by `tenant/project`, for example `acme/marketing`.
2. Run Terraform before the runner playbook, either directly or through the GitLab role when `gitlab_run_terraform: true`:

   ```sh
   terraform -chdir=infra/gitlab/terraform init
   terraform -chdir=infra/gitlab/terraform apply
   terraform -chdir=infra/gitlab/terraform output runner_token_handoff
   ```

3. Choose exactly one token handoff method for each runner host:
   - **Immediate Terraform handoff:** set `gitlab_runner_project_key: acme/marketing` on the runner host and leave `gitlab_runner_allow_terraform_token_lookup: true`. During the same protected provisioning run, Ansible reads `runner_authentication_tokens` and `projects` from the Terraform state on the controller, resolves the token and `divband-*` tag, then registers GitLab Runner.
   - **Vault handoff:** from a trusted operator workstation or protected CI job, run `terraform -chdir=infra/gitlab/terraform output -json runner_authentication_tokens`, copy each value into Ansible Vault or your external secret backend, and expose it to the host as `vault_gitlab_runner_token` or `gitlab_runner_token`. Keep `gitlab_runner_project_key` set when you want tags resolved from Terraform; otherwise set `gitlab_runner_tags` explicitly.
4. The runner role validates the lifecycle before any repository setup or package installation. It fails fast unless either a non-placeholder Vault token is present or Terraform output lookup can find `runner_authentication_tokens[gitlab_runner_project_key]`. It also validates that runner tags come from Terraform `projects[gitlab_runner_project_key].runner_tag` or explicit `gitlab_runner_tags`, that every tag matches `divband-*`, and that `gitlab_runner_run_untagged` remains `false`.
5. Do not commit runner tokens to inventory, Terraform variable files, documentation examples, or GitLab Runner config files. Treat Terraform outputs as a short-lived handoff boundary and move tokens to the platform secret store after bootstrap.

### Load-balancer and DNS handoff

The default VM path uses external HAProxy/keepalived hosts rather than a Kubernetes-native load-balancer controller:

1. `kubernetes_api_endpoint` is the stable API URL written into kubeconfigs and used by k3s workers. In production, set it to `https://<public_vip-or-lb-dns>:6443`; for a single non-HA cluster you may temporarily point it at the first control-plane VM IP.
2. `public_ingress_target` tells HAProxy where to send public HTTP/HTTPS traffic. The default value, `k8s_workers`, resolves to the `ansible_host` values of the worker VMs. You can replace it with another inventory group or with an explicit list of `{name, address}` objects when ingress-nginx should run on dedicated nodes.
3. The ingress role patches `ingress-nginx-controller` to `type: NodePort` with `ingress_nginx_http_node_port: 32080` and `ingress_nginx_https_node_port: 32443`. HAProxy listens on public `80`/`443` and forwards to those node ports on every `public_ingress_target` backend.
4. Platform DNS records (`divband_public_hostname`, `divband_public_site_domain`, `divband_upload_domain`, and any tenant hostnames) should resolve to the load-balancer `public_vip` or to the single load-balancer VM IP when no VIP is used. They should not resolve to Kubernetes Service cluster IPs because those addresses are only routable inside the cluster.

If you later replace this path with MetalLB, kube-vip, or a cloud load balancer, set `ingress_nginx_service_type: LoadBalancer`, point platform DNS at the allocated ingress Service IP, and either disable the external ingress path with `load_balancer_ingress_enabled: false` or remove the `load_balancers` hosts from that environment.

## 4. Install Ansible dependencies

The roles use `ansible.posix` and `community.general` modules for authorized keys, timezone, and firewall management:

```sh
ansible-galaxy collection install -r infra/ansible/requirements.yml
```

## 5. Bootstrap the environment

For production deployments from a checked-out repository, prefer the root wrapper because it builds the application images, pushes them, installs the required Ansible collections, prints the exact backend/frontend image references, and then runs the full site playbook with `DIVBAND_IMAGE_TAG` set:

```bash
REGISTRY=registry.gitlab.com/divband/control-plane TAG=v1.0.0 ./scripts/deploy-production.sh
```

The wrapper accepts these environment inputs:

- `REGISTRY` — required base image registry/project, for example `registry.gitlab.com/divband/control-plane`.
- `TAG` — image tag; defaults to `git rev-parse --short HEAD` when available.
- `ANSIBLE_INVENTORY` — inventory path from the repository root, or an absolute path; defaults to `infra/ansible/inventory.yml`.
- `ANSIBLE_EXTRA_ARGS` — optional arguments appended to `ansible-playbook`, such as `--limit k8s_control_plane` or extra `-e` values.
- `DIVBAND_BACKEND_IMAGE_REPOSITORY` — optional backend image repository override; defaults to `${REGISTRY}/backend`.
- `DIVBAND_FRONTEND_IMAGE_REPOSITORY` — optional frontend image repository override; defaults to `${REGISTRY}/frontend`.

Under the hood it runs the same full playbook from `infra/ansible` after pushing the images:

```sh
cd infra/ansible
DIVBAND_IMAGE_TAG="$TAG" ansible-playbook -i "$INVENTORY_PATH" playbooks/site.yml --ask-vault-pass $ANSIBLE_EXTRA_ARGS
```

To run Ansible manually without building or pushing images, run the full site playbook from `infra/ansible`:

```sh
cd infra/ansible
ansible-playbook -i inventory.yml playbooks/site.yml --ask-vault-pass
```

Useful targeted runs:

```sh
ansible-playbook -i inventory.yml playbooks/site.yml --limit k8s_control_plane --ask-vault-pass
ansible-playbook -i inventory.yml playbooks/site.yml --limit load_balancers --ask-vault-pass
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
