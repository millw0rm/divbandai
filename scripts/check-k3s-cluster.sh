#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
KUBECTL="${SCRIPT_DIR}/kubectl-k3s.sh"
PROJECT_SLUG="${1:-}"

printf 'Checking k3s operator access...\n'
"${KUBECTL}" get nodes -o wide

printf '\nChecking platform add-ons...\n'
"${KUBECTL}" get ingressclass nginx
"${KUBECTL}" -n ingress-nginx get deploy,svc
"${KUBECTL}" -n cert-manager get deploy,pods
"${KUBECTL}" -n divband-system get deploy,svc,ingress,secret/divband-kubeconfig

printf '\nChecking backend kubectl hand-off environment...\n'
"${KUBECTL}" -n divband-system get deploy/divband-backend \
  -o jsonpath='{range .spec.template.spec.containers[?(@.name=="backend")].env[*]}{.name}{"="}{.value}{"\n"}{end}' \
  | grep -E '^(KUBERNETES_APPLY|KUBERNETES_MODE|KUBERNETES_CONFIG_MODE|KUBECONFIG|DIVBAND_AUTO_PROVISION_PROJECTS)='

if [[ -n "${PROJECT_SLUG}" ]]; then
  namespace="project-${PROJECT_SLUG}"
  printf '\nChecking project namespace %s...\n' "${namespace}"
  "${KUBECTL}" get namespace "${namespace}"
  "${KUBECTL}" -n "${namespace}" get deploy,svc,ingress,pods
fi

printf '\nk3s checks completed.\n'
