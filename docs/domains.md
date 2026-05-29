# Domains and routing

## Supported domain modes

1. **Platform subdomain**: `{project}.divband.ir` is created automatically.
2. **Custom subdomain**: customers create a `CNAME`, for example `www.project2.com -> project2.divband.ir`.
3. **Apex domain**: customers use `A`/`AAAA` records to divband ingress IPs, or provider-specific `ALIAS`/`ANAME` records.
4. **Delegated DNS**: advanced customers delegate a zone with `NS` records so divband can manage records.

## Verification flow

1. User submits a custom domain in the dashboard.
2. Backend creates a verification token.
3. User adds a TXT record, for example `_divband.project2.com`.
4. Backend resolves DNS and verifies ownership.
5. Backend creates/updates the route for the hostname.
6. cert-manager requests a certificate.
7. The dashboard marks the domain as active after the route and certificate are ready.

## Routing

The ingress or Gateway API layer must route by HTTP `Host` header into the project's namespace service. Hostnames are never trusted until they are attached to exactly one verified project.

## TLS

Use cert-manager with ACME. HTTP-01 can be used for platform subdomains and many CNAME domains. DNS-01 is preferred for wildcard or delegated DNS automation.
