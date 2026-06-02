#!/usr/bin/env python3
import importlib
import unittest


class DivbandScaffoldTestCase(unittest.TestCase):
    def setUp(self):
        self.module = importlib.import_module("divband_scaffold")

    def test_node_templates_include_project_name(self):
        package = self.module.node_package_json("myapp")
        self.assertIn('"name": "myapp"', package)
        server = self.module.node_server_js("my-app")
        self.assertIn("Welcome to my-app", server)
        self.assertIn("/healthz", server)

    def test_node_templates_escape_html(self):
        server = self.module.node_server_js("<script>")
        self.assertNotIn("<script>", server)
        self.assertIn("&lt;script&gt;", server)

    def test_python_templates(self):
        app = self.module.python_app_py("api")
        self.assertIn("Welcome to api", app)
        self.assertIn("/healthz", app)
        self.assertIn("flask", self.module.python_requirements().lower())

    def test_dockerfiles_expose_expected_ports(self):
        self.assertIn("EXPOSE 3000", self.module.node_dockerfile())
        self.assertIn("EXPOSE 8000", self.module.python_dockerfile())
        self.assertIn("gunicorn", self.module.python_dockerfile())


if __name__ == "__main__":
    unittest.main()
