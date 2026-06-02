#!/usr/bin/env bash
# Install a GitHub Actions self-hosted runner on this VPS (run ON the server).
# After install, set repository variable DIVBAND_DEPLOY_RUNNER=self-hosted on GitHub.
set -euo pipefail

RUNNER_USER="${RUNNER_USER:-${SUDO_USER:-ubuntu}}"
RUNNER_DIR="${RUNNER_DIR:-/opt/actions-runner}"
REPO="${GITHUB_REPOSITORY:-millw0rm/divbandai}"
RUNNER_NAME="${RUNNER_NAME:-divband-vps}"

usage() {
  cat <<EOF
Install a GitHub Actions self-hosted runner for Divband deploys.

Usage (on the VPS):
  GITHUB_RUNNER_TOKEN=<token from GitHub UI> sudo -E bash $0

Get a registration token:
  gh api -X POST repos/${REPO}/actions/runners/registration-token --jq .token
  # or: GitHub → repo → Settings → Actions → Runners → New self-hosted runner

Then on GitHub set repository variable:
  DIVBAND_DEPLOY_RUNNER=self-hosted

Optional env:
  GITHUB_REPOSITORY   (default: ${REPO})
  RUNNER_USER         (default: ${RUNNER_USER})
  RUNNER_DIR          (default: ${RUNNER_DIR})
  RUNNER_NAME         (default: ${RUNNER_NAME})
EOF
}

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

if [[ -z "${GITHUB_RUNNER_TOKEN:-}" ]]; then
  usage >&2
  printf '\nerror: set GITHUB_RUNNER_TOKEN\n' >&2
  exit 1
fi

arch="$(uname -m)"
case "${arch}" in
  x86_64) runner_arch=x64 ;;
  aarch64|arm64) runner_arch=arm64 ;;
  *)
    printf 'error: unsupported architecture: %s\n' "${arch}" >&2
    exit 1
    ;;
esac

runner_version="${RUNNER_VERSION:-2.323.0}"
tarball="actions-runner-linux-${runner_arch}-${runner_version}.tar.gz"
url="https://github.com/actions/runner/releases/download/v${runner_version}/${tarball}"

install -d -o "${RUNNER_USER}" -g "${RUNNER_USER}" "${RUNNER_DIR}"
cd "${RUNNER_DIR}"

if [[ ! -f ./config.sh ]]; then
  curl -fsSL -o "${tarball}" "${url}"
  tar xzf "${tarball}"
  rm -f "${tarball}"
  chown -R "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_DIR}"
fi

sudo -u "${RUNNER_USER}" ./config.sh \
  --url "https://github.com/${REPO}" \
  --token "${GITHUB_RUNNER_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels self-hosted,Linux,X64,divband \
  --unattended \
  --replace

./svc.sh install "${RUNNER_USER}"
./svc.sh start

cat <<EOF
Runner installed. Verify in GitHub → Settings → Actions → Runners.

Set repository variable (on your laptop):
  gh variable set DIVBAND_DEPLOY_RUNNER -b self-hosted -R ${REPO}

Push to main again; deploy-production will run on this host without SSH.
EOF
