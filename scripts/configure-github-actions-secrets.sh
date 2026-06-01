#!/usr/bin/env bash
set -euo pipefail

repo="${GITHUB_REPOSITORY:-}"
password_file="${DIVBAND_KEYRING_PASSWORD_FILE:-.secrets/keyring-password}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it and run gh auth login first." >&2
  exit 2
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login -h github.com" >&2
  exit 2
fi

if [ -z "$repo" ]; then
  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
fi

if [ -z "$repo" ]; then
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  case "$origin_url" in
    git@github.com:*.git)
      repo="${origin_url#git@github.com:}"
      repo="${repo%.git}"
      ;;
    https://github.com/*.git)
      repo="${origin_url#https://github.com/}"
      repo="${repo%.git}"
      ;;
    https://github.com/*)
      repo="${origin_url#https://github.com/}"
      ;;
  esac
fi

if [ -z "$repo" ]; then
  echo "Could not infer GitHub repository. Set GITHUB_REPOSITORY=owner/repo." >&2
  exit 2
fi

if [ ! -f "$password_file" ]; then
  echo "Missing keyring password file: $password_file" >&2
  echo "Create it locally or set DIVBAND_KEYRING_PASSWORD_FILE to the correct path." >&2
  exit 2
fi

echo "Configuring GitHub Actions secrets and variables for $repo"
gh secret set DIVBAND_KEYRING_PASSWORD --repo "$repo" < "$password_file"

set_var() {
  local name="$1"
  local value="$2"

  if [ -n "$value" ]; then
    gh variable set "$name" --repo "$repo" --body "$value" >/dev/null
    echo "Set variable $name"
  fi
}

set_var DIVBAND_VPS_HOST "${DIVBAND_VPS_HOST:-185.204.170.33}"
set_var DIVBAND_VPS_USER "${DIVBAND_VPS_USER:-ubuntu}"
set_var DIVBAND_SOURCE_REPO_URL "${DIVBAND_SOURCE_REPO_URL:-https://github.com/millw0rm/divband.git}"

echo "GitHub Actions deployment settings are configured."
