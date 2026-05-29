# Custom domains and routing

This document describes the domain modes Divband supports, the backend
verification flow, Kubernetes routing templates, ingress-controller choices, and
TLS automation options for project web endpoints.

## Goals

- Give every project a working platform hostname immediately after creation.
- Allow project owners to attach verified custom hostnames without granting them
  access to shared cluster routing resources.
- Prevent host-header takeover by routing only domains that are uniquely owned,
  verified, and bound to one project.
- Automate certificate issuance and renewal with cert-manager.
- Keep the routing implementation portable across NGINX Ingress, Traefik, Envoy
  Gateway, or any Kubernetes Gateway API implementation.

## Supported domain modes

### 1. Platform subdomain

Every project receives a platform subdomain in this format:

```text
{project}.divband.ir
```

The platform DNS zone for `divband.ir` is managed by Divband. The provisioning
system creates the required DNS record, ingress route, and TLS certificate for
the project hostname. This mode is the default and does not require customer DNS
changes.

### 2. Custom CNAME

Customers can attach a custom subdomain by creating a CNAME record that points
at the platform hostname:

```text
www.project2.com.  CNAME  project2.divband.ir.
```

The backend must verify ownership before the hostname is routed. CNAME mode is
recommended for `www`, `app`, `docs`, and other non-apex hostnames because it
keeps the customer record stable if Divband changes ingress IP addresses.

### 3. Apex domain

Apex domains such as `project2.com` cannot use a standard CNAME record. Divband
supports apex domains with one of these options:

- `A` records pointing to the current IPv4 address or addresses of the public
  ingress load balancer.
- `AAAA` records pointing to the current IPv6 address or addresses of the public
  ingress load balancer.
- Provider-specific `ALIAS`, `ANAME`, or CNAME-flattening records pointing to
  `{project}.divband.ir` where the DNS provider supports them.

Apex `A` and `AAAA` records couple the customer to ingress load-balancer
addresses, so the dashboard should display the currently required values and warn
customers before any planned address migration. `ALIAS` or `ANAME` is preferred
when available because it behaves like a CNAME at the DNS-provider edge while
still satisfying apex-domain constraints.

### 4. Optional delegated DNS

Advanced customers can delegate a zone or sub-zone to Divband with `NS` records
when they want Divband to manage DNS records on their behalf:

```text
project2.com.  NS  ns1.divband.ir.
project2.com.  NS  ns2.divband.ir.
```

Delegated DNS allows Divband to create verification, application, wildcard, and
ACME DNS-01 records automatically. It should be optional because it transfers
operational responsibility for the delegated zone to Divband. The backend must
store whether Divband manages the entire zone, only a sub-zone, or no DNS for a
custom domain.

## Backend domain model

The backend should store one row per requested hostname. Suggested fields:

| Field | Purpose |
| --- | --- |
| `id` | Stable domain attachment identifier. |
| `project_id` | Project that owns the requested hostname. |
| `hostname` | Normalized FQDN without a trailing dot, lowercased with IDNA/punycode applied. |
| `mode` | `platform_subdomain`, `custom_cname`, `apex`, or `delegated_dns`. |
| `status` | `pending_dns`, `verified`, `provisioning`, `active`, `failed`, `disabled`, or `removing`. |
| `verification_name` | TXT owner-check record name, for example `_divband.project2.com`. |
| `verification_value` | Random TXT value returned to the user. Store a hash if plaintext is not needed. |
| `dns_target` | Expected CNAME, ALIAS/ANAME target, or ingress IP set. |
| `certificate_secret_name` | Kubernetes TLS secret used by the route. |
| `last_checked_at` | Last DNS verification attempt. |
| `verified_at` | Time ownership was confirmed. |
| `failure_reason` | Latest operator or customer-facing error detail. |

Hostnames must be globally unique across all active and pending projects. The
backend should reject reserved platform names, internal service names, wildcard
labels submitted by regular users, invalid public suffixes, and domains already
attached to another project.

## Backend verification flow

1. **User submits domain.** The dashboard calls the backend with the desired
   hostname and project ID. The backend normalizes the hostname, validates that
   it is routable, checks global uniqueness, determines the domain mode, and
   creates a `pending_dns` attachment.
2. **Platform returns required TXT verification record.** The backend returns a
   deterministic record name and random value, for example:

   ```text
   _divband.project2.com.  TXT  divband-verification=8f0c0f4e6c9b4d1d
   ```

   The response should also include expected CNAME, A/AAAA, ALIAS/ANAME, or NS
   instructions for the selected mode.
3. **Backend validates DNS ownership.** A verifier job resolves the TXT record
   through public recursive resolvers and authoritative nameservers. Ownership is
   confirmed only when the expected token is present. For CNAME and apex modes,
   the job should also verify that traffic records point to the expected Divband
   target or ingress addresses. Verification should retry with exponential
   backoff and surface DNS propagation guidance in the dashboard.
4. **Platform provisions ingress route and TLS certificate.** After verification,
   the backend renders Kubernetes routing resources from `infra/k8s/base` with
   the verified hostname, applies them to the project namespace, and creates or
   updates the cert-manager `Certificate` resource. The route should not become
   active until the certificate is ready.
5. **Platform marks domain active.** The reconciler watches route, DNS, and
   certificate readiness. The domain moves to `active` when DNS still matches,
   the route has been admitted by the ingress or gateway controller, and TLS is
   serving a valid certificate for the hostname.

### Reverification and removal

- Recheck custom-domain DNS periodically because ownership can change after the
  initial verification.
- Disable routing if the TXT record is removed and the traffic record no longer
  targets Divband for a grace period defined by product policy.
- Remove the hostname from Kubernetes routes and certificates before deleting the
  domain attachment.
- Keep audit events for submit, verify, activate, disable, and remove actions.

## Kubernetes routing templates

Reusable host-based routing templates live in `infra/k8s/base`:

- `ingress.yaml` is the default Ingress template. It includes host rules for the
  platform hostname and a verified custom hostname, cert-manager integration, and
  a `Certificate` resource.
- `httproute.yaml` is the Kubernetes Gateway API alternative. It attaches project
  hostnames to a shared `Gateway` listener and routes to the project's public
  service.
- `certificate-issuers.yaml` documents ClusterIssuer templates for ACME HTTP-01
  and DNS-01 automation.

Provisioning must remove unused host entries. For example, a project without a
custom domain should render only `{project}.divband.ir`; a project with multiple
custom domains should render one route/certificate per hostname or a bounded
SAN certificate according to certificate-size and blast-radius policy.

## Router or ingress-controller choice

Divband can support multiple controllers, but each cluster should standardize on
one primary routing API.

| Option | Recommended use | Notes |
| --- | --- | --- |
| NGINX Ingress | Simple default for broad Kubernetes compatibility. | Mature Ingress support, straightforward cert-manager HTTP-01 integration, and large operational knowledge base. Use when basic host/path routing is enough. |
| Traefik | Lightweight edge routing with built-in dashboarding and dynamic config. | Works well for smaller clusters and can use either Ingress or Gateway API depending on deployment mode. |
| Envoy Gateway | Advanced L7 features and Gateway API-first operations. | Strong fit for future traffic policy, filters, and multi-tenant listener attachment controls. |
| Kubernetes Gateway API | Preferred long-term abstraction when supported by the chosen controller. | Separates shared gateway ownership from per-project route ownership and gives better status conditions than classic Ingress. |

Recommended path:

1. Start with NGINX Ingress and `infra/k8s/base/ingress.yaml` if the immediate
   goal is operational simplicity.
2. Use cert-manager for certificate lifecycle regardless of routing controller.
3. Move new clusters to Gateway API with Envoy Gateway, Traefik, or another
   conformant implementation when Divband needs richer policy, safer cross-
   namespace attachment, or controller portability.

## TLS automation

TLS is automated with cert-manager and ACME. Divband should run at least two
ClusterIssuers per environment: staging for safe testing and production for real
certificates.

### HTTP-01 challenges

HTTP-01 is suitable for platform subdomains and many custom CNAME domains after
DNS points to Divband. cert-manager creates a temporary solver route under
`/.well-known/acme-challenge/` and the ingress controller serves the challenge.
Use HTTP-01 when:

- The hostname already resolves to the Divband ingress.
- Port 80 is reachable from the public internet.
- Wildcard certificates are not required.

### DNS-01 challenges

DNS-01 is required for wildcard certificates and preferred for delegated DNS. It
is also useful when port 80 is unavailable or the route cannot be exposed before
certificate issuance. cert-manager writes `_acme-challenge` TXT records through a
DNS provider API. Use DNS-01 when:

- Divband manages the zone or delegated sub-zone.
- A wildcard such as `*.project2.com` is needed.
- The DNS provider has a supported cert-manager webhook or native solver.

### Certificate policy

- Use separate certificates for unrelated customer domains to reduce blast
  radius and simplify removal.
- Prefer ECDSA keys unless compatibility requirements demand RSA.
- Keep ACME account credentials and DNS API tokens in a cluster secret store.
- Use cert-manager staging before production to avoid ACME rate-limit mistakes.
- Monitor `Certificate`, `CertificateRequest`, `Order`, and `Challenge`
  conditions and expose failures in the dashboard.

## Implementation plan

1. **Data model and API**
   - Add domain-attachment persistence with normalized unique hostnames.
   - Add API endpoints to submit, list, recheck, disable, and delete domains.
   - Return mode-specific DNS instructions and TXT verification requirements.
2. **DNS verifier**
   - Implement asynchronous TXT, CNAME, A, AAAA, ALIAS/ANAME, and NS checks.
   - Query authoritative nameservers and public resolvers to reduce false
     positives from stale caches.
   - Record check attempts, timestamps, and actionable failure messages.
3. **Provisioning reconciler**
   - Render `infra/k8s/base/ingress.yaml` or `infra/k8s/base/httproute.yaml`
     only after ownership is verified.
   - Render `Certificate` resources with the selected ClusterIssuer.
   - Watch controller admission and cert-manager readiness before marking active.
4. **TLS issuers**
   - Install cert-manager and create staging and production ClusterIssuers from
     `infra/k8s/base/certificate-issuers.yaml`.
   - Configure HTTP-01 for the default ingress class and DNS-01 for delegated or
     provider-managed zones.
5. **Dashboard experience**
   - Show exact records to create, verification status, last checked time, and
     troubleshooting hints.
   - Provide copy buttons for TXT, CNAME, A/AAAA, ALIAS/ANAME, and NS records.
6. **Operations and security**
   - Enforce one verified owner per hostname.
   - Audit every domain lifecycle action.
   - Alert on certificate expiration, route admission failures, DNS drift, and
     ACME rate-limit errors.
