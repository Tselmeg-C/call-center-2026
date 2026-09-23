"""Structural tests for infra/grafana-alerting/synthetic-monitoring-check-health-ready.json
and infra/grafana_sm_apply.py (#35/#95).

No network call, no Grafana credentials needed.

Run with: python3 -m pytest infra/test_grafana_sm.py
"""
import json
from pathlib import Path

CHECK_FILE = (
    Path(__file__).resolve().parent
    / "grafana-alerting"
    / "synthetic-monitoring-check-health-ready.json"
)


def load():
    with open(CHECK_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def test_check_targets_the_live_readiness_url():
    check = load()
    assert check["target"] == "https://api-development-2a42.up.railway.app/health/ready"
    assert check["enabled"] is True


def test_check_timeout_exceeds_the_apps_own_readiness_timeout():
    check = load()
    # apps/api/main.py's _check_postgres_ready has a 5s hard timeout; the probe's own timeout
    # must safely exceed that or a slow-but-healthy readiness check reads as a false failure.
    assert check["timeout"] > 5000
    assert check["timeout"] < check["frequency"]


def test_check_enum_fields_are_strings_not_ints():
    # Gotcha: the SM API's JSON decoder rejects these as integers ("invalid ip version
    # string") despite being protobuf enums -- must be the string name.
    http = load()["settings"]["http"]
    assert http["ipVersion"] == "V4"
    assert http["method"] == "GET"


def test_check_has_at_least_one_probe():
    assert len(load()["probes"]) >= 1
