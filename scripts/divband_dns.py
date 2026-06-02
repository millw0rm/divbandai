#!/usr/bin/env python3
"""Optional DNS provider hooks for project lifecycle."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from ipaddress import ip_address

from divband_projects import ProjectError, validate_domain


class DnsError(ProjectError):
    code = "dns_error"


def target_ip():
    configured = os.environ.get("DIVBAND_DNS_TARGET_IP")
    if configured:
        ip_address(configured)
        return configured
    public_ip = os.environ.get("DIVBAND_PUBLIC_IP")
    if public_ip:
        ip_address(public_ip)
        return public_ip
    raise DnsError(
        "set DIVBAND_DNS_TARGET_IP or DIVBAND_PUBLIC_IP for DNS automation",
        details={},
    )


def dns_enabled():
    return os.environ.get("DIVBAND_DNS_PROVIDER", "").lower() == "arvan"


def arvan_request(method, path, payload=None):
    api_key = os.environ.get("ARVAN_DNS_API_KEY")
    if not api_key:
        raise DnsError("ARVAN_DNS_API_KEY is required for Arvan DNS automation")

    base_url = os.environ.get("ARVAN_DNS_API_URL", "https://napi.arvancloud.ir/dns/4.0")
    url = f"{base_url.rstrip('/')}/{path.lstrip('/')}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise DnsError(
            f"Arvan DNS API request failed: {exc.code}",
            details={"status": exc.code, "body": detail, "path": path},
        ) from exc
    except urllib.error.URLError as exc:
        raise DnsError(f"Arvan DNS API unreachable: {exc.reason}", details={"path": path}) from exc


def zone_domain(domain):
    configured = os.environ.get("DIVBAND_DNS_ZONE")
    if configured:
        return validate_domain(configured)
    parts = validate_domain(domain).split(".")
    if len(parts) < 2:
        raise DnsError(f"cannot infer DNS zone for {domain!r}")
    return ".".join(parts[-2:])


def create_a_records(domains):
    if not dns_enabled():
        return {"provider": None, "records": [], "skipped": True}

    ip = target_ip()
    ttl = int(os.environ.get("DIVBAND_DNS_TTL", "300"))
    records = []
    for domain in domains:
        domain = validate_domain(domain)
        zone = zone_domain(domain)
        relative = domain[: -(len(zone) + 1)] if domain != zone else "@"
        payload = {
            "type": "a",
            "name": relative or "@",
            "value": [{"ip": ip, "port": None}],
            "ttl": ttl,
            "cloud": False,
        }
        response = arvan_request("POST", f"domains/{zone}/records", payload)
        records.append({"domain": domain, "zone": zone, "response": response})
    return {"provider": "arvan", "records": records, "skipped": False}


def delete_a_records(domains):
    if not dns_enabled():
        return {"provider": None, "records": [], "skipped": True}

    records = []
    for domain in domains:
        domain = validate_domain(domain)
        zone = zone_domain(domain)
        relative = domain[: -(len(zone) + 1)] if domain != zone else "@"
        listing = arvan_request("GET", f"domains/{zone}/records")
        items = listing.get("data", listing if isinstance(listing, list) else [])
        deleted = []
        for item in items:
            name = item.get("name")
            record_type = (item.get("type") or "").lower()
            if record_type == "a" and name in {relative, relative or "@", domain}:
                record_id = item.get("id")
                if record_id:
                    arvan_request("DELETE", f"domains/{zone}/records/{record_id}")
                    deleted.append(record_id)
        records.append({"domain": domain, "zone": zone, "deleted_ids": deleted})
    return {"provider": "arvan", "records": records, "skipped": False}
