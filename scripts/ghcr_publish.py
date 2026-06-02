#!/usr/bin/env python3
"""Build and push Divband project images to GitHub Container Registry."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
PROJECTS_VARS = ROOT / "infra" / "ansible" / "vars" / "projects.yml"
BUILDABLE_KINDS = {"nextjs", "node", "python", "docker"}


def ghcr_image(name: str, owner: str, tag: str, registry: str = "ghcr.io") -> str:
    return f"{registry}/{owner.lower()}/divband-{name}:{tag}"


def load_projects():
    data = yaml.safe_load(PROJECTS_VARS.read_text()) or {}
    return data.get("divband_projects", [])


def run(cmd, *, cwd=None):
    subprocess.run(cmd, check=True, cwd=cwd or ROOT)


def publish_project(project, *, owner, registry, tag, extra_tags, push):
    kind = project.get("kind", "static")
    if kind not in BUILDABLE_KINDS:
        return

    name = project["name"]
    context = ROOT / "projects" / name
    dockerfile = project.get("dockerfile", "Dockerfile")
    if not (context / dockerfile).exists():
        raise FileNotFoundError(f"missing Dockerfile for project {name}: {context / dockerfile}")

    primary = ghcr_image(name, owner, tag, registry)
    run(
        [
            "docker",
            "build",
            "-f",
            str(context / dockerfile),
            "-t",
            primary,
            str(context),
        ]
    )

    if not push:
        return

    tags = [tag, *(t for t in extra_tags if t and t != tag)]
    for extra in tags:
        tagged = ghcr_image(name, owner, extra, registry)
        if tagged != primary:
            run(["docker", "tag", primary, tagged])
        run(["docker", "push", tagged])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", default=os.environ.get("GHCR_OWNER") or os.environ.get("GITHUB_REPOSITORY_OWNER"))
    parser.add_argument("--registry", default=os.environ.get("GHCR_REGISTRY", "ghcr.io"))
    parser.add_argument("--tag", default=os.environ.get("GHCR_TAG"))
    parser.add_argument(
        "--extra-tag",
        action="append",
        default=[],
        help="Additional tags to push (or GHCR_EXTRA_TAGS comma-separated)",
    )
    parser.add_argument("--no-push", action="store_true")
    args = parser.parse_args(argv)

    if not args.owner:
        parser.error("set --owner or GHCR_OWNER / GITHUB_REPOSITORY_OWNER")
    if not args.tag:
        parser.error("set --tag or GHCR_TAG")

    extra = list(args.extra_tag)
    if os.environ.get("GHCR_EXTRA_TAGS"):
        extra.extend(t.strip() for t in os.environ["GHCR_EXTRA_TAGS"].split(",") if t.strip())

    for project in load_projects():
        publish_project(
            project,
            owner=args.owner,
            registry=args.registry,
            tag=args.tag,
            extra_tags=extra,
            push=not args.no_push,
        )


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(exc.returncode)
