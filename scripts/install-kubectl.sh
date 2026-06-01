#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
KUBECTL_VERSION="${KUBECTL_VERSION:-v1.30.14}"
INSTALL_DIR="${KUBECTL_INSTALL_DIR:-${REPO_ROOT}/.tools}"
TARGET="${INSTALL_DIR}/kubectl"

case "$(uname -s)" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="amd64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "${INSTALL_DIR}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

base_url="https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/${os}/${arch}"
curl_args=(--fail --show-error --silent --location --retry 5 --retry-delay 2 --retry-all-errors)

curl "${curl_args[@]}" "${base_url}/kubectl" -o "${tmp_dir}/kubectl"
curl "${curl_args[@]}" "${base_url}/kubectl.sha256" -o "${tmp_dir}/kubectl.sha256"
echo "$(cat "${tmp_dir}/kubectl.sha256")  ${tmp_dir}/kubectl" | sha256sum --check -

install -m 0755 "${tmp_dir}/kubectl" "${TARGET}"
"${TARGET}" version --client=true
printf 'Installed kubectl at %s\n' "${TARGET}"
