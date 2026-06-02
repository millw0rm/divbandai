#!/usr/bin/env python3
"""Remote deployment via Ansible."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENVIRONMENTS_FILE = ROOT / "infra" / "ansible" / "vars" / "environments.json"
DEFAULT_PLAYBOOK = ROOT / "infra" / "ansible" / "playbooks" / "remote-docker.yml"
DEFAULT_INVENTORY = ROOT / "infra" / "ansible" / "inventory.yml"


class RemoteError(Exception):
    code = "remote_error"

    def __init__(self, message, *, details=None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


def load_environments():
    if not ENVIRONMENTS_FILE.exists():
        return {
            "production": {
                "inventory": str(DEFAULT_INVENTORY.relative_to(ROOT)),
                "playbook": str(DEFAULT_PLAYBOOK.relative_to(ROOT)),
            },
            "staging": {
                "inventory": str(DEFAULT_INVENTORY.relative_to(ROOT)),
                "playbook": str(DEFAULT_PLAYBOOK.relative_to(ROOT)),
            },
        }
    return json.loads(ENVIRONMENTS_FILE.read_text())


def resolve_environment(name):
    environments = load_environments()
    if name not in environments:
        raise RemoteError(
            f"unknown environment {name!r}",
            details={"environment": name, "available": sorted(environments)},
        )
    config = dict(environments[name])
    config["inventory"] = str(ROOT / config.get("inventory", "infra/ansible/inventory.yml"))
    config["playbook"] = str(ROOT / config.get("playbook", "infra/ansible/playbooks/remote-docker.yml"))
    return config


def run_ansible(environment, *, extra_vars=None):
    config = resolve_environment(environment)
    inventory = config["inventory"]
    playbook = config["playbook"]
    if not Path(inventory).exists():
        raise RemoteError(
            f"inventory not found: {inventory}",
            details={"environment": environment},
        )

    ansible_playbook = os.environ.get("DIVBAND_ANSIBLE_PLAYBOOK", str(ROOT / ".venv-ansible/bin/ansible-playbook"))
    command = [
        ansible_playbook,
        "-i",
        inventory,
        playbook,
    ]
    for key, value in (extra_vars or {}).items():
        if isinstance(value, bool):
            rendered = "true" if value else "false"
        else:
            rendered = str(value)
        command.extend(["-e", f"{key}={rendered}"])

    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    payload = {
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "environment": environment,
    }
    if result.returncode != 0:
        raise RemoteError("ansible playbook failed", details=payload)
    return payload
