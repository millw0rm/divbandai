# Infrastructure profiles

divband supports **optional infrastructure presets** alongside the generic defaults you use today (MinIO, AWS S3, HTTP DNS shim, any Kubernetes cluster). A profile only fills in **unset** environment variables; anything you set explicitly still wins.

| Profile | When to use |
| --- | --- |
| `default` | Current behavior: generic S3, `DNS_PROVIDER=disabled` or `http`, any cluster. |
| `arvan` | [Arvan Cloud](https://www.arvancloud.ir/) Object Storage + CDN DNS for delegated domains. |

Kubernetes provisioning (`kubectl apply`, per-project namespaces) is **unchanged** in both profiles—you run the cluster on Arvan (or anywhere) and point `KUBECONFIG` at it.

---

## Enable the Arvan profile

### Backend / local process

```bash
export DIVBAND_INFRASTRUCTURE_PROFILE=arvan
export OBJECT_STORAGE_BUCKET=divband-sites-prod
export OBJECT_STORAGE_ACCESS_KEY_ID=...      # required — not preset
export OBJECT_STORAGE_SECRET_ACCESS_KEY=...  # required — not preset
export DNS_PROVIDER_TOKEN=...                # required for delegated DNS
export DNS_PROVIDER_PLATFORM_INGRESS_TARGET=ingress.divband.ir
```

Profile defaults applied when unset:

| Variable | Arvan preset |
| --- | --- |
| `OBJECT_STORAGE_PROVIDER` | `s3` |
| `OBJECT_STORAGE_ENDPOINT` | `https://s3.ir-thr-at1.arvanstorage.ir` |
| `OBJECT_STORAGE_REGION` | `ir-thr-at1` |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | `true` |
| `DNS_PROVIDER` | `arvan` |
| `DNS_PROVIDER_ENDPOINT` | `https://napi.arvancloud.ir/cdn/4.0/domains` |
| `DNS_PROVIDER_APEX_RECORD_TYPE` | `ANAME` |

Implementation: [`apps/backend/src/infrastructure-profile.ts`](../apps/backend/src/infrastructure-profile.ts), [`apps/backend/src/services/arvan-managed-dns.ts`](../apps/backend/src/services/arvan-managed-dns.ts).

### Ansible production deploy

In inventory (see [`infra/ansible/inventory.arvan.example.yml`](../infra/ansible/inventory.arvan.example.yml)):

```yaml
all:
  vars:
    divband_infrastructure_profile: arvan
    divband_object_storage_bucket: divband-sites-prod
    divband_dns_provider_platform_ingress_target: ingress.divband.ir
    # Store in vault:
    # vault_divband_dns_provider_token
    # object storage keys in divband-backend-env Secret
```

The `divband_app` role loads [`profile_arvan.yml`](../infra/ansible/roles/divband_app/vars/profile_arvan.yml) and sets backend env vars on the control-plane Deployment.

### Mix Arvan with non-Arvan pieces

Profiles are **not** all-or-nothing. Examples:

| Goal | Settings |
| --- | --- |
| Arvan storage only | `DIVBAND_INFRASTRUCTURE_PROFILE=arvan` + `DNS_PROVIDER=disabled` |
| Arvan DNS only | `DNS_PROVIDER=arvan` + `OBJECT_STORAGE_ENDPOINT=https://s3.amazonaws.com` |
| Generic HTTP DNS adapter | `DIVBAND_INFRASTRUCTURE_PROFILE=default` + `DNS_PROVIDER=http` |

---

## What each profile does *not* change

| Area | Notes |
| --- | --- |
| GitLab / GitHub | Same adapters |
| Project create / K8s namespaces | Still `KUBERNETES_APPLY` + your cluster |
| CNAME custom domains (customer DNS) | No Arvan adapter required |
| Platform wildcard DNS | Still operator setup (Arvan CDN one-time) |
| CDN cache purge on publish | Not automated yet |

---

## Related docs

- [`arvan-integration-checklist.md`](arvan-integration-checklist.md) — API mapping per divband flow
- [`arvan-cloud.md`](arvan-cloud.md) — product overview
- [`apps/backend/PRODUCTION.md`](../apps/backend/PRODUCTION.md) — all production env vars
- [`development-vs-production.md`](development-vs-production.md) — local vs deploy paths
