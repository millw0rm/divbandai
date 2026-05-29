# Divband task backlog: tests and delegated DNS

This backlog converts the current test-coverage and delegated-DNS findings into actionable implementation tasks. It is intentionally scoped as work items rather than architecture prose; keep design details in [`docs/product.md`](product.md), [`docs/domains.md`](domains.md), and the infrastructure docs.

## Testing tasks

| Task | Priority | Area | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- |
| Add a root test entrypoint | P0 | Tooling/CI | Package-manager decision, existing smoke scripts | `npm test` exists at the repo root, runs the current backend smoke checks and typecheck, and exits non-zero on failure. |
| Add backend unit tests | P0 | Backend | Test runner selection, stable backend service boundaries | Unit tests cover auth registration/login, project creation, domain verification token generation, deployment reporting, environment variable masking, and rollback state transitions. |
| Add backend integration tests | P0 | Backend/platform | Local database mode, mocked GitLab/Kubernetes/DNS adapters | Integration tests exercise signup through project provisioning, platform-subdomain attach, custom-domain verification, deployment report ingestion, status reads, and persistence restore. |
| Add frontend unit/component tests | P1 | Frontend | Frontend framework/build decision | Dashboard client/UI tests cover auth flows, project list/create, domain instructions/status, deployment status/log display, and environment-variable masking behavior. |
| Add automated browser E2E smoke suite | P1 | E2E/release | Runnable local backend/frontend, seeded demo data, browser runner | A Playwright or equivalent suite starts the local MVP stack and verifies signup, project creation, deployment status, domain attach/verify, and dashboard rendering without manual curl steps. |
| Wire monorepo tests into CI | P1 | CI/operations | Root test entrypoint, CI runner image | CI runs install, typecheck, unit/integration tests, and E2E smoke where supported; failing tests block merge/release. |
| Document the test strategy | P1 | Docs/devrel | Final test runner choices | Docs clearly distinguish typecheck, unit, integration, smoke, E2E, and customer-project GitLab template tests, including exact commands and troubleshooting notes. |

## Delegated DNS / nameserver tasks

| Task | Priority | Area | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- |
| Decide delegated-DNS architecture | P0 | Domains/infra | DNS provider evaluation, hosting-domain decision | [`docs/domains.md`](domains.md) records the managed DNS provider decision for initial delegated customer zones under **Optional delegated DNS**, states that self-hosted `ns1.divband.ir`/`ns2.divband.ir` authoritative DNS is not an initial-launch goal, and allows delegated DNS model/API and provider adapter work to proceed against the managed-provider assumption. |
| Add delegated-DNS domain model | P1 | Backend/domains | Architecture decision, database persistence | Domain records can represent no-DNS, CNAME/apex, delegated sub-zone, and delegated full-zone modes with nameserver set, delegation status, verification status, and audit fields. |
| Implement managed DNS provider adapter | P1 | Integrations/domains | Provider credentials, provider SDK/API, secret storage | Backend can create/update/delete customer zones or delegated sub-zones, return assigned nameservers, create `_divband` TXT records, app records, wildcard records, and `_acme-challenge` records through the provider. |
| Verify parent-zone NS delegation | P1 | Domains/security | DNS verifier job | Verification queries public resolvers and authoritative parent nameservers, confirms the delegated domain points to the expected NS set, detects stale/partial delegation, and exposes actionable dashboard errors. |
| Connect delegated DNS to Kubernetes routing | P1 | Domains/infra | Kubernetes apply integration, route template rendering | Once delegation is verified, the reconciler renders the correct Ingress/HTTPRoute and Certificate resources so Host-header routing sends traffic to the owning project namespace only. |
| Add DNS-01 certificate automation for delegated zones | P1 | Domains/TLS | cert-manager ClusterIssuers, DNS provider credentials | Delegated zones can receive normal and wildcard certificates through DNS-01, and certificate status/failures are visible through the API/dashboard. |
| Add dashboard nameserver instructions | P1 | Frontend/domains | Domain model/API instructions | The dashboard shows exact nameservers or CNAME/A/ALIAS records by mode, copy buttons, propagation guidance, verification status, and failure reasons. |
| Add DNS drift and takeover protection | P1 | Security/operations | Periodic verifier, audit logging | The platform periodically rechecks TXT ownership, target records, and NS delegation; drift disables or quarantines routing before cross-project/domain takeover is possible. |
| Evaluate self-hosted authoritative DNS only if needed | P2 | Infrastructure | Decision to use `ns1.divband.ir`/`ns2.divband.ir` rather than managed DNS nameservers | If self-hosting is chosen, infra includes authoritative DNS roles/services, hidden-primary/secondary replication, TSIG/AXFR or API updates, glue-record docs, DNSSEC policy, health checks, backups, rate limits, and incident runbooks. |

## Recommended execution order

1. Create the root test entrypoint and backend unit/integration test foundation so future DNS work is protected by automated checks.
2. Decide managed DNS versus self-hosted authoritative DNS before exposing any `ns1.divband.ir` / `ns2.divband.ir` customer instructions.
3. Implement delegated-DNS storage/API and provider integration behind an internal flag.
4. Add NS delegation verification, DNS-01 certificates, Kubernetes route reconciliation, and dashboard instructions.
5. Add E2E coverage and synthetic checks for the complete custom-domain path before public launch.
