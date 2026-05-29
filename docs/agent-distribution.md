# Agent distribution for divband instant publishing

This document explains how coding agents should discover, install, and call the divband agent-first static publishing surface. It complements the instant hosting roadmap in [`docs/agent-instant-hosting.md`](agent-instant-hosting.md).

## Discovery surfaces

Publish these files with the public web app or static asset layer:

| Asset | Purpose | Agent behavior |
| --- | --- | --- |
| `/.well-known/agent.json` | Canonical machine-readable service metadata | Read first to discover API base URL, OpenAPI URL, auth modes, MCP package, and limits. |
| `/.well-known/agent-card.json` | Compact marketplace/card metadata | Use for agent catalogs, IDE cards, and short capability summaries. |
| `/.well-known/ai-plugin.json` | Legacy plugin-compatible OpenAPI pointer | Use when an agent or plugin runtime only supports the AI plugin manifest shape. |
| `/llms.txt` | Concise model-facing operating guide | Read before making calls to learn the recommended publish flow and safety checks. |
| `/pricing.md` | Human- and model-readable tier/limit notes | Read before large or durable publishes. |
| `/openapi.json` | Generated OpenAPI contract | Use to generate REST clients and validate request/response shapes. |

## REST API flow

Agents can call the REST API directly when MCP is unavailable.

1. Build or identify a safe static output directory.
2. Create a manifest containing `path`, `size`, `contentType`, and `hash` for every file.
3. Call `POST /api/v1/publish` with the manifest and optional `spaMode`, `viewer`, `ttlSeconds`, and `anonymous` fields.
4. Upload each file to `upload.uploads[].url` using the returned method and headers.
5. Call `POST /api/v1/publish/{slug}/finalize` with the returned `versionId`.
6. Save `claimToken` securely if the site was anonymous.
7. After authentication, call `POST /api/v1/publish/{slug}/claim` to transfer an anonymous site into the authenticated account.

Authenticated agents use:

```http
Authorization: Bearer ${DIVBAND_API_TOKEN}
```

Anonymous updates and deletes may include `claimToken` in the request body until the site is claimed or expires. Owned-site list, claim, and durable ownership operations require bearer credentials.

## MCP server

The scaffolded MCP package lives in `packages/mcp-server` and uses the official TypeScript MCP SDK package, `@modelcontextprotocol/sdk`.

Configure an agent MCP client with a stdio command like:

```json
{
  "mcpServers": {
    "divband": {
      "command": "npx",
      "args": ["@divband/mcp-server"],
      "env": {
        "DIVBAND_API_BASE_URL": "https://api.divband.local",
        "DIVBAND_API_TOKEN": "${DIVBAND_API_TOKEN}"
      }
    }
  }
}
```

The MCP server exposes these tools:

- `publish_site` — create an upload plan for a new static site.
- `update_site` — create an upload plan for a new version of an existing site.
- `claim_site` — claim an anonymous site into the authenticated account.
- `get_site` — fetch metadata for a slug.
- `list_sites` — list sites owned by the authenticated account.
- `delete_site` — delete an owned site or an anonymous site with a claim token.

## Installable skill

The scaffolded skill lives in `packages/agent-skill` and is intended for Codex-style skill installers.

Install from a repository checkout:

```bash
node packages/agent-skill/scripts/install-skill.mjs
```

After package publication, install with:

```bash
npx -p @divband/agent-skill divband-install-skill
```

The skill includes:

- `SKILL.md` with the agent workflow and credential handling rules.
- `scripts/publish-static-site.mjs` for manifest generation, upload, and finalize.
- `agents/openai.yaml` for skill-list metadata.

## Agent-specific guidance

### Codex

Codex should prefer the installable skill when present. If the skill is unavailable, Codex should read `/llms.txt`, then `/openapi.json`, and use REST calls or the MCP server. Store `DIVBAND_API_TOKEN` in the user's configured secret store, not in repository files.

### Claude Code

Claude Code should add the `divband` MCP server to its MCP configuration, then invoke MCP tools instead of constructing REST calls manually. If MCP is unavailable, it can use the OpenAPI document and the same bearer token environment variable.

### Cursor

Cursor agents should discover `/.well-known/agent.json`, configure the MCP server when supported, and keep publish credentials in Cursor secrets or environment variables outside the workspace. Cursor should not index claim tokens into project context.

### Other agents

Other agents should start with `/.well-known/agent.json` and `/llms.txt`, then choose the strongest supported interface in this order:

1. MCP tools for tool-call-native runtimes.
2. OpenAPI client generation for REST-native runtimes.
3. Manual REST calls only when neither MCP nor OpenAPI tooling is available.

All agents must enforce local safety checks before upload: never publish repository roots, `.git`, `.env`, private keys, dependency folders, or secret-bearing files.
