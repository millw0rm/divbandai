# Arvan Cloud — platform reference and divband integration map

This document summarizes [Arvan Cloud](https://www.arvancloud.ir/) products for replacing or complementing parts of the divband stack. Official product docs are published in **Persian (fa)** and **English (en)** on the same paths; use the **fa** URLs below unless you prefer English.

> **Note:** `docs.arvancloud.ir` was not reachable from the environment where this guide was drafted (connection failed). API bases, endpoints, and integration notes below are compiled from Arvan’s public API portal, third-party integration guides, community SDKs, and the divband codebase. **Verify region codes, pricing, and API paths in the panel and live docs before production use.**

## Documentation index (fa)

| Product | Persian docs | English equivalent |
| --- | --- | --- |
| Cloud Server (IaaS) | https://docs.arvancloud.ir/fa/cloud-server/ | https://docs.arvancloud.ir/en/cloud-server/ |
| CDN / DNS / Security | https://docs.arvancloud.ir/fa/cdn/ | https://docs.arvancloud.ir/en/cdn/ |
| Object Storage (AOS) | https://docs.arvancloud.ir/fa/object-storage/ | https://docs.arvancloud.ir/en/object-storage/ |
| Video on Demand (VOD) | https://docs.arvancloud.ir/fa/vod/ | https://docs.arvancloud.ir/en/vod/ |
| Cloud Container (CaaS/K8s) | https://docs.arvancloud.ir/fa/cloud-container/ | https://docs.arvancloud.ir/en/cloud-container/ |
| Databases (DBaaS) | https://docs.arvancloud.ir/fa/databases/ | https://docs.arvancloud.ir/en/databases/ |
| Edge Computing | https://docs.arvancloud.ir/fa/edge-computing/ | https://docs.arvancloud.ir/en/edge-computing/ |
| Accounts / API keys | https://docs.arvancloud.ir/fa/accounts/ | https://docs.arvancloud.ir/en/accounts/ |
| Developer tools | https://docs.arvancloud.ir/fa/developer-tools/ | https://docs.arvancloud.ir/en/developer-tools/ |
| VPC | https://docs.arvancloud.ir/fa/vpc/ | (check site for `/en/vpc/` if added) |
| AIaaS | https://docs.arvancloud.ir/fa/aiaas/ | (product-specific) |
| Logs (CloudLogs) | https://docs.arvancloud.ir/fa/logs/ | (product-specific) |

**API hub:** https://www.arvancloud.ir/en/dev/api (also lists CDN, IaaS, Object Storage, Cloud Container, VOD, Live Streaming, DBaaS).

**Panel:** https://panel.arvancloud.ir/ — API keys: Profile → API keys / machine users.

---

## Platform overview

Arvan Cloud is an Iran-based public cloud and CDN provider (AS202468) with a unified panel, REST APIs, CLI/Terraform, and strong presence in Iran, Turkey, UAE, and European edge POPs. It is **not** traditional shared hosting; the platform targets CDN, compute, storage, video, and managed data services.

Typical building blocks:

```text
                    ┌─────────────────────────────────────┐
                    │  panel.arvancloud.ir + API keys     │
                    └─────────────────────────────────────┘
                                      │
     ┌────────────┬────────────┬───────┴───────┬────────────┬────────────┐
     ▼            ▼            ▼               ▼            ▼            ▼
   CDN         IaaS      Object Storage   Cloud Container  DBaaS      Edge (r1ec)
 (edge/DNS)  (Abrak VM)   (S3 AOS)         (Kubernetes)   (managed)   (Workers)
     │            │            │               │            │
     └────────────┴────────────┴───────────────┴────────────┘
                         VPC / private networks
                         Logs (CloudLogs) / metrics exporters
```

---

## Authentication and API conventions

| Item | Detail |
| --- | --- |
| **Machine user / API key** | Create in panel (Profile → API keys). Used as `Authorization: Bearer <token>` or `Apikey <key>` depending on product docs. |
| **CDN API base** | `https://napi.arvancloud.ir/cdn/4.0/` (community SDKs sometimes use `napi.arvancloud.com`) |
| **IaaS (Cloud Server) API** | `https://napi.arvancloud.ir/ecc/v1` — paths like `/regions/:region/servers` |
| **Object Storage** | S3-compatible API (not the same host as CDN napi) |
| **VOD API** | `https://napi.arvancloud.ir/vod/2.0/` (channels, videos, upload) |
| **Terraform** | Provider `arvancloud/arvan` — API key from panel; resources for IaaS “Abrak”, CDN firewall, etc. |
| **CLI examples** | `arvancli` (IaaS firewall/networks), `r1ec` (edge computing deploy), CDN purge via API |

REST over HTTP; no framework required (curl/Postman). Prefer separate API keys per environment and least privilege per product.

---

## 1. Cloud Server (IaaS)

**Docs:** [fa/cloud-server](https://docs.arvancloud.ir/fa/cloud-server/)

Virtual machines (“Abrak”) with configurable CPU/RAM/disk, images (e.g. Debian/Ubuntu), public/private networking, floating IPs, snapshots, and resize.

| Capability | Notes |
| --- | --- |
| Regions / datacenters | Examples: `ir-thr-c2` (Tehran Forogh), others per panel |
| Networking | Private networks (CIDR), attach private IP, floating IP attach/detach |
| Firewall | **IaaS firewall groups** (TCP/UDP/CIDR rules) attached to servers — distinct from CDN WAF |
| BYOIP | Bring /24 IPv4 via LOA + RIPE route object for AS202468; use on Cloud Server private networks |
| Automation | OpenAPI → Go client (`hamidfzm/arvancloud-go`), Terraform `arvan_iaas_abrak`, `arvancli iaas` |

**divband fit**

| Today (divband) | Arvan option |
| --- | --- |
| VPS + Ansible bootstrap (`infra/ansible`, k3s) | Run control-plane VM(s) on Cloud Server; same Ansible/k3s flow |
| Dedicated ingress nodes | Abrak with public IP + nginx/Envoy |
| GitLab / runners on VM | Single or multi Abrak |

**Not a drop-in replacement for:** per-tenant Kubernetes namespaces on your own cluster — that stays **Cloud Container** or self-managed k8s on Abrak.

---

## 2. CDN, DNS, and security

**Docs:** [fa/cdn](https://docs.arvancloud.ir/fa/cdn/)

Global anycast CDN: caching, SSL, smart routing, minification, DDoS, **WAF**, **rate limiting**, **CDN firewall** (Wireshark-like filter expressions), DNS hosting, analytics, log access.

| Feature | API / ops notes |
| --- | --- |
| Add domain | CDN panel or `POST` domain APIs under `/cdn/4.0/domains/` |
| DNS records | CRUD, “cloud” proxy toggle per record, BIND zone import |
| Cache | Settings + **purge** (all, by path; ~seconds propagation; no tag purge per third-party reviews) |
| SSL | Panel + API SSL mode updates |
| WAF | Modes: `off`, `detect`, `protect`; packages (default, CRS, Comodo); custom path/IP rules |
| Rate limit | Per URL pattern, method, IP exclusions, block duration — `POST .../rate-limit/rules` |
| CDN firewall | Import existing settings in Terraform; actions: allow, deny, bypass, challenge |
| Metrics | Official Prometheus CDN exporter (`arvancloud/ar-prometheus-exporter`) |

**divband fit**

| Today (divband) | Arvan option |
| --- | --- |
| Platform zone `divband.ir` + per-project hostnames | Arvan CDN as reverse proxy in front of ingress or static origin |
| Custom domains (CNAME/A/ALIAS) | Customer DNS → Arvan CDN → your origin; or Arvan DNS for delegated zones |
| `DNS_PROVIDER=http` managed DNS adapter | Implement adapter backed by **Arvan CDN DNS API** (zones, TXT for `_divband`, `_acme-challenge`, CNAME/A) instead of generic HTTP shim |
| cert-manager HTTP-01 | Works if orange-cloud/proxy points to cluster; DNS-01 via Arvan DNS API + webhook |
| Instant static publish edge | Origin = object storage or control-plane static URL; CDN caches `sites/{slug}/...` |
| DDoS / WAF / rate limits for publish abuse | CDN rate limits + WAF on upload/API hostnames |

**Caveat:** Tenant isolation is still your routing/metadata layer; CDN does not replace project-scoped K8s namespaces.

---

## 3. Object Storage (AOS)

**Docs:** [fa/object-storage](https://docs.arvancloud.ir/fa/object-storage/)

S3-compatible storage (AWS SDK, rclone, MinIO clients).

| Setting | Typical value |
| --- | --- |
| Endpoint | `https://s3.ir-thr-at1.arvanstorage.ir` (Tehran Simin) or `https://s3.ir-tbz-sh1.arvanstorage.ir` (Tabriz Shahriar) |
| Region / location constraint | `ir-thr-at1`, `ir-tbz-sh1` |
| Path style | **Often required** — `OBJECT_STORAGE_FORCE_PATH_STYLE=true` |
| Credentials | S3 access key + secret from Object Storage panel |
| Features | Buckets, objects, multipart upload, ACLs, storage class, pre-signed URLs |

**divband configuration (production S3 block)**

Align with `apps/backend/PRODUCTION.md` and `apps/backend/src/config.ts`:

```bash
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_BUCKET=divband-sites-prod
OBJECT_STORAGE_REGION=ir-thr-at1
OBJECT_STORAGE_ENDPOINT=https://s3.ir-thr-at1.arvanstorage.ir
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_STAGING_PREFIX=staging
OBJECT_STORAGE_LIVE_PREFIX=sites
```

**Bucket policy needs:** `PutObject`, `GetObject`, `HeadObject`, `DeleteObject` on staging/live prefixes; CORS for browser `PUT` from dashboard origin.

**divband fit:** Strongest near drop-in — replaces AWS S3, R2, MinIO (prod), and backs **agent instant publish** (`sites/{slug}/versions/{versionId}/...`).

**Optional:** Point CDN origin at bucket website endpoint or reverse proxy to control-plane `StaticServingService` for SPA fallback rules you already implement in code.

---

## 4. Video on Demand (VOD)

**Docs:** [fa/vod](https://docs.arvancloud.ir/fa/vod/)

Managed video platform: channels, upload (file or URL), transcoding profiles, watermark, secure links, HLS playback, ads integration.

| API | `https://napi.arvancloud.ir/vod/2.0/` |
| SDK | Official `arvancloud/vodapisdk` (PHP); community Node/Python clients |

**divband fit:** Only if you add video hosting to the product — **not** required for current MVP (static sites + container deploys). Relevant for future media-heavy tenants.

---

## 5. Cloud Container (CaaS / Kubernetes)

**Docs:** [fa/cloud-container](https://docs.arvancloud.ir/fa/cloud-container/)

Managed Kubernetes / container platform (PaaS) for running workloads without operating control-plane VMs yourself.

| Aspect | Notes |
| --- | --- |
| Use case | Host divband control plane or **tenant workloads** on managed K8s |
| DB on K8s | No separate “Arvan managed Postgres” branding in public API hub — often run **DBaaS** or operators (e.g. CloudNativePG) on cluster |
| Observability | Arvan Prometheus exporter lists PaaS/CaaS metrics as “coming soon” |

**divband fit**

| Today | Arvan option |
| --- | --- |
| k3s on VPS via Ansible | Migrate cluster to Cloud Container; keep `infra/k8s` templates |
| Per-project namespaces | Same pattern if cluster is yours on Arvan |
| `KUBERNETES_APPLY` + kubeconfig on backend | Point kubeconfig at Arvan-managed cluster API |

**Trade-off:** Less bare-metal control than k3s-on-Abrak; potentially less ops burden.

---

## 6. Databases (DBaaS)

**Docs:** [fa/databases](https://docs.arvancloud.ir/fa/databases/)

Managed database product line (see panel for engines and tiers). Public developer API page groups **DBaaS** alongside other products.

**divband fit**

| Today | Arvan option |
| --- | --- |
| `PERSISTENCE_DRIVER=postgres` + self-hosted Postgres | Managed DBaaS instance; set `DATABASE_URL` on control plane |
| SQLite/memory (local MVP) | Unchanged for dev |

**Open decision in** `docs/product.md` **:** managed Postgres vs Supabase — Arvan DBaaS is a regional alternative if data residency in Iran matters.

---

## 7. Edge Computing

**Docs:** [fa/edge-computing](https://docs.arvancloud.ir/fa/edge-computing/)

JavaScript workers at the edge (Cloudflare Workers–style). CLI: **`r1ec`** — `r1ec deploy [PROJECT] -f bundle.js`, `r1ec docs -l fa|en`.

**divband fit**

| Use case | Idea |
| --- | --- |
| Static publish edge | Worker resolves `Host` → origin fetch or KV mapping (lighter than full CDN config for simple cases) |
| Auth at edge | Validate API keys before origin |
| SPA routing | `index.html` fallback at edge instead of only in `StaticServingService` |

**Trade-off:** You already have edge logic in the backend; edge workers duplicate some behavior unless you move static serving off the control plane.

---

## 8. VPC

**Docs:** [fa/vpc](https://docs.arvancloud.ir/fa/vpc/)

Private isolated networks for cloud resources (region-scoped, subnets, security groups — confirm in panel docs).

**divband fit:** Segment control-plane DB, K8s API, and Abrak nodes; connect Cloud Container cluster to private services. Complements **IaaS private networks** (CLI: `arvancli iaas network create-network`).

---

## 9. AIaaS

**Docs:** [fa/aiaas](https://docs.arvancloud.ir/fa/aiaas/)

Documented as a product area on Arvan’s site; **not** listed as a first-class REST product on the main public API hub (unlike CDN/IaaS/VOD). Treat as **panel-led AI services** — read fa docs for current models, quotas, and endpoints.

**divband fit:** Post-MVP **production AI assistant** (`docs/product.md` P2) — evaluate only if Arvan exposes stable inference APIs and data-processing terms meet your compliance needs. Until then, keep external model providers.

---

## 10. Logs (CloudLogs)

**Docs:** [fa/logs](https://docs.arvancloud.ir/fa/logs/)

Centralized log ingestion via **custom HTTP API** (not standard syslog UDP). Lightweight forwarders batch logs to Arvan.

**divband fit**

| Today | Arvan option |
| --- | --- |
| Audit events in DB + K8s/container logs | Ship control-plane and ingress logs to CloudLogs |
| Future metrics | Combine with `arvancloud/ar-prometheus-exporter` (CDN; object storage metrics in community exporter) |

---

## 11. Accounts and developer tools

**Docs:** [fa/accounts](https://docs.arvancloud.ir/fa/accounts/), [fa/developer-tools](https://docs.arvancloud.ir/fa/developer-tools/)

| Topic | Content |
| --- | --- |
| Accounts | Organization, billing, users, API key lifecycle |
| Developer tools | API keys, CLI, SDKs, Terraform, Cloud Shell, integration guides |

**Operational checklist**

1. Separate keys for: CDN/DNS automation, S3 publish bucket, IaaS/Terraform, VOD (if used).
2. Store keys in Ansible vault / K8s secrets (`divband_dns_provider_token`, object storage keys) — same patterns as `infra/ansible/roles/divband_app`.
3. Rotate keys on offboarding; scope CDN token to zones you manage.

---

## divband replacement matrix (summary)

Priority for Iranian residency, cost, and minimal code change:

| divband component | Recommended Arvan service | Effort | Notes |
| --- | --- | --- | --- |
| Object storage (publish + static keys) | **Object Storage (AOS)** | Low | S3 adapter already in `object-storage.ts` |
| Platform + custom DNS / ACME | **CDN DNS API** | Medium | Set `DNS_PROVIDER=arvan` (see `arvan-managed-dns.ts`) |
| Public HTTP(S) edge | **CDN** | Low–medium | Origin to ingress or static; purge on publish finalize |
| DDoS / WAF / rate limits | **CDN security** | Low | Panel + API rules |
| Control plane + k3s VPS | **Cloud Server** and/or **Cloud Container** | Medium–high | Ansible path vs managed K8s |
| Postgres persistence | **DBaaS** | Medium | `DATABASE_URL` only |
| Tenant K8s namespaces | **Cloud Container** (your cluster) | High | Same manifests, new kubeconfig |
| Agent static at edge only | **CDN** + AOS | Medium | Optional **Edge (r1ec)** for host routing |
| Video | **VOD** | N/A today | Future |
| AI assistant | **AIaaS** (if applicable) | TBD | Post-MVP |
| Central logging | **CloudLogs** | Low | Sidecar/forwarder |

---

## Suggested migration phases

### Phase A — Storage and CDN (highest ROI)

1. Create private bucket in `ir-thr-at1` (or Tabriz if latency dictates).
2. Point divband `OBJECT_STORAGE_*` at Arvan S3 endpoint; run publish e2e tests.
3. Add CDN domain for `*.divband.ir` and static publish hostnames; origin = control plane or bucket.
4. Implement cache purge hook on publish finalize (CDN API).

### Phase B — DNS and TLS

1. Host `divband.ir` zone on Arvan DNS or delegate NS.
2. Build **managed DNS provider** mapping `ManagedDnsProvider` operations to Arvan DNS API (verification TXT, app CNAME/ALIAS, `_acme-challenge`).
3. Wire cert-manager DNS-01 to same API or keep HTTP-01 behind CDN.

### Phase C — Compute and data

1. Move Postgres to DBaaS or keep on Abrak with backups.
2. Either lift k3s to Cloud Container or run Abrak pool + existing Ansible.
3. Forward logs to CloudLogs; scrape CDN/object metrics.

---

## Code touchpoints in divband

| Area | Path |
| --- | --- |
| Object storage config | `apps/backend/src/config.ts`, `services/object-storage.ts` |
| Production env table | `apps/backend/PRODUCTION.md` |
| Managed DNS interface | `apps/backend/src/services/managed-dns.ts` |
| Domain model / verification | `docs/domains.md`, `backend-service.ts` |
| Infra secrets | `infra/ansible/roles/divband_app/` |
| Architecture | `docs/architecture.md` |

**Example: Arvan DNS adapter** — set `DNS_PROVIDER=arvan` and `DNS_PROVIDER_TOKEN` (implemented in `apps/backend/src/services/arvan-managed-dns.ts`). Step-by-step flow mapping: [`arvan-integration-checklist.md`](arvan-integration-checklist.md).

---

## Third-party references

| Resource | URL |
| --- | --- |
| Terraform provider | https://github.com/arvancloud/terraform-provider-arvan |
| VOD SDK | https://github.com/arvancloud/vodapisdk |
| CDN Prometheus exporter | https://github.com/arvancloud/ar-prometheus-exporter |
| PHP CDN client (API surface hint) | https://github.com/mohammadv184/arvancloud |
| rclone / Singularity S3 profile | `s3.ir-thr-at1.arvanstorage.ir`, `ir-thr-at1` |
| Edge CLI | https://docs.arvancloud.ir/en/edge-computing/cli |

---

## Risks and constraints

1. **Egress and residency** — Confirm data stays in desired region; cross-border replication may differ from AWS.
2. **API host consistency** — Use `napi.arvancloud.ir` in production; verify whether `.com` aliases apply to your account.
3. **Path-style S3** — Required for many clients; divband already supports `OBJECT_STORAGE_FORCE_PATH_STYLE`.
4. **CDN vs origin routing** — Instant static path still needs authoritative mapping (`slug` → version) at origin or edge worker.
5. **Managed DNS adapter** — Implement `DNS_PROVIDER=arvan` for delegated zones; CNAME/apex customer-managed modes unchanged.
6. **Doc freshness** — Re-read fa docs for AIaaS, DBaaS engines, and VPC limits before contracting.

---

## Related divband docs

- [`architecture.md`](architecture.md) — control plane vs static publish paths
- [`domains.md`](domains.md) — verification, delegated DNS, TLS
- [`product.md`](product.md) — open decisions (storage, DB, hosting)
- [`arvan-integration-checklist.md`](arvan-integration-checklist.md) — per-flow env vars and Arvan API calls
- [`apps/backend/PRODUCTION.md`](../apps/backend/PRODUCTION.md) — S3 and DNS env vars

When official docs are accessible, diff this guide against the live fa pages and update API version paths if Arvan bumps beyond `cdn/4.0` or `vod/2.0`.
