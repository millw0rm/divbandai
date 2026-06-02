#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="/etc/sudoers.d/99-divband-ansible"
SOURCE="${ROOT}/infra/ansible/sudoers.d/99-divband-ansible"
TARGET_USER="${SUDO_USER:-${USER:-ubuntu}}"

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

if [[ ! -f "${SOURCE}" ]]; then
  printf 'missing sudoers template: %s\n' "${SOURCE}" >&2
  exit 1
fi

tmp="$(mktemp)"
sed "s/^ubuntu /${TARGET_USER} /" "${SOURCE}" > "${tmp}"
install -m 0440 "${tmp}" "${TARGET}"
rm -f "${tmp}"

if ! visudo -cf "${TARGET}"; then
  rm -f "${TARGET}"
  printf 'installed sudoers file failed validation; removed %s\n' "${TARGET}" >&2
  exit 1
fi

printf 'Installed %s for user %s\n' "${TARGET}" "${TARGET_USER}"
printf 'Verify with: sudo -n true\n'
