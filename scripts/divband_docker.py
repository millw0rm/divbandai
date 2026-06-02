#!/usr/bin/env python3
"""Docker Compose helpers for the Divband project API."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class DockerError(Exception):
    code = "docker_error"

    def __init__(self, message, *, details=None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class DockerUnavailableError(DockerError):
    code = "docker_unavailable"


def run_command(command, *, cwd=ROOT):
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )
    payload = {
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }
    if result.returncode != 0:
        raise DockerError(
            f"command failed: {' '.join(command)}",
            details=payload,
        )
    return payload


def docker_available():
    result = subprocess.run(
        ["docker", "info"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def require_docker():
    if not docker_available():
        raise DockerUnavailableError("docker daemon is not reachable")


def compose_up(*, build=True, project=None, remove_orphans=True):
    require_docker()
    command = ["docker", "compose", "up", "-d"]
    if build:
        command.append("--build")
    if remove_orphans:
        command.append("--remove-orphans")
    if project:
        command.append(f"{project}-web")
    return run_command(command)


def compose_down(*, project=None):
    require_docker()
    if project:
        return run_command(["docker", "compose", "stop", f"{project}-web"])
    return run_command(["docker", "compose", "down"])


def compose_restart(*, project=None, force_recreate=False):
    require_docker()
    if project:
        command = ["docker", "compose", "up", "-d"]
        if force_recreate:
            command.append("--force-recreate")
        command.extend(["--build", f"{project}-web"])
        return run_command(command)
    command = ["docker", "compose", "up", "-d"]
    if force_recreate:
        command.append("--force-recreate")
    command.append("--build")
    return run_command(command)


def compose_pull():
    require_docker()
    return run_command(["docker", "compose", "pull"])


def restart_haproxy():
    require_docker()
    return run_command(["docker", "compose", "restart", "haproxy"])


def stop_project_container(name):
    require_docker()
    return run_command(["docker", "compose", "stop", f"{name}-web"])


def remove_project_container(name):
    require_docker()
    steps = []
    for command in (
        ["docker", "compose", "stop", f"{name}-web"],
        ["docker", "compose", "rm", "-f", f"{name}-web"],
    ):
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        step = {
            "command": command,
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "ok": result.returncode == 0,
        }
        steps.append(step)
    return steps


def remove_project_image(name):
    require_docker()
    result = subprocess.run(
        ["docker", "rmi", f"divband-{name}:local"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return {
        "command": ["docker", "rmi", f"divband-{name}:local"],
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "ok": result.returncode == 0,
    }


def prune_project_volumes(name):
    require_docker()
    result = subprocess.run(
        ["docker", "compose", "rm", "-f", "-v", f"{name}-web"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return {
        "command": ["docker", "compose", "rm", "-f", "-v", f"{name}-web"],
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "ok": result.returncode == 0,
    }


def docker_system_info():
    require_docker()
    images = subprocess.run(
        ["docker", "images", "--format", "{{json .}}"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    disk = subprocess.run(
        ["docker", "system", "df", "--format", "{{json .}}"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if images.returncode != 0:
        raise DockerError("failed to list docker images", details={"stderr": images.stderr})
    if disk.returncode != 0:
        raise DockerError("failed to read docker disk usage", details={"stderr": disk.stderr})
    image_rows = [json.loads(line) for line in images.stdout.splitlines() if line.strip()]
    disk_rows = [json.loads(line) for line in disk.stdout.splitlines() if line.strip()]
    return {"images": image_rows, "disk": disk_rows}


def compose_ps():
    require_docker()
    result = subprocess.run(
        ["docker", "compose", "ps", "--format", "json"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise DockerError(
            "failed to inspect compose services",
            details={
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            },
        )
    services = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        services.append(json.loads(line))
    return services


def project_status(name):
    hints = {
        "compose_service": f"{name}-web",
        "container_name": f"divband-{name}-web",
    }
    try:
        services = compose_ps()
    except DockerError as exc:
        return {
            **hints,
            "running": False,
            "state": "unknown",
            "error": exc.message,
        }

    service = next(
        (item for item in services if item.get("Service") == f"{name}-web"),
        None,
    )
    if not service:
        return {
            **hints,
            "running": False,
            "state": "missing",
        }
    state = service.get("State", "unknown")
    health = service.get("Health")
    return {
        **hints,
        "running": state == "running",
        "state": state,
        "health": health,
        "image": service.get("Image"),
    }


def stack_status():
    try:
        services = compose_ps()
    except DockerError as exc:
        return {"docker_available": docker_available(), "services": [], "error": exc.message}
    return {
        "docker_available": True,
        "services": services,
    }


def deploy(action, *, project=None, build=True, remove_orphans=True, force_recreate=False):
    if action in (None, "", "up"):
        return compose_up(build=build, project=project, remove_orphans=remove_orphans)
    if action == "down":
        return compose_down(project=project)
    if action == "restart":
        return compose_restart(project=project, force_recreate=force_recreate)
    if action == "pull":
        return compose_pull()
    if action == "reload-haproxy":
        return restart_haproxy()
    raise DockerError(
        f"unsupported deploy action: {action!r}",
        details={"action": action},
    )


def finalize_delete(name, *, kind, reload_stack=True, prune_image=True, prune_volumes=False):
    from divband_projects import BUILDABLE_KINDS

    steps = []
    steps.extend(remove_project_container(name))
    if prune_volumes:
        steps.append(prune_project_volumes(name))
    if kind in BUILDABLE_KINDS and prune_image:
        steps.append(remove_project_image(name))
    if reload_stack:
        try:
            steps.append(
                {
                    "step": "reload_stack",
                    **compose_up(build=False, remove_orphans=True),
                    "ok": True,
                }
            )
        except DockerError as exc:
            steps.append({"step": "reload_stack", "ok": False, "error": exc.message, **exc.details})
    return steps
