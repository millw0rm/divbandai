#!/usr/bin/env bash
# Ask the production VPS to pull from GHCR and deploy a git SHA (used by GitHub Actions).
set -euo pipefail

SHA="${1:-}"
WEBHOOK_URL="${DIVBAND_DEPLOY_WEBHOOK_URL:-}"
WEBHOOK_SECRET="${DIVBAND_DEPLOY_WEBHOOK_SECRET:-}"
REF="${DIVBAND_DEPLOY_REF:-main}"

if [[ -z "${SHA}" || "${SHA}" == "-h" || "${SHA}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/trigger-vps-deploy.sh <git-sha>

Requires:
  DIVBAND_DEPLOY_WEBHOOK_URL     e.g. http://94.101.178.146:9090/deploy
  DIVBAND_DEPLOY_WEBHOOK_SECRET  shared bearer token
EOF
  exit 2
fi

[[ -n "${WEBHOOK_URL}" ]] || { echo "DIVBAND_DEPLOY_WEBHOOK_URL is required" >&2; exit 1; }
[[ -n "${WEBHOOK_SECRET}" ]] || { echo "DIVBAND_DEPLOY_WEBHOOK_SECRET is required" >&2; exit 1; }

payload="$(printf '{"sha":"%s","ref":"%s"}' "${SHA}" "${REF}")"
curl --noproxy '*' -fsS -X POST "${WEBHOOK_URL}" \
  -H "Authorization: Bearer ${WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d "${payload}"

printf '\nTriggered VPS deploy for %s\n' "${SHA}"
