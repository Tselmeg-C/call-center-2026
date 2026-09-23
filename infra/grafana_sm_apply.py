"""Apply infra/grafana-alerting/synthetic-monitoring-check-*.json (development and production) to the live
Grafana Cloud Synthetic Monitoring stack (issue #35/#95).

Not part of the running API -- a local/operator authoring tool only, stdlib-only, mirroring
grafana_alerting_apply.py's "generator/apply tool, not runtime code" pattern.

Synthetic Monitoring is a *separate* API from Grafana's own alerting/dashboards provisioning
API used by grafana_alerting_apply.py -- different base URL, different token, different auth
scope (AGENTS.md: never print, log or commit credentials; both come from the environment only):

    GRAFANA_STACK_URL=...            # same stack URL as grafana_alerting_apply.py
    GRAFANA_SERVICE_ACCOUNT_TOKEN=... # used only to read the "Synthetic Monitoring" datasource
    GRAFANA_SM_ACCESS_TOKEN=...       # generated in Grafana Cloud: Testing & synthetics ->
                                       # Synthetics -> Config -> access token. Separate scope
                                       # from the alerting/dashboards service-account token above.

The Synthetic Monitoring API's base URL is region-specific per tenant (e.g.
https://synthetic-monitoring-api-eu-west-2.grafana.net) -- there is no single fixed hostname.
It's discovered here by reading the stack's own "Synthetic Monitoring" datasource
(type=synthetic-monitoring-datasource), whose jsonData.apiHost carries the exact regional host
for this tenant; that datasource only exists once a human has finished the Synthetics setup
step in the Grafana UI (there's no API to create it -- see infra/grafana-alerting/README.md).

Gotcha worth keeping in code, not just memory: the check's enum fields (ipVersion, http method)
must be sent as their *string* name ("V4", "GET"), not an integer -- despite being protobuf
enums, the API's JSON decoder rejects an int with "invalid ip version string".

Usage:
    GRAFANA_STACK_URL=... GRAFANA_SERVICE_ACCOUNT_TOKEN=... GRAFANA_SM_ACCESS_TOKEN=... \
        python3 infra/grafana_sm_apply.py --dry-run
    GRAFANA_STACK_URL=... GRAFANA_SERVICE_ACCOUNT_TOKEN=... GRAFANA_SM_ACCESS_TOKEN=... \
        python3 infra/grafana_sm_apply.py
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHECK_FILES = sorted((HERE / "grafana-alerting").glob("synthetic-monitoring-check-*.json"))
SM_DATASOURCE_TYPE = "synthetic-monitoring-datasource"


def load_checks():
    return [json.loads(path.read_text(encoding="utf-8")) for path in CHECK_FILES]


def get_sm_api_host(grafana_base_url, grafana_token):
    """Read the stack's "Synthetic Monitoring" datasource to find this tenant's regional
    Synthetic Monitoring API host -- it's not a fixed hostname across all Grafana Cloud stacks."""
    req = urllib.request.Request(grafana_base_url.rstrip("/") + "/api/datasources", method="GET")
    req.add_header("Authorization", f"Bearer {grafana_token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        datasources = json.loads(resp.read())
    for ds in datasources:
        if ds.get("type") == SM_DATASOURCE_TYPE:
            req = urllib.request.Request(
                grafana_base_url.rstrip("/") + f"/api/datasources/uid/{ds['uid']}", method="GET"
            )
            req.add_header("Authorization", f"Bearer {grafana_token}")
            with urllib.request.urlopen(req, timeout=30) as resp:
                full = json.loads(resp.read())
            return full["jsonData"]["apiHost"]
    return None


def sm_request(api_host, sm_token, method, path, body=None, dry_run=False):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    if dry_run:
        size = len(data) if data else 0
        print(f"[dry-run] {method} {path} ({size} bytes)")
        return None
    url = api_host.rstrip("/") + "/api/v1" + path
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {sm_token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            print(f"{method} {path} -> {resp.status}")
            return result
    except urllib.error.HTTPError as e:
        print(f"{method} {path} -> {e.code} {e.read().decode()[:300]}")
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print requests, make no network call")
    args = parser.parse_args()

    grafana_base_url = os.environ.get("GRAFANA_STACK_URL")
    grafana_token = os.environ.get("GRAFANA_SERVICE_ACCOUNT_TOKEN")
    sm_token = os.environ.get("GRAFANA_SM_ACCESS_TOKEN")
    if not grafana_base_url or not grafana_token or not sm_token:
        print(
            "GRAFANA_STACK_URL, GRAFANA_SERVICE_ACCOUNT_TOKEN and GRAFANA_SM_ACCESS_TOKEN must "
            "all be set in the environment (never on the command line). See "
            "infra/grafana-alerting/README.md.",
            file=sys.stderr,
        )
        return 1

    checks = load_checks()

    if args.dry_run:
        sm_request(None, sm_token, "GET", "/probe/list", None, dry_run=True)
        for check in checks:
            sm_request(None, sm_token, "POST", "/check/add", check, dry_run=True)
        return 0

    api_host = get_sm_api_host(grafana_base_url, grafana_token)
    if not api_host:
        print(
            "No Synthetic Monitoring datasource found on this stack -- a human must finish "
            "Synthetics setup in the Grafana UI first (Testing & synthetics -> Synthetics). "
            "There is no API for that step.",
            file=sys.stderr,
        )
        return 1

    existing = sm_request(api_host, sm_token, "GET", "/check/list")
    if existing is None:
        return 1
    for check in checks:
        match = next((c for c in existing if c.get("job") == check["job"]), None)
        if match:
            check_with_id = {**check, "id": match["id"], "tenantId": match["tenantId"]}
            sm_request(api_host, sm_token, "POST", "/check/update", check_with_id)
        else:
            sm_request(api_host, sm_token, "POST", "/check/add", check)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
