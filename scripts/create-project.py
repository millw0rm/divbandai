#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from divband_projects import ProjectError, create_or_refresh_project


def main():
    parser = argparse.ArgumentParser(description="Create or refresh a Divband project.")
    parser.add_argument("name", help="Project name, e.g. test creates test.divbandai.ir")
    parser.add_argument(
        "--kind",
        choices=("static", "nextjs", "node", "python", "docker"),
        default="static",
        help="Container type to create.",
    )
    parser.add_argument(
        "--domain",
        action="append",
        dest="domains",
        help="Extra domain to route to this project. Can be used more than once.",
    )
    args = parser.parse_args()

    try:
        result = create_or_refresh_project(
            args.name,
            kind=args.kind,
            extra_domains=args.domains,
        )
    except ProjectError as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        return 2

    project = result["project"]
    print(f"{result['action']} project {project['name']}")
    print(f"domains: {', '.join(project['domains'])}")
    print("next: docker compose up -d")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
