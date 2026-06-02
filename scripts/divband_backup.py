#!/usr/bin/env python3
"""Project backup and restore helpers."""

from __future__ import annotations

import json
import shutil
import tarfile
from datetime import datetime, timezone
from pathlib import Path

from divband_projects import (
    NotFoundError,
    PROJECTS_DIR,
    ROOT,
    create_or_refresh_project,
    find_project,
    load_projects,
    regenerate_stack,
    validate_name,
)

BACKUPS_DIR = ROOT / "backups"


def backup_project(name):
    validate_name(name)
    project = find_project(name)
    if not project:
        raise NotFoundError(f"project {name!r} not found", details={"name": name})

    project_dir = PROJECTS_DIR / name
    if not project_dir.exists():
        raise NotFoundError(f"project tree for {name!r} not found", details={"name": name})

    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive_path = BACKUPS_DIR / f"{name}-{timestamp}.tar.gz"
    manifest = {"project": project, "created_at": timestamp, "name": name}

    with tarfile.open(archive_path, "w:gz") as archive:
        archive.add(project_dir, arcname=f"projects/{name}")
        manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
        info = tarfile.TarInfo(name="manifest.json")
        info.size = len(manifest_bytes)
        archive.addfile(info, fileobj=__import__("io").BytesIO(manifest_bytes))

    return {"backup": str(archive_path.relative_to(ROOT)), "project": project}


def list_backups(name=None):
    if not BACKUPS_DIR.exists():
        return []
    pattern = f"{name}-*.tar.gz" if name else "*.tar.gz"
    return sorted(path.name for path in BACKUPS_DIR.glob(pattern))


def restore_project(name, *, backup_file=None, deploy=False):
    validate_name(name)
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

    if backup_file:
        archive_path = Path(backup_file)
        if not archive_path.is_absolute():
            archive_path = BACKUPS_DIR / backup_file
    else:
        matches = sorted(BACKUPS_DIR.glob(f"{name}-*.tar.gz"))
        if not matches:
            raise NotFoundError(f"no backup found for project {name!r}", details={"name": name})
        archive_path = matches[-1]

    if not archive_path.exists():
        raise NotFoundError(f"backup {archive_path.name!r} not found", details={"backup": str(archive_path)})

    manifest = None
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if member.name == "manifest.json":
                manifest = json.loads(archive.extractfile(member).read().decode("utf-8"))
                break
        if manifest is None:
            raise NotFoundError("backup manifest.json missing", details={"backup": archive_path.name})

        project = manifest["project"]
        target_dir = PROJECTS_DIR / name
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.parent.mkdir(parents=True, exist_ok=True)

        for member in archive.getmembers():
            if member.name.startswith(f"projects/{name}/"):
                archive.extract(member, path=ROOT)

    projects = [item for item in load_projects() if item["name"] != name]
    projects.append(project)
    projects.sort(key=lambda item: item["name"])
    from divband_projects import write_projects

    write_projects(projects)
    regenerate_stack(projects)

    result = {"action": "restored", "project": project, "backup": archive_path.name}
    if deploy:
        from divband_docker import compose_up

        result["deploy"] = compose_up(build=True, project=name, remove_orphans=True)
    return result
