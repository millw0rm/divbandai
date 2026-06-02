#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from divband_docker import DockerError, finalize_delete
from divband_projects import NotFoundError, ProjectError, ProtectedProjectError, delete_project


def main():
    parser = argparse.ArgumentParser(description="Delete a Divband project and clean up artifacts.")
    parser.add_argument("name", help="Project name to delete")
    parser.add_argument(
        "--non-arvan-images",
        action="store_true",
        help="Regenerate docker-compose.yml with Docker Hub image names.",
    )
    parser.add_argument(
        "--no-docker",
        action="store_true",
        help="Skip container and image cleanup.",
    )
    parser.add_argument(
        "--no-reload",
        action="store_true",
        help="Skip docker compose reload after delete.",
    )
    parser.add_argument(
        "--keep-image",
        action="store_true",
        help="Do not remove the local built image.",
    )
    parser.add_argument(
        "--prune-volumes",
        action="store_true",
        help="Remove anonymous volumes for the project service.",
    )
    parser.add_argument(
        "--backup-before",
        action="store_true",
        help="Create a tarball backup before deleting registry entries.",
    )
    args = parser.parse_args()

    try:
        result = delete_project(
            args.name,
            arvan=not args.non_arvan_images,
            backup_before=args.backup_before,
        )
        docker_steps = []
        if not args.no_docker:
            try:
                docker_steps = finalize_delete(
                    args.name,
                    kind=result["kind"],
                    reload_stack=not args.no_reload,
                    prune_image=not args.keep_image,
                    prune_volumes=args.prune_volumes,
                )
            except DockerError as exc:
                docker_steps = [{"step": "docker", "ok": False, "error": exc.message, **exc.details}]
        result["docker"] = docker_steps
    except ProtectedProjectError as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        return 3
    except NotFoundError as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        return 1
    except (ProjectError, DockerError) as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        return 2

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
