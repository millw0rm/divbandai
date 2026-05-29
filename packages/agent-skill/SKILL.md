---
name: divband-static-publishing
description: Publish prebuilt static websites to divband from an agent. Use when a user asks to publish a dist/build folder, create or update a divband static site, claim an anonymous publish, or configure divband API credentials.
---

# divband static publishing

## One-command install

From the repository root, install this skill into Codex with:

```bash
node packages/agent-skill/scripts/install-skill.mjs
```

For package consumers after publication:

```bash
npx -p @divband/agent-skill divband-install-skill
```

## Required credential handling

- Prefer the agent or OS secret store for `DIVBAND_API_TOKEN`.
- Use process environment only for the current shell/session when a secret store is unavailable.
- Never commit `.env` files, claim tokens, API tokens, upload URLs, private keys, or generated manifests containing sensitive local paths.
- Anonymous publishes return a `claimToken`; store it as a secret if the user may later claim or update the site.

## Publish workflow

1. Confirm the output directory is a build artifact directory (`dist`, `build`, `out`, `site`, or an explicit user-provided directory), not the repo root or home directory.
2. Reject directories containing `.git`, `.env`, private keys, dependency caches, or secret-looking files unless the user explicitly narrows the path and confirms intent.
3. Build a manifest with relative POSIX paths, byte sizes, content types, and SHA-256 hashes.
4. Call `POST ${DIVBAND_API_BASE_URL:-https://api.divband.local}/api/v1/publish` with `{ files, spaMode, ttlSeconds, anonymous }`.
5. Upload files to returned `upload.uploads[].url` with the exact method and headers.
6. Call `finalizeUrl` with `{ versionId: upload.versionId }`.
7. Report the `siteUrl`, expiry, and whether a claim token was stored.

## API examples

Create a publish session:

```bash
curl -sS -X POST "$DIVBAND_API_BASE_URL/api/v1/publish" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $DIVBAND_API_TOKEN" \
  --data '{"files":[{"path":"index.html","size":128,"contentType":"text/html","hash":"sha256-demo"}],"spaMode":true}'
```

Claim an anonymous publish:

```bash
curl -sS -X POST "$DIVBAND_API_BASE_URL/api/v1/publish/$DIVBAND_SLUG/claim" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $DIVBAND_API_TOKEN" \
  --data "{\"claimToken\":\"$DIVBAND_CLAIM_TOKEN\"}"
```

Use the helper script for a local directory:

```bash
DIVBAND_API_BASE_URL=https://api.divband.local \
DIVBAND_API_TOKEN=... \
node packages/agent-skill/scripts/publish-static-site.mjs ./dist --spa
```
