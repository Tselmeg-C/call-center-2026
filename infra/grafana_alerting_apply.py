"""Apply infra/grafana-alerting/*.json to a live Grafana Cloud stack (issue #35).

Not part of the running API -- a local/operator authoring tool only, stdlib-only (no new
dependency), mirroring observability/_gen_grafana_dashboard.py's "generator/apply tool, not
runtime code" pattern.

Uses the Grafana Alerting Provisioning HTTP API:
  https://grafana.com/docs/grafana/latest/developers/http_api/alerting_provisioning/

Credentials and endpoints come ONLY from the environment, by variable name, never a literal on
the command line or in this file (AGENTS.md): GRAFANA_STACK_URL, GRAFANA_SERVICE_ACCOUNT_TOKEN.
This script never prints, logs, or echoes their values -- only HTTP status codes and counts.

Usage (see infra/grafana-alerting/README.md for the full walkthrough):
    GRAFANA_STACK_URL=... GRAFANA_SERVICE_ACCOUNT_TOKEN=... python3 infra/grafana_alerting_apply.py --dry-run
    GRAFANA_STACK_URL=... GRAFANA_SERVICE_ACCOUNT_TOKEN=... python3 infra/grafana_alerting_apply.py
    GRAFANA_STACK_URL=... GRAFANA_SERVICE_ACCOUNT_TOKEN=... python3 infra/grafana_alerting_apply.py --include-blocked

Optional: GITHUB_ONCALL_PAT, if set, is forwarded into the contact point's secure
authorization_credentials field instead of the committed placeholder. It is read from the
environment only and never written to disk or printed. Prefer pasting it directly into the
Grafana UI instead -- see the README's "Applying" section for why.

GRAFANA_PROM_DATASOURCE_UID must be set to the stack's Prometheus datasource UID (the same one
observability/grafana-dashboard.json's $metrics variable resolves to); the alert rule JSON files
carry ${GRAFANA_PROM_DATASOURCE_UID} as a literal placeholder, substituted here.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ALERTING_DIR = HERE / "grafana-alerting"

ALWAYS_RULES = ["alert-rule-health-ready.json"]
BLOCKED_RULES = ["alert-rule-error-rate.json", "alert-rule-latency-p95.json"]
CONTACT_POINT_FILE = "contact-point-github-issue.json"
POLICY_ROUTE_FILE = "notification-policy-route.json"


def load_json(name):
    with open(ALERTING_DIR / name, "r", encoding="utf-8") as f:
        return json.load(f)


def substitute_placeholders(obj):
    """Replace ${GRAFANA_PROM_DATASOURCE_UID} anywhere in a JSON-decoded structure."""
    uid = os.environ.get("GRAFANA_PROM_DATASOURCE_UID", "")
    text = json.dumps(obj)
    text = text.replace("${GRAFANA_PROM_DATASOURCE_UID}", uid)
    return json.loads(text)


def request(base_url, token, method, path, body=None, dry_run=False):
    url = base_url.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    if dry_run:
        size = len(data) if data else 0
        print(f"[dry-run] {method} {path} ({size} bytes)")
        return None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Disable-Provenance", "true")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"{method} {path} -> {resp.status}")
            return json.loads(resp.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        print(f"{method} {path} -> {e.code}")
        return None


def apply_contact_point(base_url, token, pat, dry_run):
    cp = load_json(CONTACT_POINT_FILE)
    if pat:
        cp["secureSettings"]["authorization_credentials"] = pat
    # Try create; a 409 means it already exists, fall back to update-by-uid.
    result = request(base_url, token, "POST", "/api/v1/provisioning/contact-points", cp, dry_run)
    if result is None and not dry_run:
        update = dict(cp)
        if not pat:
            # Without a real PAT, don't resend the placeholder -- Grafana keeps the
            # existing secure value for any key omitted from secureSettings, so this
            # is what stops an update run from clobbering a PAT set by an earlier run.
            update.pop("secureSettings", None)
        request(
            base_url, token, "PUT",
            f"/api/v1/provisioning/contact-points/{cp['uid']}", update, dry_run,
        )


def apply_alert_rule(base_url, token, filename, dry_run):
    rule = substitute_placeholders(load_json(filename))
    result = request(base_url, token, "POST", "/api/v1/provisioning/alert-rules", rule, dry_run)
    if result is None and not dry_run:
        request(
            base_url, token, "PUT",
            f"/api/v1/provisioning/alert-rules/{rule['uid']}", rule, dry_run,
        )


def apply_notification_policy(base_url, token, dry_run):
    route = load_json(POLICY_ROUTE_FILE)
    tree = request(base_url, token, "GET", "/api/v1/provisioning/policies", None, dry_run)
    if dry_run:
        request(base_url, token, "PUT", "/api/v1/provisioning/policies", {"routes": [route]}, dry_run)
        return
    if tree is None:
        print("Could not fetch existing policy tree; not applying (refusing to overwrite blind).")
        return
    routes = tree.get("routes", [])
    replaced = False
    for i, existing in enumerate(routes):
        if existing.get("receiver") == route["receiver"]:
            routes[i] = route
            replaced = True
            break
    if not replaced:
        routes.append(route)
    tree["routes"] = routes
    request(base_url, token, "PUT", "/api/v1/provisioning/policies", tree, dry_run)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print requests, make no network call")
    parser.add_argument(
        "--include-blocked", action="store_true",
        help="also apply the two #44-blocked, isPaused rules (still disabled once applied)",
    )
    args = parser.parse_args()

    base_url = os.environ.get("GRAFANA_STACK_URL")
    token = os.environ.get("GRAFANA_SERVICE_ACCOUNT_TOKEN")
    pat = os.environ.get("GITHUB_ONCALL_PAT")
    if not base_url or not token:
        print(
            "GRAFANA_STACK_URL and GRAFANA_SERVICE_ACCOUNT_TOKEN must be set in the environment "
            "(never on the command line). See infra/grafana-alerting/README.md.",
            file=sys.stderr,
        )
        return 1

    apply_contact_point(base_url, token, pat, args.dry_run)
    apply_notification_policy(base_url, token, args.dry_run)
    for name in ALWAYS_RULES:
        apply_alert_rule(base_url, token, name, args.dry_run)
    if args.include_blocked:
        for name in BLOCKED_RULES:
            apply_alert_rule(base_url, token, name, args.dry_run)
    else:
        print(f"Skipping {len(BLOCKED_RULES)} #44-blocked rule(s); pass --include-blocked to author them live (still isPaused).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
