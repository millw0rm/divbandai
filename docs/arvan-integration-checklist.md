# Arvan integration checklist for divband

Operational guide: which **divband API flows** call which **Arvan services**, required **environment variables**, and **Arvan CDN API** endpoints. Use with [`arvan-cloud.md`](arvan-cloud.md) for product context.

**Quick enable:** set `DIVBAND_INFRASTRUCTURE_PROFILE=arvan` (backend) or `divband_infrastructure_profile: arvan` (Ansible)—see [`infrastructure-profiles.md`](infrastructure-profiles.md).

Implementation: `ArvanManagedDnsProvider` in [`apps/backend/src/services/arvan-managed-dns.ts`](../apps/backend/src/services/arvan-managed-dns.ts).

---

## Environment variables (production)

### Control plane (always)

| Variable | Example | Purpose |
| --- | --- | --- |
| `API_BASE_URL` | `https://api.divband.ir` | Public API URL |
| `PUBLIC_SITE_DOMAIN` | `divband.ir` | Platform domain for static/publish routing |
| `DATABASE_URL` | `postgresql://...` | Postgres ([Arvan DBaaS](https://docs.arvancloud.ir/fa/databases/) optional) |

### Kubernetes tenant provisioning

| Variable | Example | Purpose |
| --- | --- | --- |
| `KUBERNETES_CONFIG_MODE` | `kubeconfig` | Enable cluster access |
| `KUBERNETES_APPLY` | `true` | Run `kubectl apply` for tenant manifests |
| `DIVBAND_AUTO_PROVISION_PROJECTS` | `true` | Auto welcome stack on `POST /projects` |
| `KUBERNETES_TEMPLATE_DIR` | `/app/infra/k8s/base` | Tenant YAML templates |
| `CERT_MANAGER_CLUSTER_ISSUER` | `letsencrypt-prod` | TLS for tenant ingress |
| `KUBECONFIG` | `/var/run/divband/kubeconfig/config` | Cluster on **Arvan Cloud Container** or k3s on **Cloud Server** |

Cluster runs on Arvan; divband still owns namespace-per-project logic.

### Object storage (agent instant publish)

| Variable | Example |
| --- | --- |
| `OBJECT_STORAGE_PROVIDER` | `s3` |
| `OBJECT_STORAGE_BUCKET` | `divband-sites-prod` |
| `OBJECT_STORAGE_ENDPOINT` | `https://s3.ir-thr-at1.arvanstorage.ir` |
| `OBJECT_STORAGE_REGION` | `ir-thr-at1` |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | `true` |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | *(Arvan AOS key)* |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | *(Arvan AOS secret)* |
| `OBJECT_STORAGE_STAGING_PREFIX` | `staging` |
| `OBJECT_STORAGE_LIVE_PREFIX` | `sites` |

### Managed DNS (delegated custom domains) — **Arvan adapter**

| Variable | Example | Purpose |
| --- | --- | --- |
| `DNS_PROVIDER` | `arvan` | Use `ArvanManagedDnsProvider` |
| `DNS_PROVIDER_TOKEN` | *(panel API key)* | `Authorization` header for CDN API |
| `DNS_PROVIDER_ENDPOINT` | `https://napi.arvancloud.ir/cdn/4.0/domains` | Optional override |
| `DNS_PROVIDER_DEFAULT_TTL_SECONDS` | `300` | Record TTL (60–86400) |
| `DNS_PROVIDER_PLATFORM_INGRESS_TARGET` | `ingress.divband.ir` | CNAME/ANAME target for delegated app records |
| `DNS_PROVIDER_APEX_RECORD_TYPE` | `ALIAS` or `ANAME` | Apex delegated zones (mapped to Arvan `aname`) |
| `DNS_PROVIDER_ARVAN_NAMESERVERS` | `ns1.arvancdn.ir,ns2.arvancdn.ir` | Fallback NS shown to customers |
| `DNS_PROVIDER_ARVAN_AUTO_REGISTER_DOMAIN` | `true` | `POST /dns-service` if zone missing |

### CDN edge (manual / future automation)

Not wired in backend yet; configure in panel or call API after deploy/publish:

| Action | Arvan API (CDN 4.0) |
| --- | --- |
| Add platform zone | `POST /cdn/4.0/domains/dns-service` |
| Purge after publish | `POST /cdn/4.0/domains/{domain}/caching/purge` |
| WAF / rate limit | `/cdn/4.0/domains/{domain}/waf`, `.../rate-limit/rules` |

---

## divband API flows (index)

| Flow | Endpoint | Arvan touchpoint |
| --- | --- | --- |
| 1 | `POST /projects` | K8s cluster hosting; optional platform CDN DNS |
| 2 | `POST /projects/{id}/kubernetes-namespace` | Same cluster |
| 3 | `POST /projects/{id}/platform-subdomain` | CDN in front of ingress (ops) |
| 4 | `POST /projects/{id}/domains` | CDN DNS API when `DNS_PROVIDER=arvan` |
| 5 | `POST /projects/{id}/domains/{id}/verify` | DNS records + optional ACME TXT |
| 6 | GitLab CI deploy | Cluster only |
| 7 | `POST /api/v1/publish/*` | Object Storage + optional CDN purge |

---

## Flow 1: `POST /projects` (create project)

### What divband does

1. Validates slug, org quota, unique `{slug}.{username}.{PUBLIC_SITE_DOMAIN}`.
2. Persists project (`namespace`: `project-{slug}`).
3. If `KUBERNETES_APPLY` + auto-provision: applies welcome stack (namespace, nginx, ingress, cert-manager `Certificate`).
4. Records welcome deployment; sets `platformSubdomainAttached`.

### Arvan involvement

| Step | Arvan | API / config |
| --- | --- | --- |
| Store project metadata | **No** | divband DB only |
| Create K8s namespace | **Indirect** | Your cluster on Cloud Container / Cloud Server |
| Platform hostname DNS | **Yes (ops)** | Wildcard `*.divband.ir` → ingress LB in **CDN DNS** (one-time) |
| TLS for platform host | **Yes (ops)** | cert-manager on cluster **or** CDN SSL for proxied names |
| GitLab repo | **No** | GitLab/GitHub unchanged |

### One-time platform DNS (Arvan panel or API)

```bash
# Register divband.ir on Arvan CDN (if not already)
curl -X POST 'https://napi.arvancloud.ir/cdn/4.0/domains/dns-service' \
  -H "Authorization: $ARVAN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"domain":"divband.ir","domain_type":"full","plan_level":2}'

# Wildcard A/ANAME to your ingress load balancer IP or hostname
# (exact record shape via panel or POST .../domains/divband.ir/dns-records)
```

Per-project hostnames are **not** created in Arvan DNS automatically today; routing uses **ingress `Host:` rules** on `{slug}.{user}.divband.ir`.

---

## Flow 2: `POST /projects/{id}/kubernetes-namespace` (retry welcome)

Same as auto-provision step 3. Arvan only hosts the cluster; divband runs:

```text
kubectl apply  ←  infra/k8s/base/welcome-deployment.yaml, ingress-platform.yaml
```

---

## Flow 3: `POST /projects/{id}/platform-subdomain`

### What divband does

Requires namespace + successful deployment; sets `platformSubdomainAttached` flag.

### Arvan involvement

**No API call** unless you front ingress with CDN. Ensure wildcard DNS + ingress already route to the tenant namespace.

---

## Flow 4: `POST /projects/{id}/domains` (add custom domain)

### What divband does

1. Creates `ProjectDomain` with TXT challenge `_divband.{hostname}`.
2. Returns DNS instructions (CNAME/apex/delegated NS).
3. If `dnsMode` is `delegated_*` and `DNS_PROVIDER=arvan`:
   - `ensureDelegatedZone` → Arvan CDN domain
   - `createVerificationRecord` → TXT on Arvan

### Arvan API calls (via `ArvanManagedDnsProvider`)

| divband method | Arvan endpoint | Body / notes |
| --- | --- | --- |
| `ensureZone` | `GET /cdn/4.0/domains/{zone}` | Resolve apex zone by walking labels |
| `ensureZone` (new) | `POST /cdn/4.0/domains/dns-service` | `{"domain":"customer.com","domain_type":"full"}` or `"partial"` for sub-zone |
| `getAssignedNameservers` | `GET /cdn/4.0/domains/{zone}` + NS records | Returns NS for customer delegation UI |
| `createVerificationRecord` | `POST .../domains/{zone}/dns-records` | TXT: `name` = `_divband`, `value.text` = token |

**Customer action:** delegate NS to Arvan **or** follow CNAME/apex instructions (non-delegated modes do not use Arvan adapter).

---

## Flow 5: `POST /projects/{id}/domains/{domainId}/verify`

### What divband does

1. Verifies TXT (and NS delegation if delegated).
2. Marks domain verified/active; requests certificate metadata.
3. If delegated + managed DNS: creates app + wildcard records.

### Arvan API calls (delegated + `DNS_PROVIDER=arvan`)

| divband method | Arvan endpoint | Record |
| --- | --- | --- |
| `createApplicationRecord` | `POST .../dns-records` | `@` or hostname → `DNS_PROVIDER_PLATFORM_INGRESS_TARGET` (CNAME/ANAME) |
| `createWildcardRecord` | `POST .../dns-records` | `*` → same target |
| ACME DNS-01 (cert-manager webhook) | `createAcmeChallengeRecord` | `_acme-challenge...` TXT |
| ACME cleanup | `deleteAcmeChallengeRecord` | `DELETE .../dns-records/{id}` |

### TLS options on Arvan

| Mode | How |
| --- | --- |
| **A** cert-manager on tenant ingress | DNS-01 via Arvan TXT records (above) |
| **B** CDN terminates TLS | Enable SSL on CDN domain; origin = ingress; less cert-manager work for proxied names |

**Gap:** Custom host on tenant `ingress.yaml` reprovision after verify is documented in [`domains.md`](domains.md) but not fully automated in backend yet.

---

## Flow 6: GitLab CI deploy (full-stack apps)

| Step | Arvan |
| --- | --- |
| Build in GitLab | **No** |
| Push image to registry | Your registry (GitLab or Arvan if used) |
| Deploy to `project-{slug}` namespace | **Cluster on Arvan** |
| Public traffic | Ingress on cluster; optional **CDN** in front |

Optional: purge CDN cache on deploy success (not implemented in divband).

---

## Flow 7: Agent instant publish (`POST /api/v1/publish/*`)

| Step | Arvan |
| --- | --- |
| Presigned uploads | **Object Storage (AOS)** — S3 env vars |
| Finalize / slug routing | divband backend + DB |
| Public URL | **CDN** → origin (backend static serve or bucket) recommended |

Suggested after finalize (future hook):

```bash
curl -X POST "https://napi.arvancloud.ir/cdn/4.0/domains/${PUBLIC_SITE_DOMAIN}/caching/purge" \
  -H "Authorization: $ARVAN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"purge":"all"}'
```

---

## Minimal production `.env` example (Arvan-heavy)

```bash
# Core
API_BASE_URL=https://api.divband.ir
PUBLIC_SITE_DOMAIN=divband.ir
DATABASE_URL=postgresql://...

# K8s on Arvan
KUBERNETES_CONFIG_MODE=kubeconfig
KUBERNETES_APPLY=true
DIVBAND_AUTO_PROVISION_PROJECTS=true
KUBECONFIG=/var/run/divband/kubeconfig/config

# Arvan Object Storage
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_BUCKET=divband-sites-prod
OBJECT_STORAGE_ENDPOINT=https://s3.ir-thr-at1.arvanstorage.ir
OBJECT_STORAGE_REGION=ir-thr-at1
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...

# Arvan delegated DNS
DNS_PROVIDER=arvan
DNS_PROVIDER_TOKEN=...
DNS_PROVIDER_PLATFORM_INGRESS_TARGET=ingress.divband.ir
DNS_PROVIDER_DEFAULT_TTL_SECONDS=300
DNS_PROVIDER_APEX_RECORD_TYPE=ANAME
```

---

## What Arvan cannot replace

- divband auth, orgs, projects, RBAC, audit DB
- GitLab/GitHub provisioning and CI
- Per-tenant namespace orchestration logic (`kubectl apply` templates)
- Global hostname uniqueness and TXT verification orchestration (Arvan only stores records you request)
- Instant-publish slug→version routing metadata

---

## Verification checklist

- [ ] Cluster kubeconfig works from backend pod (`kubectl get ns`)
- [ ] `POST /projects` creates `project-{slug}` namespace on cluster
- [ ] Platform wildcard DNS resolves to ingress
- [ ] AOS bucket CORS allows browser `PUT` from dashboard origin
- [ ] Publish e2e: upload → finalize → live URL
- [ ] `DNS_PROVIDER=arvan`: delegated domain returns Arvan nameservers in API response
- [ ] Verify domain creates TXT + app records in Arvan panel
- [ ] cert-manager DNS-01 or CDN SSL issues cert for custom host

---

## Related docs

- [`arvan-cloud.md`](arvan-cloud.md) — product map
- [`domains.md`](domains.md) — domain modes and verification
- [`architecture.md`](architecture.md) — request paths
- [`apps/backend/PRODUCTION.md`](../apps/backend/PRODUCTION.md) — production env reference
