#!/usr/bin/env bash
# Legacy Ansible push deploy (SSH or self-hosted runner).
# Standard production deploy: scripts/vps-deploy.sh + deploy webhook (see docs/ci-cd.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANSIBLE_DIR="${ROOT}/infra/ansible"

DEPLOY_MODE="${DIVBAND_DEPLOY_MODE:-ssh}"
ARVAN_ENABLED="${DIVBAND_ARVAN_ENABLED:-true}"
VALIDATE_AFTER_DEPLOY="${DIVBAND_VALIDATE_AFTER_DEPLOY:-true}"
USE_GHCR="${DIVBAND_USE_GHCR:-false}"
GHCR_OWNER="${DIVBAND_GHCR_OWNER:-millw0rm}"
GHCR_IMAGE_TAG="${DIVBAND_GHCR_IMAGE_TAG:-main}"
GHCR_TOKEN="${DIVBAND_GHCR_TOKEN:-}"

INVENTORY="${ANSIBLE_DIR}/inventory.yml"
cleanup_token_file=""

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    printf 'error: missing required environment variable: %s\n' "${name}" >&2
    exit 1
  fi
}

write_local_inventory() {
  cat > "${INVENTORY}" <<'EOF'
---
all:
  hosts:
    divband-vps:
      ansible_host: 127.0.0.1
      ansible_connection: local
EOF
}

write_ssh_inventory() {
  local vps_user="$1"
  local vps_host="$2"
  local ssh_key="$3"
  cat > "${INVENTORY}" <<EOF
---
all:
  hosts:
    divband-vps:
      ansible_host: ${vps_host}
      ansible_user: ${vps_user}
      ansible_ssh_private_key_file: ${ssh_key}
EOF
}

preflight_ssh() {
  local vps_user="$1"
  local vps_host="$2"
  local ssh_key="$3"
  local port="${DIVBAND_SSH_PORT:-22}"
  local opts=(-o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -i "${ssh_key}")

  if ! ssh "${opts[@]}" -p "${port}" "${vps_user}@${vps_host}" true 2>/tmp/divband-ssh-preflight.err; then
    cat >&2 <<EOF
error: cannot SSH from this machine to ${vps_user}@${vps_host}:${port}

GitHub-hosted runners often cannot reach VPS hosts that only allow SSH from your home
network or a allowlisted IP. Connection timed out usually means a firewall or cloud
security group is blocking port ${port} from the internet (including GitHub Actions).

Fix options:
  1) Install a self-hosted Actions runner ON the VPS and set repository variable
     DIVBAND_DEPLOY_RUNNER=self-hosted (see docs/ci-cd.md).
  2) Allow inbound TCP ${port} from GitHub Actions IP ranges (see https://api.github.com/meta).
  3) Set repository variable DIVBAND_DEPLOY_RUNNER=disabled to skip auto-deploy until fixed.

ssh diagnostic:
EOF
    sed 's/^/  /' /tmp/divband-ssh-preflight.err >&2 || true
    exit 1
  fi
}

configure_ssh() {
  require_env DIVBAND_SSH_PRIVATE_KEY
  require_env DIVBAND_VPS_HOST

  local vps_user="${DIVBAND_VPS_USER:-ubuntu}"
  local ssh_key="${HOME}/.ssh/divband_deploy"

  install -m 0700 -d "${HOME}/.ssh"
  printf '%s\n' "${DIVBAND_SSH_PRIVATE_KEY}" > "${ssh_key}"
  chmod 600 "${ssh_key}"
  ssh-keyscan -H "${DIVBAND_VPS_HOST}" >> "${HOME}/.ssh/known_hosts" 2>/dev/null || true
  write_ssh_inventory "${vps_user}" "${DIVBAND_VPS_HOST}" "${ssh_key}"
  preflight_ssh "${vps_user}" "${DIVBAND_VPS_HOST}" "${ssh_key}"
}

build_ansible_extra() {
  ANSIBLE_EXTRA=(-e "divband_arvan_enabled=${ARVAN_ENABLED}")
  if [[ "${USE_GHCR}" == "true" ]]; then
    ANSIBLE_EXTRA+=(
      -e "divband_use_ghcr=true"
      -e "divband_ghcr_owner=${GHCR_OWNER}"
      -e "divband_ghcr_image_tag=${GHCR_IMAGE_TAG}"
    )
    if [[ -n "${GHCR_TOKEN}" ]]; then
      local token_file
      token_file="$(mktemp)"
      chmod 600 "${token_file}"
      printf 'divband_ghcr_token: %s\n' "${GHCR_TOKEN}" > "${token_file}"
      ANSIBLE_EXTRA+=(-e "@${token_file}")
      cleanup_token_file="${token_file}"
    fi
  fi
}

cleanup() {
  [[ -n "${cleanup_token_file}" && -f "${cleanup_token_file}" ]] && rm -f "${cleanup_token_file}"
}
trap cleanup EXIT

case "${DEPLOY_MODE}" in
  local)
    write_local_inventory
    ;;
  ssh)
    configure_ssh
    ;;
  *)
    printf 'error: unknown DIVBAND_DEPLOY_MODE=%s (use ssh or local)\n' "${DEPLOY_MODE}" >&2
    exit 1
    ;;
esac

export ANSIBLE_LOCAL_TEMP="${ANSIBLE_LOCAL_TEMP:-/tmp/ansible-local}"
export ANSIBLE_REMOTE_TEMP="${ANSIBLE_REMOTE_TEMP:-/tmp/ansible-remote}"

build_ansible_extra

cd "${ANSIBLE_DIR}"
ansible-playbook -i inventory.yml playbooks/remote-docker.yml "${ANSIBLE_EXTRA[@]}"

if [[ "${VALIDATE_AFTER_DEPLOY}" == "true" ]]; then
  ansible-playbook -i inventory.yml playbooks/validate-vps.yml "${ANSIBLE_EXTRA[@]}"
fi
