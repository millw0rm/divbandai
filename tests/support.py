#!/usr/bin/env python3
"""Shared test helpers for isolated Divband module runs."""

import importlib
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))


class IsolatedProjectsMixin:
    def setUpProjectsModule(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.projects_vars = self.root / "infra/ansible/vars/projects.yml"
        self.projects_dir = self.root / "projects"
        self.haproxy_cfg = self.root / "config/haproxy/haproxy.cfg"
        self.compose_file = self.root / "docker-compose.yml"
        self.backups_dir = self.root / "backups"
        self.projects_vars.parent.mkdir(parents=True, exist_ok=True)
        self.projects_vars.write_text("---\ndivband_projects: []\n")

        self.projects_module = importlib.import_module("divband_projects")
        self._original_project_paths = {
            "ROOT": self.projects_module.ROOT,
            "PROJECTS_VARS": self.projects_module.PROJECTS_VARS,
            "PROJECTS_DIR": self.projects_module.PROJECTS_DIR,
            "HAPROXY_CFG": self.projects_module.HAPROXY_CFG,
            "COMPOSE_FILE": self.projects_module.COMPOSE_FILE,
        }
        self.projects_module.ROOT = self.root
        self.projects_module.PROJECTS_VARS = self.projects_vars
        self.projects_module.PROJECTS_DIR = self.projects_dir
        self.projects_module.HAPROXY_CFG = self.haproxy_cfg
        self.projects_module.COMPOSE_FILE = self.compose_file

    def tearDownProjectsModule(self):
        for key, value in self._original_project_paths.items():
            setattr(self.projects_module, key, value)
        self.tempdir.cleanup()

    def patch_backup_dir(self):
        import divband_backup

        self._original_backup_paths = {
            "BACKUPS_DIR": divband_backup.BACKUPS_DIR,
            "ROOT": divband_backup.ROOT,
            "PROJECTS_DIR": divband_backup.PROJECTS_DIR,
        }
        divband_backup.BACKUPS_DIR = self.backups_dir
        divband_backup.ROOT = self.root
        divband_backup.PROJECTS_DIR = self.projects_dir

    def restore_backup_dir(self):
        import divband_backup

        for key, value in self._original_backup_paths.items():
            setattr(divband_backup, key, value)
