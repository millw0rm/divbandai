# Manual SSH Deployment

Use this runbook to deploy the current Docker stack to one VM by SSH. Keep notes
on every change made to the VM; these steps are the source material for a future
Ansible role.

## Assumptions

- The VM runs Ubuntu 22.04 or newer.
- You can SSH as a sudo-capable user.
- DNS for `divbandai.ir` and `test.divbandai.ir` points to the VM public IP.
- Ports `22` and `80` are allowed by the cloud firewall and the VM firewall.
- Docker Engine with the Compose v2 plugin is installed or can be installed.
- If the VM cannot reach global Ubuntu/Docker endpoints, use the Arvan mirror
  and registry setup below.

## Variables

Replace these before running commands:

```bash
VM_HOST=<vm-public-ip-or-hostname>
VM_USER=<ssh-user>
APP_DIR=/opt/divband
```

## 1. Connect to the VM

```bash
ssh "${VM_USER}@${VM_HOST}"
```

Record:

- VM public IP.
- VM private IP, if available.
- OS version: `lsb_release -a`.
- Docker version: `docker --version`.
- Compose version: `docker compose version`.

## 2. Install Docker if Missing

### Option A: Ubuntu and Docker upstream repositories

Use this when the VM has normal outbound DNS and internet access. On the VM:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

### Option B: Ubuntu packages (matches Ansible)

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
```

Optional non-root Docker access:

```bash
sudo usermod -aG docker "$USER"
```

Log out and back in before relying on group membership.

## 3. Prepare the Application Directory

On the VM:

```bash
sudo mkdir -p /opt/divband
sudo chown "$USER:$USER" /opt/divband
```

## 4. Upload the Repository

From your local machine:

```bash
rsync -av --delete \
  --exclude .git \
  --exclude node_modules \
  ./ "${VM_USER}@${VM_HOST}:${APP_DIR}/"
```

If the repository is already cloned on the VM, update it instead:

```bash
cd /opt/divband
git fetch --all
git switch docker-haproxy-test-entrypoint
git pull --ff-only
```

## 5. Start the Stack

On the VM:

```bash
cd /opt/divband
docker compose pull
docker compose up -d
docker compose ps
```

Expected containers:

- `divband-haproxy`
- `divband-test-web`

## 6. Verify Locally on the VM

On the VM:

```bash
curl -i -H "Host: divbandai.ir" http://127.0.0.1/
curl -i -H "Host: test.divbandai.ir" http://127.0.0.1/
curl -i -H "Host: unknown.divband.com" http://127.0.0.1/
```

Expected results:

- `divbandai.ir` and `test.divbandai.ir` return HTTP 200 and `Welcome to test`.
- Unknown hosts return HTTP 404 and `Unknown divband host`.

Check container logs if routing fails:

```bash
docker compose logs haproxy
docker compose logs test-web
```

## 7. Verify from Outside

From your local machine:

```bash
curl -i http://divbandai.ir/
curl -i http://test.divbandai.ir/
```

If DNS is not ready yet:

```bash
curl -i --resolve divbandai.ir:80:${VM_HOST} http://divbandai.ir/
curl -i --resolve test.divbandai.ir:80:${VM_HOST} http://test.divbandai.ir/
```

## 8. Change Management Notes

For every manual deploy, record:

- Date and operator.
- Git branch and commit SHA.
- VM host/IP.
- Docker and Compose versions.
- DNS record target.
- Commands run.
- Smoke test output.
- Any firewall, package, or OS changes.

## 9. Rollback

If this deployment breaks traffic, SSH into the VM and run:

```bash
cd /opt/divband
git log --oneline -5
git switch docker-haproxy-test-entrypoint
git reset --hard <known-good-commit>
docker compose up -d
curl -i -H "Host: divbandai.ir" http://127.0.0.1/
```

Use `git reset --hard` only on the VM deployment checkout after confirming there
are no uncommitted VM-local changes that need to be preserved.
