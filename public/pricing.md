# divband pricing and limits

This initial distribution scaffold documents intended public limits. Production billing enforcement is still planned.

| Tier | Audience | Retention | Sites | Storage | Bandwidth | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Anonymous | Agents and quick previews | 24 hours by default, up to platform maximum | Temporary unclaimed sites | Limited per publish | Rate limited | Receives a one-time claim token. No custom domains. |
| Free account | Personal prototypes and docs | Durable while within limits | Limited owned sites | Limited pooled storage | Limited monthly transfer | API tokens can publish and update owned sites. |
| Pro | Production static sites | Durable | Higher owned-site limit | Higher storage and version history | Higher monthly transfer | Eligible for custom domains and password-protected previews. |
| Team | Organizations | Durable | Organization-managed | Team pooled quota | Team pooled transfer | Adds shared ownership, audit history, and stricter token governance. |

Agents should read `/.well-known/agent.json` and `/llms.txt` for current machine-oriented limits before publishing.
