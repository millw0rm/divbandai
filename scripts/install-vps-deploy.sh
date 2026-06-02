#!/usr/bin/env bash
# One-time setup for pull-based deploy on the production VPS (run ON the server).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="/etc/divband/deploy.env"
SERVICE_NAME="divband-deploy-webhook.service"
SYSTEMD_UNIT_SRC="${ROOT}/infra/systemd/divband-deploy-webhook.service"
SYSTEMD_UNIT_DST="/etc/systemd/system/${SERVICE_NAME}"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-ubuntu}}"

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

install -d -m 0750 -o root -g "${DEPLOY_USER}" /etc/divband
install -d -m 0755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/divband/.divband 2>/dev/null || true

if [[ ! -f "${ENV_FILE}" ]]; then
  secret="$(openssl rand -hex 32)"
  cat > "${ENV_FILE}" <<EOF
# Divband pull-deploy configuration
DIVBAND_APP_DIR=/opt/divband
DIVBAND_GHCR_OWNER=millw0rm
DIVBAND_GHCR_TOKEN=
DIVBAND_GIT_REMOTE=origin
DIVBAND_DEPLOY_WEBHOOK_SECRET=${secret}
DIVBAND_DEPLOY_WEBHOOK_HOST=0.0.0.0
DIVBAND_DEPLOY_WEBHOOK_PORT=9090
EOF
  chmod 640 "${ENV_FILE}"
  chown root:"${DEPLOY_USER}" "${ENV_FILE}"
  printf 'Created %s\n' "${ENV_FILE}"
  printf 'Webhook secret (add to GitHub as DIVBAND_DEPLOY_WEBHOOK_SECRET):\n%s\n' "${secret}"
else
  printf 'Keeping existing %s\n' "${ENV_FILE}"
fi

if ! python3 -c 'import yaml' 2>/dev/null; then
  apt-get update
  apt-get install -y python3-yaml
fi

install -m 0644 "${SYSTEMD_UNIT_SRC}" "${SYSTEMD_UNIT_DST}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

printf '\nDeploy webhook status:\n'
systemctl --no-pager status "${SERVICE_NAME}" || true

source "${ENV_FILE}"
port="${DIVBAND_DEPLOY_WEBHOOK_PORT:-9090}"
host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

Next steps:
  1. Clone/sync repo to /opt/divband and ensure git remote is configured.
  2. Set DIVBAND_GHCR_TOKEN in ${ENV_FILE} if GHCR packages are private.
  3. Open TCP ${port} in your cloud firewall (or proxy /deploy to this port).
  4. On GitHub (production environment secrets):
       DIVBAND_DEPLOY_WEBHOOK_URL=http://${host_ip}:${port}/deploy
       DIVBAND_DEPLOY_WEBHOOK_SECRET=<value from ${ENV_FILE}>
  5. Test: curl -fsS -X POST "http://${host_ip}:${port}/deploy" \\
       -H "Authorization: Bearer <secret>" \\
       -H "Content-Type: application/json" \\
       -d '{"sha":"$(git -C /opt/divband rev-parse HEAD 2>/dev/null || echo HEAD)"}'

Manual deploy: sudo -u ${DEPLOY_USER} bash /opt/divband/scripts/vps-deploy.sh <git-sha>
EOF
