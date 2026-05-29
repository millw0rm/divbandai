# divband pricing and limits

This initial distribution scaffold documents intended public limits. Production billing enforcement is still planned, and agents should read `/.well-known/agent.json` and `/llms.txt` for current machine-oriented limits before publishing.

| Tier | Audience | Retention | Sites | Storage and uploads | Publish limits | Domains | Analytics and features |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Anonymous | Agents and quick previews | 24 hours; may fall back to 1 hour during abuse spikes | Temporary unclaimed sites only | 100 files, 10 MiB max file size, 50 MiB total upload size | 10 publishes per IP per hour; unguessable slugs only | No custom domains | One-time claim token; no password protection, vanity handles, or analytics |
| Free account | Personal prototypes and docs | Permanent while within limits | 3 owned sites | 1 GiB pooled storage, 1,000 files per publish, 25 MiB max file size | 60 publishes per account per hour | 1 custom domain | API tokens can publish and update owned sites; analytics are unavailable or limited to coarse aggregates |
| Pro | Production static sites | Permanent while subscribed and within quota | 25 owned sites | 25 GiB pooled storage, larger files, and more version history | 600 publishes per account per hour | 10 custom domains | Password-protected previews, traffic analytics, vanity handles, and higher publish limits |
| Team | Organizations | Permanent while subscribed and within quota | 250 organization-managed sites | 250 GiB team pooled storage with expanded version history | 3,000 publishes per team per hour plus higher API-token limits | 100 custom domains | Shared ownership, audit history, password protection, analytics exports, vanity handles, and stricter token governance |

## Abuse and safety controls

- HTML is checked for phishing patterns before a publish can go live.
- File hashes are checked against malware and known-bad-content feeds.
- Dangerous executable, script, extension, and ambiguous binary MIME types are blocked for static hosting.
- Every hosted page should expose an abuse-report endpoint, and confirmed abuse follows a takedown workflow with quarantine, evidence preservation, owner notification when possible, review, appeal, and deletion.
- Per-IP and per-ASN throttling applies across tiers; sites or networks crossing abuse thresholds can receive shorter TTLs, stricter publish limits, or account-verification requirements.
