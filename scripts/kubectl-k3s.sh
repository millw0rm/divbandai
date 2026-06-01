#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
KUBECONFIG_PATH="${KUBECONFIG_PATH:-${REPO_ROOT}/infra/ansible/artifacts/kubeconfig}"
KUBECTL_REQUEST_TIMEOUT="${KUBECTL_REQUEST_TIMEOUT:-15s}"

if [[ ! -f "${KUBECONFIG_PATH}" ]]; then
  cat >&2 <<EOF
Kubeconfig artifact not found: ${KUBECONFIG_PATH}

Create it by running the k3s control-plane Ansible phase. The kubernetes role
fetches the endpoint kubeconfig to infra/ansible/artifacts/kubeconfig.
EOF
  exit 1
fi

if [[ -n "${KUBECTL_BIN:-}" ]]; then
  kubectl_bin="${KUBECTL_BIN}"
elif command -v kubectl >/dev/null 2>&1; then
  kubectl_bin="$(command -v kubectl)"
elif [[ -x "${REPO_ROOT}/.tools/kubectl" ]]; then
  kubectl_bin="${REPO_ROOT}/.tools/kubectl"
elif command -v docker >/dev/null 2>&1 && docker image inspect "${KUBECTL_DOCKER_IMAGE:-divband-backend:autoprovision-fix}" >/dev/null 2>&1; then
  docker_network_args=()
  if [[ -n "${KUBECTL_DOCKER_NETWORK:-}" ]]; then
    docker_network_args=(--network "${KUBECTL_DOCKER_NETWORK}")
  fi
  exec timeout "${KUBECTL_DOCKER_TIMEOUT:-45s}" docker run --rm \
    "${docker_network_args[@]}" \
    -v "${KUBECONFIG_PATH}:/kubeconfig:ro" \
    "${KUBECTL_DOCKER_IMAGE:-divband-backend:autoprovision-fix}" \
    kubectl --request-timeout="${KUBECTL_REQUEST_TIMEOUT}" --kubeconfig /kubeconfig "$@"
else
  cat >&2 <<'EOF'
kubectl is not installed on this machine.

Run `make kubectl-install`, or install kubectl and rerun this command. The
backend container includes kubectl for project auto-provisioning, but operator
access uses local/repo kubectl.

If you have already built the backend image locally, you can also set
KUBECTL_DOCKER_IMAGE=<image> and this wrapper will run kubectl from that image.
EOF
  exit 1
fi

exec "${kubectl_bin}" --request-timeout="${KUBECTL_REQUEST_TIMEOUT}" --kubeconfig "${KUBECONFIG_PATH}" "$@"
