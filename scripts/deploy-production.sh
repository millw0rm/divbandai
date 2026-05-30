#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  REGISTRY=<registry/project> [TAG=<tag>] [ANSIBLE_INVENTORY=<path>] [ANSIBLE_EXTRA_ARGS='<args>'] ./scripts/deploy-production.sh

Required:
  REGISTRY                         Base image registry/project, for example registry.gitlab.com/divband/control-plane.

Optional:
  TAG                              Image tag. Defaults to git rev-parse --short HEAD when available.
  ANSIBLE_INVENTORY                Inventory path from repo root, or an absolute path. Defaults to infra/ansible/inventory.yml.
  ANSIBLE_EXTRA_ARGS               Extra arguments appended to ansible-playbook.
  DIVBAND_BACKEND_IMAGE_REPOSITORY Backend image repository. Defaults to $REGISTRY/backend.
  DIVBAND_FRONTEND_IMAGE_REPOSITORY Frontend image repository. Defaults to $REGISTRY/frontend.

Example:
  REGISTRY=registry.gitlab.com/divband/control-plane TAG=v1.0.0 ./scripts/deploy-production.sh
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${REGISTRY:-}" ]]; then
  echo "error: REGISTRY is required." >&2
  usage >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

if [[ -z "${TAG:-}" ]]; then
  if git rev-parse --short HEAD >/dev/null 2>&1; then
    TAG="$(git rev-parse --short HEAD)"
  else
    echo "error: TAG is required when the current directory is not a Git repository." >&2
    exit 1
  fi
fi

ANSIBLE_INVENTORY="${ANSIBLE_INVENTORY:-infra/ansible/inventory.yml}"
if [[ "${ANSIBLE_INVENTORY}" = /* ]]; then
  INVENTORY_PATH="${ANSIBLE_INVENTORY}"
else
  INVENTORY_PATH="${REPO_ROOT}/${ANSIBLE_INVENTORY}"
fi

BACKEND_IMAGE_REPOSITORY="${DIVBAND_BACKEND_IMAGE_REPOSITORY:-${REGISTRY}/backend}"
FRONTEND_IMAGE_REPOSITORY="${DIVBAND_FRONTEND_IMAGE_REPOSITORY:-${REGISTRY}/frontend}"
BACKEND_IMAGE="${BACKEND_IMAGE_REPOSITORY}:${TAG}"
FRONTEND_IMAGE="${FRONTEND_IMAGE_REPOSITORY}:${TAG}"

if [[ ! -f "${INVENTORY_PATH}" ]]; then
  echo "error: Ansible inventory does not exist: ${INVENTORY_PATH}" >&2
  exit 1
fi

printf 'Backend image: %s\n' "${BACKEND_IMAGE}"
printf 'Frontend image: %s\n' "${FRONTEND_IMAGE}"

docker build -t "${BACKEND_IMAGE}" -f apps/backend/Dockerfile .
docker build -t "${FRONTEND_IMAGE}" -f apps/frontend/Dockerfile .

docker push "${BACKEND_IMAGE}"
docker push "${FRONTEND_IMAGE}"

ansible-galaxy collection install -r infra/ansible/requirements.yml

printf 'Running Ansible with backend image: %s\n' "${BACKEND_IMAGE}"
printf 'Running Ansible with frontend image: %s\n' "${FRONTEND_IMAGE}"

cd infra/ansible
# ANSIBLE_EXTRA_ARGS is intentionally word-split so operators can pass flags such as
# --limit k8s_control_plane or -e key=value through the environment.
# shellcheck disable=SC2086
DIVBAND_IMAGE_TAG="${TAG}" ansible-playbook \
  -i "${INVENTORY_PATH}" \
  playbooks/site.yml \
  --ask-vault-pass \
  -e "divband_backend_image_repository=${BACKEND_IMAGE_REPOSITORY}" \
  -e "divband_frontend_image_repository=${FRONTEND_IMAGE_REPOSITORY}" \
  ${ANSIBLE_EXTRA_ARGS:-}
