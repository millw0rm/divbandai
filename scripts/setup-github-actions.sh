#!/usr/bin/env bash
# Configure GitHub Actions CI/CD for Divband using the gh CLI.
#
# Usage:
#   scripts/setup-github-actions.sh              # interactive
#   scripts/setup-github-actions.sh -y --env-file .github/setup.env
#   scripts/setup-github-actions.sh --generate-key --copy-ssh-id
#
# Requires: gh (authenticated), git remote pointing at GitHub, repo admin rights.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${DIVBAND_GH_ENVIRONMENT:-production}"
KEY_BASENAME="${DIVBAND_DEPLOY_KEY_BASENAME:-divband_github_actions}"
KEY_DIR="${DIVBAND_DEPLOY_KEY_DIR:-${HOME}/.ssh}"
PRIVATE_KEY="${KEY_DIR}/${KEY_BASENAME}"
PUBLIC_KEY="${PRIVATE_KEY}.pub"

REPO=""
ASSUME_YES=false
GENERATE_KEY=false
COPY_SSH_ID=false
REQUIRE_CI=false
DRY_RUN=false
ENV_FILE=""
GHCR_TOKEN=""
ARVAN_ENABLED="true"
VPS_HOST=""
VPS_USER="ubuntu"
KEY_FILE=""

usage() {
  cat <<'EOF'
Configure GitHub Actions CI/CD for Divband using the gh CLI.

Usage:
  scripts/setup-github-actions.sh
  scripts/setup-github-actions.sh -y --env-file .github/setup.env --generate-key
  scripts/setup-github-actions.sh --generate-key --copy-ssh-id --run-deploy

Requires: gh (authenticated), git remote to GitHub, repository admin rights.
EOF
  printf '\nOptions:\n'
  printf '  -y, --yes              Non-interactive (needs host + key file or --generate-key)\n'
  printf '  --env-file FILE        Load DIVBAND_* variables from a dotenv file\n'
  printf '  --repo OWNER/REPO      Override repository (default: current git remote)\n'
  printf '  --host HOST            VPS IP or hostname (DIVBAND_VPS_HOST)\n'
  printf '  --user USER            SSH user (default: ubuntu)\n'
  printf '  --key-file PATH        Private key to store in GitHub (default: %s)\n' "${PRIVATE_KEY}"
  printf '  --generate-key         Create a new ed25519 deploy key pair\n'
  printf '  --arvan true|false     Set DIVBAND_ARVAN_ENABLED repository variable\n'
  printf '  --copy-ssh-id          Run ssh-copy-id with the deploy public key\n'
  printf '  --require-ci           Enable branch protection requiring CI jobs (after first green run)\n'
  printf '  --run-deploy           Trigger the manual Deploy workflow when finished\n'
  printf '  --ghcr-token TOKEN     Also store DIVBAND_GHCR_TOKEN for VPS GHCR pulls\n'
  printf '  --dry-run              Print actions without calling GitHub\n'
  printf '  -h, --help             Show this help\n'
}

log() {
  printf '==> %s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

expand_path() {
  local path="$1"
  case "${path}" in
    "~") printf '%s\n' "${HOME}" ;;
    "~/"*) printf '%s\n' "${HOME}/${path#~/}" ;;
    *) printf '%s\n' "${path}" ;;
  esac
}

run() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    printf '[dry-run] %s\n' "$(printf '%q ' "$@")"
    return 0
  fi
  "$@"
}

load_env_file() {
  local file="$1"
  [[ -f "${file}" ]] || die "env file not found: ${file}"
  set -a
  # shellcheck disable=SC1090
  source "${file}"
  set +a
}

detect_repo() {
  if [[ -n "${REPO}" ]]; then
    return 0
  fi
  if [[ -n "${GH_REPO:-}" ]]; then
    REPO="${GH_REPO}"
    return 0
  fi
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" \
    || die "could not detect GitHub repo; use --repo OWNER/REPO or run inside a linked git clone"
}

require_gh() {
  command -v gh >/dev/null 2>&1 || die "gh is not installed (https://cli.github.com/)"
  if [[ "${DRY_RUN}" == "true" ]]; then
    return 0
  fi
  gh auth status >/dev/null 2>&1 || die "gh is not authenticated; run: gh auth login"
}

prompt_default() {
  local prompt="$1"
  local default="$2"
  local reply=""
  if [[ "${ASSUME_YES}" == "true" ]]; then
    printf '%s\n' "${default}"
    return 0
  fi
  read -r -p "${prompt} [${default}]: " reply
  if [[ -z "${reply}" ]]; then
    printf '%s\n' "${default}"
  else
    printf '%s\n' "${reply}"
  fi
}

confirm() {
  local message="$1"
  if [[ "${ASSUME_YES}" == "true" ]]; then
    return 0
  fi
  local reply=""
  read -r -p "${message} [y/N]: " reply
  [[ "${reply}" =~ ^[Yy]$ ]]
}

gh_repo_args() {
  GH_REPO_ARGS=(-R "${REPO}")
}

create_environment() {
  log "Ensuring GitHub environment '${ENV_NAME}' exists"
  # -F sends wait_timer as integer; -f would send "0" as string and GitHub returns HTTP 422.
  run gh api "repos/${REPO}/environments/${ENV_NAME}" \
    -X PUT \
    -F wait_timer=0 >/dev/null
}

set_secret_from_file() {
  local name="$1"
  local file="$2"
  [[ -f "${file}" ]] || die "secret file not found: ${file}"
  log "Setting environment secret ${name}"
  if [[ "${DRY_RUN}" == "true" ]]; then
    printf '[dry-run] gh secret set %s --env %s < %s\n' "${name}" "${ENV_NAME}" "${file}"
    return 0
  fi
  gh_repo_args
  gh secret set "${name}" --env "${ENV_NAME}" "${GH_REPO_ARGS[@]}" < "${file}"
}

set_secret_from_value() {
  local name="$1"
  local value="$2"
  log "Setting environment secret ${name}"
  if [[ "${DRY_RUN}" == "true" ]]; then
    printf '[dry-run] gh secret set %s --env %s (value hidden)\n' "${name}" "${ENV_NAME}"
    return 0
  fi
  gh_repo_args
  printf '%s' "${value}" | gh secret set "${name}" --env "${ENV_NAME}" "${GH_REPO_ARGS[@]}"
}

set_repo_variable() {
  local name="$1"
  local value="$2"
  log "Setting repository variable ${name}=${value}"
  gh_repo_args
  run gh variable set "${name}" "${GH_REPO_ARGS[@]}" --body "${value}"
}

generate_deploy_key() {
  [[ -f "${PRIVATE_KEY}" && "${GENERATE_KEY}" != "true" ]] && return 0
  if [[ -f "${PRIVATE_KEY}" && "${GENERATE_KEY}" == "true" ]]; then
    confirm "Overwrite existing key ${PRIVATE_KEY}?" || die "aborted"
  fi
  log "Generating deploy key ${PRIVATE_KEY}"
  mkdir -p "${KEY_DIR}"
  run ssh-keygen -t ed25519 -f "${PRIVATE_KEY}" -N "" -C "divband-github-actions-deploy"
  chmod 600 "${PRIVATE_KEY}"
  chmod 644 "${PUBLIC_KEY}"
}

resolve_vps_host() {
  if [[ -n "${VPS_HOST}" ]]; then
    return 0
  fi
  if [[ -f "${ROOT}/infra/ansible/inventory.yml" ]]; then
    VPS_HOST="$(grep -E '^\s+ansible_host:' "${ROOT}/infra/ansible/inventory.yml" | head -1 | awk '{print $2}')" || true
  fi
  if [[ -z "${VPS_HOST}" && -f "${ROOT}/infra/ansible/inventory.example.yml" ]]; then
    VPS_HOST="$(grep -E '^\s+ansible_host:' "${ROOT}/infra/ansible/inventory.example.yml" | head -1 | awk '{print $2}')" || true
  fi
  if [[ "${ASSUME_YES}" == "true" ]]; then
    [[ -n "${VPS_HOST}" ]] || die "set DIVBAND_VPS_HOST or pass --host"
    return 0
  fi
  VPS_HOST="$(prompt_default "VPS host (DIVBAND_VPS_HOST)" "${VPS_HOST:-}")"
  [[ -n "${VPS_HOST}" ]] || die "VPS host is required"
}

resolve_key_file() {
  if [[ -n "${KEY_FILE}" ]]; then
    PRIVATE_KEY="$(expand_path "${KEY_FILE}")"
    PUBLIC_KEY="${PRIVATE_KEY}.pub"
    [[ -f "${PRIVATE_KEY}" ]] || die "private key not found: ${PRIVATE_KEY}"
    return 0
  fi
  if [[ -n "${DIVBAND_SSH_PRIVATE_KEY_FILE:-}" ]]; then
    PRIVATE_KEY="$(expand_path "${DIVBAND_SSH_PRIVATE_KEY_FILE}")"
    PUBLIC_KEY="${PRIVATE_KEY}.pub"
    if [[ -f "${PRIVATE_KEY}" ]]; then
      return 0
    fi
    if [[ "${ASSUME_YES}" == "true" || "${GENERATE_KEY}" == "true" ]]; then
      GENERATE_KEY=true
      generate_deploy_key
      return 0
    fi
    die "private key not found: ${PRIVATE_KEY} (use --generate-key or fix DIVBAND_SSH_PRIVATE_KEY_FILE)"
  fi

  if [[ "${GENERATE_KEY}" == "true" ]]; then
    generate_deploy_key
    return 0
  fi

  if [[ -f "${PRIVATE_KEY}" ]]; then
    return 0
  fi

  if [[ "${ASSUME_YES}" == "true" ]]; then
    GENERATE_KEY=true
    generate_deploy_key
    return 0
  fi

  log "No deploy key at ${PRIVATE_KEY}"
  if confirm "Generate a new ed25519 deploy key at ${PRIVATE_KEY}?"; then
    GENERATE_KEY=true
    generate_deploy_key
    return 0
  fi

  while true; do
    KEY_FILE="$(prompt_default "Path to existing private key" "${PRIVATE_KEY}")"
    PRIVATE_KEY="$(expand_path "${KEY_FILE}")"
    PUBLIC_KEY="${PRIVATE_KEY}.pub"
    if [[ -f "${PRIVATE_KEY}" ]]; then
      return 0
    fi
    printf 'error: private key not found: %s\n' "${PRIVATE_KEY}" >&2
    if confirm "Generate a new deploy key at ${KEY_DIR}/${KEY_BASENAME}?"; then
      PRIVATE_KEY="${KEY_DIR}/${KEY_BASENAME}"
      PUBLIC_KEY="${PRIVATE_KEY}.pub"
      GENERATE_KEY=true
      generate_deploy_key
      return 0
    fi
  done
}

copy_ssh_id() {
  [[ -f "${PUBLIC_KEY}" ]] || die "public key not found: ${PUBLIC_KEY}"
  log "Installing public key on ${VPS_USER}@${VPS_HOST}"
  run ssh-copy-id -i "${PUBLIC_KEY}" "${VPS_USER}@${VPS_HOST}"
}

configure_branch_protection() {
  log "Configuring branch protection on main (requires admin + existing CI checks)"
  local payload
  payload="$(cat <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "Python unit tests", "app_id": null},
      {"context": "Docker stack and routing smoke", "app_id": null}
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
)"
  if [[ "${DRY_RUN}" == "true" ]]; then
    printf '[dry-run] gh api PUT repos/%s/branches/main/protection\n' "${REPO}"
    return 0
  fi
  if ! printf '%s' "${payload}" | gh api "$(printf 'repos/%s/branches/main/protection' "${REPO}")" -X PUT --input - >/dev/null 2>&1; then
    printf 'warning: could not set branch protection yet.\n' >&2
    printf '         Run CI once on main, then re-run with --require-ci or configure in GitHub Settings.\n' >&2
  fi
}

print_vps_next_steps() {
  cat <<EOF

VPS steps (run on the server or over SSH):

  # 1) Passwordless sudo for Ansible (replace user if needed)
  export DEPLOY_USER=${VPS_USER}
  sudo install -d -m 0755 /etc/sudoers.d
  sudo sed "s/^ubuntu /\${DEPLOY_USER} /" /opt/divband/infra/ansible/sudoers.d/99-divband-ansible \\
    | sudo tee /etc/sudoers.d/99-divband-ansible
  sudo chmod 440 /etc/sudoers.d/99-divband-ansible
  sudo visudo -cf /etc/sudoers.d/99-divband-ansible

  # 2) If you skipped --copy-ssh-id, authorize this public key:
  $(cat "${PUBLIC_KEY}" 2>/dev/null || echo "(public key at ${PUBLIC_KEY})")

Verify GitHub configuration:

  gh secret list --env ${ENV_NAME} -R ${REPO}
  gh variable list -R ${REPO}
  gh workflow list -R ${REPO}

Trigger deploy manually:

  gh workflow run deploy.yml -R ${REPO} -f arvan_enabled=${ARVAN_ENABLED} -f validate_after_deploy=true

Watch CI after pushing workflows:

  gh run list -R ${REPO} --workflow ci.yml --limit 5

EOF
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -y|--yes) ASSUME_YES=true; shift ;;
      --env-file) ENV_FILE="$2"; shift 2 ;;
      --repo) REPO="$2"; shift 2 ;;
      --host) VPS_HOST="$2"; shift 2 ;;
      --user) VPS_USER="$2"; shift 2 ;;
      --key-file) KEY_FILE="$2"; shift 2 ;;
      --generate-key) GENERATE_KEY=true; shift ;;
      --arvan) ARVAN_ENABLED="$2"; shift 2 ;;
      --copy-ssh-id) COPY_SSH_ID=true; shift ;;
      --require-ci) REQUIRE_CI=true; shift ;;
      --run-deploy) RUN_DEPLOY=true; shift ;;
      --ghcr-token) GHCR_TOKEN="$2"; shift 2 ;;
      --dry-run) DRY_RUN=true; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option: $1 (use --help)" ;;
    esac
  done

  RUN_DEPLOY=false
  COPY_SSH_ID="${COPY_SSH_ID:-false}"

  cd "${ROOT}"
  [[ -n "${ENV_FILE}" ]] && load_env_file "${ENV_FILE}"

  VPS_HOST="${VPS_HOST:-${DIVBAND_VPS_HOST:-}}"
  VPS_USER="${VPS_USER:-${DIVBAND_VPS_USER:-ubuntu}}"
  ARVAN_ENABLED="${ARVAN_ENABLED:-${DIVBAND_ARVAN_ENABLED:-true}}"
  if [[ "${DIVBAND_COPY_SSH_ID:-}" == "1" ]]; then
    COPY_SSH_ID=true
  fi
  GHCR_TOKEN="${GHCR_TOKEN:-${DIVBAND_GHCR_TOKEN:-}}"

  require_gh
  detect_repo

  log "Repository: ${REPO}"
  log "Environment: ${ENV_NAME}"

  if [[ "${ASSUME_YES}" != "true" ]]; then
    confirm "Configure GitHub Actions secrets and variables for ${REPO}?" || die "aborted"
  fi

  resolve_vps_host
  resolve_key_file

  if [[ "${ASSUME_YES}" != "true" ]]; then
    VPS_USER="$(prompt_default "SSH user (DIVBAND_VPS_USER)" "${VPS_USER}")"
    ARVAN_ENABLED="$(prompt_default "Arvan mirror on deploy (true/false)" "${ARVAN_ENABLED}")"
  fi

  create_environment
  set_secret_from_file DIVBAND_SSH_PRIVATE_KEY "${PRIVATE_KEY}"
  set_secret_from_value DIVBAND_VPS_HOST "${VPS_HOST}"
  set_secret_from_value DIVBAND_VPS_USER "${VPS_USER}"
  set_repo_variable DIVBAND_ARVAN_ENABLED "${ARVAN_ENABLED}"

  if [[ -n "${GHCR_TOKEN}" ]]; then
    set_secret_from_value DIVBAND_GHCR_TOKEN "${GHCR_TOKEN}"
  elif [[ "${ASSUME_YES}" != "true" ]] && confirm "Set DIVBAND_GHCR_TOKEN for private GHCR pulls on the VPS?"; then
    read -r -s -p "PAT (read:packages): " GHCR_TOKEN
    printf '\n'
    [[ -n "${GHCR_TOKEN}" ]] && set_secret_from_value DIVBAND_GHCR_TOKEN "${GHCR_TOKEN}"
  fi

  if [[ "${COPY_SSH_ID}" == "true" ]]; then
    copy_ssh_id
  elif [[ "${ASSUME_YES}" != "true" ]] && confirm "Run ssh-copy-id to install the deploy public key on the VPS?"; then
    copy_ssh_id
  fi

  if [[ "${REQUIRE_CI}" == "true" ]]; then
    configure_branch_protection
  fi

  if [[ "${RUN_DEPLOY}" == "true" ]]; then
    log "Triggering deploy workflow"
    arvan_input="${ARVAN_ENABLED}"
    [[ "${arvan_input}" == "true" || "${arvan_input}" == "1" ]] && arvan_input=true || arvan_input=false
    gh_repo_args
    run gh workflow run deploy.yml "${GH_REPO_ARGS[@]}" \
      -f "arvan_enabled=${arvan_input}" \
      -f "validate_after_deploy=true"
  fi

  log "GitHub Actions setup complete"
  print_vps_next_steps
}

main "$@"
