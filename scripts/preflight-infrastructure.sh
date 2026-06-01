#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  [ANSIBLE_INVENTORY=<path>] [GITHUB_REPOSITORY=<owner/repo>] ./scripts/preflight-infrastructure.sh

Checks the local operator machine and configured VMs before starting Divband
infrastructure deployment.

Environment:
  ANSIBLE_INVENTORY                 Inventory path from repo root, or absolute path.
                                    Defaults to infra/ansible/inventory.yml.
  GITHUB_REPOSITORY                 GitHub repository owner/name. Inferred from gh
                                    or git origin when unset.
  EXPECTED_GITHUB_ACCOUNT           Required gh login. Defaults to millw0rm.
  DIVBAND_PREFLIGHT_SKIP_SSH        Set to 1 to skip live VM SSH checks.
  DIVBAND_PREFLIGHT_KNOWN_HOSTS     Known-hosts file for SSH probes. Defaults to
                                    /tmp/divband-preflight-known_hosts.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

ANSIBLE_INVENTORY="${ANSIBLE_INVENTORY:-infra/ansible/inventory.yml}"
EXPECTED_GITHUB_ACCOUNT="${EXPECTED_GITHUB_ACCOUNT:-millw0rm}"
SKIP_SSH="${DIVBAND_PREFLIGHT_SKIP_SSH:-0}"
KNOWN_HOSTS="${DIVBAND_PREFLIGHT_KNOWN_HOSTS:-/tmp/divband-preflight-known_hosts}"

if [[ "${ANSIBLE_INVENTORY}" = /* ]]; then
  INVENTORY_PATH="${ANSIBLE_INVENTORY}"
else
  INVENTORY_PATH="${REPO_ROOT}/${ANSIBLE_INVENTORY}"
fi

failures=0
warnings=0

pass() {
  printf 'ok: %s\n' "$1"
}

warn() {
  warnings=$((warnings + 1))
  printf 'warn: %s\n' "$1" >&2
}

fail() {
  failures=$((failures + 1))
  printf 'error: %s\n' "$1" >&2
}

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if command -v "${command_name}" >/dev/null 2>&1; then
    pass "${command_name} is installed"
  else
    fail "${command_name} is not installed. ${install_hint}"
  fi
}

find_ansible_inventory() {
  if command -v ansible-inventory >/dev/null 2>&1; then
    command -v ansible-inventory
    return 0
  fi

  if [[ -x "${REPO_ROOT}/.venv-ansible/bin/ansible-inventory" ]]; then
    printf '%s\n' "${REPO_ROOT}/.venv-ansible/bin/ansible-inventory"
    return 0
  fi

  return 1
}

infer_github_repository() {
  local repo="${GITHUB_REPOSITORY:-}"
  local origin_url=""

  if [[ -n "${repo}" ]]; then
    printf '%s\n' "${repo}"
    return 0
  fi

  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
  if [[ -n "${repo}" ]]; then
    printf '%s\n' "${repo}"
    return 0
  fi

  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  case "${origin_url}" in
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

  printf '%s\n' "${repo}"
}

expand_local_path() {
  local path="$1"

  if [[ "${path}" == "~" ]]; then
    printf '%s\n' "${HOME}"
  elif [[ "${path}" == "~/"* ]]; then
    printf '%s/%s\n' "${HOME}" "${path#\~/}"
  else
    printf '%s\n' "${path}"
  fi
}

print_section() {
  printf '\n== %s ==\n' "$1"
}

print_section "Local tools"
require_command git "Install Git before deploying infrastructure."
require_command gh "Install GitHub CLI, then run: gh auth login -h github.com"
require_command node "Install Node.js before running the inventory parser."
require_command ssh "Install OpenSSH client before checking VM access."
require_command ssh-keygen "Install OpenSSH tools before checking VM keys."

ANSIBLE_INVENTORY_BIN="$(find_ansible_inventory || true)"
if [[ -n "${ANSIBLE_INVENTORY_BIN}" ]]; then
  pass "ansible-inventory is available at ${ANSIBLE_INVENTORY_BIN}"
else
  fail "ansible-inventory is not installed. Install Ansible or create .venv-ansible with ansible-core."
fi

print_section "GitHub"
github_repo=""
if command -v gh >/dev/null 2>&1; then
  if gh auth status -h github.com >/dev/null 2>&1; then
    pass "gh has a stored github.com account"
    github_user="$(gh api user --jq .login 2>/dev/null || true)"
    if [[ -n "${github_user}" ]]; then
      if [[ "${github_user}" == "${EXPECTED_GITHUB_ACCOUNT}" ]]; then
        pass "gh is logged in as ${github_user}"
      else
        fail "gh is logged in as ${github_user}, expected ${EXPECTED_GITHUB_ACCOUNT}. Run: gh auth switch -h github.com -u ${EXPECTED_GITHUB_ACCOUNT}"
      fi
    else
      fail "could not verify the authenticated GitHub account with gh api user. Re-authenticate with: gh auth login -h github.com"
    fi
  else
    fail "gh is not authenticated for github.com. Run: gh auth login -h github.com"
  fi

  github_repo="$(infer_github_repository)"
  if [[ -n "${github_repo}" ]]; then
    if [[ "${github_repo}" == */* ]]; then
      pass "GitHub repository is ${github_repo}"
      if gh repo view "${github_repo}" --json nameWithOwner,url,defaultBranchRef >/dev/null 2>&1; then
        pass "GitHub repository ${github_repo} exists and is visible to gh"
      else
        fail "GitHub repository ${github_repo} is not visible to gh. Create it or authenticate with an account that has access."
      fi
    else
      fail "GitHub repository must use owner/name format, got: ${github_repo}"
    fi
  else
    fail "could not infer GitHub repository. Set GITHUB_REPOSITORY=owner/repo."
  fi

  if [[ -n "${github_repo}" ]]; then
    if gh workflow view deploy-vps.yml --repo "${github_repo}" >/dev/null 2>&1; then
      pass "deploy-vps.yml exists in GitHub Actions"
    else
      fail "deploy-vps.yml is not available in GitHub Actions for ${github_repo}"
    fi

    if gh secret list --repo "${github_repo}" --json name --jq '.[].name' 2>/dev/null | grep -Fxq DIVBAND_KEYRING_PASSWORD; then
      pass "GitHub Actions secret DIVBAND_KEYRING_PASSWORD is set"
    else
      fail "GitHub Actions secret DIVBAND_KEYRING_PASSWORD is missing. Run: scripts/configure-github-actions-secrets.sh"
    fi

    for variable_name in \
      DIVBAND_VPS_HOST \
      DIVBAND_VPS_USER \
      DIVBAND_SOURCE_REPO_URL
    do
      if gh variable list --repo "${github_repo}" --json name --jq '.[].name' 2>/dev/null | grep -Fxq "${variable_name}"; then
        pass "GitHub Actions variable ${variable_name} is set"
      else
        warn "GitHub Actions variable ${variable_name} is not set; deploy-vps.yml will use its built-in default"
      fi
    done
  fi
fi

origin_url="$(git remote get-url origin 2>/dev/null || true)"
if [[ -n "${origin_url}" ]]; then
  pass "git origin is ${origin_url}"
else
  fail "git origin is not configured"
fi

if [[ -f ".github/workflows/deploy-vps.yml" ]]; then
  pass ".github/workflows/deploy-vps.yml exists locally"
else
  fail ".github/workflows/deploy-vps.yml is missing locally"
fi

if [[ -f "infra/keys/encrypted/github-actions-divband-vps.key.enc" ]]; then
  pass "encrypted GitHub Actions VPS key exists"
else
  fail "missing infra/keys/encrypted/github-actions-divband-vps.key.enc"
fi

if [[ -f "infra/keys/public/github-actions-divband-vps.pub" ]]; then
  pass "public GitHub Actions VPS key exists"
else
  fail "missing infra/keys/public/github-actions-divband-vps.pub"
fi

print_section "Inventory"
if [[ -f "${INVENTORY_PATH}" ]]; then
  pass "Ansible inventory exists at ${INVENTORY_PATH}"
else
  fail "Ansible inventory does not exist: ${INVENTORY_PATH}"
fi

inventory_json=""
hosts_tsv=""
source_repo_from_inventory=""
if [[ -f "${INVENTORY_PATH}" && -n "${ANSIBLE_INVENTORY_BIN:-}" ]]; then
  inventory_json="$(mktemp /tmp/divband-inventory.XXXXXX.json)"
  ANSIBLE_LOCAL_TEMP="${ANSIBLE_LOCAL_TEMP:-/tmp/ansible-local}" \
  ANSIBLE_REMOTE_TEMP="${ANSIBLE_REMOTE_TEMP:-/tmp/.ansible/tmp}" \
    "${ANSIBLE_INVENTORY_BIN}" -i "${INVENTORY_PATH}" --list > "${inventory_json}"

  inventory_result="$(node - "${inventory_json}" <<'NODE'
const fs = require("fs");
const inventoryPath = process.argv[2];
const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const hostvars = (inventory._meta && inventory._meta.hostvars) || {};
const groupsToCheck = [
  "k8s_control_plane",
  "k8s_workers",
  "gitlab",
  "runners",
  "load_balancers",
  "monitoring",
];
const seen = new Set();
const hosts = [];
for (const groupName of groupsToCheck) {
  const group = inventory[groupName];
  for (const host of (group && group.hosts) || []) {
    const vars = hostvars[host] || {};
    const id = `${host}\0${vars.ansible_host || host}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hosts.push({
      host,
      groupName,
      address: vars.ansible_host || host,
      user: vars.ansible_user || "root",
      key: vars.ansible_ssh_private_key_file || "",
      sourceRepo: vars.divband_source_repo_url || "",
    });
  }
}

const controlPlaneHosts = (inventory.k8s_control_plane && inventory.k8s_control_plane.hosts) || [];
const lines = [];
lines.push(`SUMMARY\t${hosts.length}\t${controlPlaneHosts.length}`);
for (const host of hosts) {
  lines.push([
    "HOST",
    host.host,
    host.groupName,
    host.address,
    host.user,
    host.key,
    host.sourceRepo,
  ].join("\t"));
}
console.log(lines.join("\n"));
NODE
)"

  host_count="$(printf '%s\n' "${inventory_result}" | awk -F '\t' '$1 == "SUMMARY" { print $2 }')"
  control_plane_count="$(printf '%s\n' "${inventory_result}" | awk -F '\t' '$1 == "SUMMARY" { print $3 }')"
  hosts_tsv="$(printf '%s\n' "${inventory_result}" | awk -F '\t' '$1 == "HOST"')"
  source_repo_from_inventory="$(printf '%s\n' "${hosts_tsv}" | awk -F '\t' '$7 != "" { print $7; exit }')"

  if [[ "${host_count:-0}" -gt 0 ]]; then
    pass "inventory contains ${host_count} unique VM host entry/entries"
  else
    fail "inventory does not contain any VM hosts in the expected groups"
  fi

  if [[ "${control_plane_count:-0}" -gt 0 ]]; then
    pass "inventory contains ${control_plane_count} k8s_control_plane host(s)"
  else
    fail "inventory must contain at least one k8s_control_plane host"
  fi

  if [[ -n "${source_repo_from_inventory}" ]]; then
    pass "inventory source repository is ${source_repo_from_inventory}"
    if [[ -n "${github_repo}" && "${source_repo_from_inventory}" != "https://github.com/${github_repo}.git" && "${source_repo_from_inventory}" != "https://github.com/${github_repo}" ]]; then
      fail "inventory divband_source_repo_url (${source_repo_from_inventory}) does not match GitHub repo ${github_repo}"
    fi
  else
    warn "inventory does not define divband_source_repo_url"
  fi
fi

print_section "VM SSH"
if [[ "${SKIP_SSH}" == "1" ]]; then
  warn "live VM SSH checks were skipped because DIVBAND_PREFLIGHT_SKIP_SSH=1"
elif [[ -z "${hosts_tsv}" ]]; then
  fail "cannot run VM SSH checks because inventory host data is unavailable"
else
  while IFS=$'\t' read -r record_type host group_name address user key_path source_repo; do
    [[ "${record_type}" == "HOST" ]] || continue

    if [[ -z "${key_path}" ]]; then
      fail "${host} (${group_name}) has no ansible_ssh_private_key_file"
      continue
    fi

    expanded_key_path="$(expand_local_path "${key_path}")"
    if [[ ! -f "${expanded_key_path}" ]]; then
      fail "${host} (${address}) SSH private key does not exist: ${expanded_key_path}"
      continue
    fi

    if [[ -f "${expanded_key_path}.pub" ]]; then
      public_key="$(sed -n '1p' "${expanded_key_path}.pub")"
    else
      public_key="$(ssh-keygen -y -f "${expanded_key_path}" 2>/dev/null || true)"
    fi

    if [[ -z "${public_key}" ]]; then
      fail "could not derive public key for ${expanded_key_path}"
      continue
    fi

    if printf '%s\n' "${public_key}" | ssh \
      -i "${expanded_key_path}" \
      -o BatchMode=yes \
      -o ConnectTimeout=8 \
      -o StrictHostKeyChecking=accept-new \
      -o UserKnownHostsFile="${KNOWN_HOSTS}" \
      "${user}@${address}" \
      'candidate_key="$(cat)"; test -f ~/.ssh/authorized_keys && grep -Fqx "$candidate_key" ~/.ssh/authorized_keys' \
      >/dev/null 2>&1; then
      pass "${host} (${address}) accepts ${expanded_key_path} for ${user}, and the public key is in authorized_keys"
    else
      fail "${host} (${address}) does not accept ${expanded_key_path} for ${user}, or the public key is missing from authorized_keys"
    fi
  done <<< "${hosts_tsv}"
fi

printf '\n'
if [[ "${failures}" -gt 0 ]]; then
  printf 'Infrastructure preflight failed with %s error(s) and %s warning(s).\n' "${failures}" "${warnings}" >&2
  exit 1
fi

printf 'Infrastructure preflight passed with %s warning(s).\n' "${warnings}"
