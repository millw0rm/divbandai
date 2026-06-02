#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY' |
import yaml

with open("infra/ansible/vars/projects.yml", "r", encoding="utf-8") as handle:
    data = yaml.safe_load(handle) or {}

for project in data.get("divband_projects", []):
    expected = f"Welcome to {project['name']}"
    for domain in project.get("domains", []):
        print(f"{domain}\t{expected}")
PY
while IFS=$'\t' read -r domain expected; do
  curl --noproxy '*' -fsS -H "Host: ${domain}" http://127.0.0.1/ | grep -q "${expected}"
  printf 'ok %s\n' "${domain}"
done
