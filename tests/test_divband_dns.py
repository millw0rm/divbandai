#!/usr/bin/env python3
import importlib
import os
import unittest
from unittest.mock import patch

from support import IsolatedProjectsMixin


class DivbandDnsTestCase(unittest.TestCase):
    def setUp(self):
        self.module = importlib.import_module("divband_dns")

    @patch.dict(os.environ, {"DIVBAND_DNS_TARGET_IP": "203.0.113.10"}, clear=False)
    def test_target_ip_from_env(self):
        self.assertEqual(self.module.target_ip(), "203.0.113.10")

    def test_target_ip_missing_raises(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(self.module.DnsError):
                self.module.target_ip()

    @patch.dict(os.environ, {"DIVBAND_DNS_ZONE": "example.com"}, clear=False)
    def test_zone_domain_uses_configured_zone(self):
        self.assertEqual(self.module.zone_domain("app.example.com"), "example.com")

    def test_zone_domain_infers_parent(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.module.zone_domain("app.divbandai.ir"), "divbandai.ir")

    @patch.dict(os.environ, {}, clear=False)
    def test_create_a_records_skipped_when_disabled(self):
        result = self.module.create_a_records(["demo.divbandai.ir"])
        self.assertTrue(result["skipped"])
        self.assertIsNone(result["provider"])

    @patch.dict(
        os.environ,
        {
            "DIVBAND_DNS_PROVIDER": "arvan",
            "DIVBAND_DNS_TARGET_IP": "203.0.113.10",
            "ARVAN_DNS_API_KEY": "secret",
        },
        clear=False,
    )
    @patch("divband_dns.arvan_request")
    def test_create_a_records_posts_to_arvan(self, mock_request):
        mock_request.return_value = {"id": "rec-1"}
        result = self.module.create_a_records(["demo.divbandai.ir"])
        self.assertFalse(result["skipped"])
        self.assertEqual(result["provider"], "arvan")
        mock_request.assert_called_once()
        payload = mock_request.call_args[0][2]
        self.assertEqual(payload["type"], "a")
        self.assertEqual(payload["value"][0]["ip"], "203.0.113.10")

    @patch.dict(
        os.environ,
        {
            "DIVBAND_DNS_PROVIDER": "arvan",
            "DIVBAND_DNS_TARGET_IP": "203.0.113.10",
            "ARVAN_DNS_API_KEY": "secret",
        },
        clear=False,
    )
    @patch("divband_dns.arvan_request")
    def test_delete_a_records_removes_matching_a_records(self, mock_request):
        mock_request.side_effect = [
            {"data": [{"id": "1", "name": "demo", "type": "a"}, {"id": "2", "name": "www", "type": "cname"}]},
            {},
        ]
        result = self.module.delete_a_records(["demo.divbandai.ir"])
        self.assertEqual(result["records"][0]["deleted_ids"], ["1"])
        self.assertEqual(mock_request.call_count, 2)


if __name__ == "__main__":
    unittest.main()
