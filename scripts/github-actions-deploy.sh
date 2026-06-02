#!/usr/bin/env bash
# Configure SSH for Ansible and run remote Divband deploy playbooks.
# Used by .github/actions/deploy-vps and runnable locally with the same env vars.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANSIBLE_DIR="${ROOT}/infra/ansible"

ARVAN_ENABLED="${DIVBAND_ARVAN_ENABLED:-true}"
VALIDATE_AFTER_DEPLOY="${DIVBAND_VALIDATE_AFTER_DEPLOY:-true}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    printf 'missing required environment variable: %s\n' "${name}" >&2
    exit 1
  fi
}

require_env DIVBAND_SSH_PRIVATE_KEY
require_env DIVBAND_VPS_HOST

VPS_USER="${DIVBAND_VPS_USER:-ubuntu}"
SSH_KEY="${HOME}/.ssh/divband_deploy"
INVENTORY="${ANSIBLE_DIR}/inventory.yml"

install -m 0700 -d "${HOME}/.ssh"
printf '%s\n' "${DIVBAND_SSH_PRIVATE_KEY}" > "${SSH_KEY}"
chmod 600 "${SSH_KEY}"
ssh-keyscan -H "${DIVBAND_VPS_HOST}" >> "${HOME}/.ssh/known_hosts" 2>/dev/null || true

cat > "${INVENTORY}" <<EOF
---
all:
  hosts:
    divband-vps:
      ansible_host: ${DIVBAND_VPS_HOST}
      ansible_user: ${VPS_USER}
      ansible_ssh_private_key_file: ${SSH_KEY}
EOF

export ANSIBLE_LOCAL_TEMP="${ANSIBLE_LOCAL_TEMP:-/tmp/ansible-local}"
export ANSIBLE_REMOTE_TEMP="${ANSIBLE_REMOTE_TEMP:-/tmp/ansible-remote}"

cd "${ANSIBLE_DIR}"
ansible-playbook -i inventory.yml playbooks/remote-docker.yml \
  -e "divband_arvan_enabled=${ARVAN_ENABLED}"

if [[ "${VALIDATE_AFTER_DEPLOY}" == "true" ]]; then
  ansible-playbook -i inventory.yml playbooks/validate-vps.yml \
    -e "divband_arvan_enabled=${ARVAN_ENABLED}"
fi
