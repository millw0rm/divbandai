#!/usr/bin/env bash
# Pull-based production deploy: sync git, render configs, pull GHCR images, restart stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DIVBAND_DEPLOY_ENV:-/etc/divband/deploy.env}"
LOCK_FILE="${DIVBAND_DEPLOY_LOCK:-}"

usage() {
  cat <<'EOF'
Usage: scripts/vps-deploy.sh <git-sha> [ref]

Pull deploy on the production host (run ON the VPS):
  1. git fetch + checkout the commit
  2. render HAProxy/Compose for GHCR image tags
  3. docker login ghcr.io (if token configured)
  4. docker compose pull && up -d
  5. smoke-test routing

Environment file (default /etc/divband/deploy.env):
  DIVBAND_APP_DIR, DIVBAND_GHCR_OWNER, DIVBAND_GHCR_TOKEN,
  DIVBAND_GIT_REMOTE
EOF
}

log() {
  printf '[vps-deploy] %s\n' "$*"
}

die() {
  printf '[vps-deploy] error: %s\n' "$*" >&2
  exit 1
}

docker_cmd() {
  if [[ -n "${DIVBAND_DOCKER_CMD:-}" ]]; then
    printf '%s\n' "${DIVBAND_DOCKER_CMD}"
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    printf 'docker\n'
    return 0
  fi
  if [[ -x /usr/bin/docker ]]; then
    printf '/usr/bin/docker\n'
    return 0
  fi
  if [[ "${DIVBAND_DOCKER_SUDO:-false}" == "true" ]] && command -v sudo >/dev/null 2>&1; then
    printf 'sudo docker\n'
    return 0
  fi
  return 1
}

require_docker() {
  local cmd
  cmd="$(docker_cmd)" || die "docker not found; install Docker on this host (see docs/ci-cd.md) or set DIVBAND_DOCKER_CMD in ${ENV_FILE}"
  DOCKER="${cmd}"
  log "using ${DOCKER}"
}

run_smoke() {
  if [[ -f "${APP_DIR}/scripts/smoke-projects.sh" ]]; then
    (cd "${APP_DIR}" && bash scripts/smoke-projects.sh)
  else
    log "smoke script missing; skipping"
  fi
}

main() {
  local sha="${1:-}"
  if [[ -z "${sha}" || "${sha}" == "-h" || "${sha}" == "--help" ]]; then
    usage
    [[ -z "${sha}" ]] && exit 2
    exit 0
  fi

  [[ -f "${ENV_FILE}" ]] || die "missing ${ENV_FILE}; run scripts/install-vps-deploy.sh"
  # shellcheck disable=SC1090
  source "${ENV_FILE}"

  APP_DIR="${DIVBAND_APP_DIR:-/opt/divband}"
  GHCR_OWNER="${DIVBAND_GHCR_OWNER:-millw0rm}"
  GIT_REMOTE="${DIVBAND_GIT_REMOTE:-origin}"

  [[ -d "${APP_DIR}/.git" ]] || die "not a git repo: ${APP_DIR}"

  LOCK_FILE="${LOCK_FILE:-${APP_DIR}/.divband/deploy.lock}"
  mkdir -p "${APP_DIR}/.divband"
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    die "another deploy is running (lock ${LOCK_FILE})"
  fi

  log "deploying ${sha} in ${APP_DIR}"
  cd "${APP_DIR}"

  git remote get-url "${GIT_REMOTE}" >/dev/null 2>&1 || die "git remote ${GIT_REMOTE} not found"
  git fetch --prune "${GIT_REMOTE}"
  git checkout --force "${sha}"

  export PYTHONPATH="${APP_DIR}/scripts:${PYTHONPATH:-}"
  DIVBAND_GHCR_OWNER="${GHCR_OWNER}" DIVBAND_GHCR_TAG="${sha}" \
    python3 -c "
import os
from divband_projects import load_projects, regenerate_stack
regenerate_stack(
    load_projects(),
    ghcr=True,
    ghcr_owner=os.environ['DIVBAND_GHCR_OWNER'],
    ghcr_tag=os.environ['DIVBAND_GHCR_TAG'],
)
"

  require_docker

  if [[ -n "${DIVBAND_GHCR_TOKEN:-}" ]]; then
    printf '%s' "${DIVBAND_GHCR_TOKEN}" | ${DOCKER} login ghcr.io -u "${GHCR_OWNER}" --password-stdin
  fi

  ${DOCKER} compose pull
  ${DOCKER} compose up -d

  log "waiting for HAProxy"
  for _ in $(seq 1 30); do
    if curl --noproxy '*' -fsS -o /dev/null -H 'Host: divbandai.ir' http://127.0.0.1/; then
      break
    fi
    sleep 2
  done

  run_smoke
  log "deploy complete for ${sha}"
}

main "$@"
