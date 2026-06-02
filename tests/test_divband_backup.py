#!/usr/bin/env python3
import importlib
import tarfile
import unittest

from support import IsolatedProjectsMixin


class DivbandBackupTestCase(IsolatedProjectsMixin, unittest.TestCase):
    def setUp(self):
        self.setUpProjectsModule()
        self.patch_backup_dir()
        self.backup_module = importlib.import_module("divband_backup")

    def tearDown(self):
        self.restore_backup_dir()
        self.tearDownProjectsModule()

    def test_backup_and_list(self):
        self.projects_module.create_or_refresh_project("demo", kind="static", arvan=False)
        result = self.backup_module.backup_project("demo")
        self.assertTrue(result["backup"].startswith("backups/demo-"))
        backups = self.backup_module.list_backups("demo")
        self.assertEqual(len(backups), 1)
        self.assertTrue(backups[0].endswith(".tar.gz"))

    def test_restore_from_backup(self):
        self.projects_module.create_or_refresh_project("demo", kind="static", arvan=False)
        custom = self.projects_dir / "demo/html/custom.html"
        custom.write_text("<h1>saved</h1>")
        backup = self.backup_module.backup_project("demo")

        self.projects_module.delete_project("demo", arvan=False)
        self.assertFalse(self.projects_dir.joinpath("demo").exists())

        result = self.backup_module.restore_project(
            "demo",
            backup_file=backup["backup"].split("/", 1)[1],
            arvan=False,
        )
        self.assertEqual(result["action"], "restored")
        self.assertTrue(custom.exists())
        self.assertEqual(self.projects_module.find_project("demo")["name"], "demo")

    def test_restore_missing_backup_raises(self):
        with self.assertRaises(self.projects_module.NotFoundError):
            self.backup_module.restore_project("demo", backup_file="missing.tar.gz")

    def test_backup_archive_contains_manifest(self):
        self.projects_module.create_or_refresh_project("demo", kind="static", arvan=False)
        result = self.backup_module.backup_project("demo")
        archive_path = self.root / result["backup"]
        with tarfile.open(archive_path, "r:gz") as archive:
            names = archive.getnames()
        self.assertIn("manifest.json", names)
        self.assertTrue(any(name.startswith("projects/demo/") for name in names))


if __name__ == "__main__":
    unittest.main()
