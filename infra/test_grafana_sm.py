"""Structural tests for infra/grafana-alerting/synthetic-monitoring-check-health-ready.json
and infra/grafana_sm_apply.py (#35/#95).

No network call, no Grafana credentials needed.

Run with: python3 -m pytest infra/test_grafana_sm.py
"""
import json
from pathlib import Path

import pytest

ALERTING_DIR = Path(__file__).resolve().parent / "grafana-alerting"
TARGETS = {
    "synthetic-monitoring-check-health-ready.json": ("development", "https://api-development-2a42.up.railway.app/health/ready"),
    # api-prod has no public domain, so production is probed through the frontend's /api proxy.
    "synthetic-monitoring-check-health-ready-production.json": ("production", "https://frontend-prod-production-d39f.up.railway.app/api/health/ready"),
}


def load(name):
    with open(ALERTING_DIR / name, "r", encoding="utf-8") as f:
        return json.load(f)


def test_every_check_file_is_covered():
    assert sorted(p.name for p in ALERTING_DIR.glob("synthetic-monitoring-check-*.json")) == sorted(TARGETS)


@pytest.mark.parametrize("name", TARGETS)
def test_check_targets_the_live_readiness_url(name):
    check = load(name)
    environment, target = TARGETS[name]
    assert check["target"] == target
    assert check["job"] == f"health-ready-{environment}"
    assert check["labels"] == [{"name": "environment", "value": environment}]
    assert check["enabled"] is True


@pytest.mark.parametrize("name", TARGETS)
def test_check_timeout_exceeds_the_apps_own_readiness_timeout(name):
    check = load(name)
    # apps/api/main.py's _check_postgres_ready has a 5s hard timeout; the probe's own timeout
    # must safely exceed that or a slow-but-healthy readiness check reads as a false failure.
    assert check["timeout"] > 5000
    assert check["timeout"] < check["frequency"]


@pytest.mark.parametrize("name", TARGETS)
def test_check_enum_fields_are_strings_not_ints(name):
    # Gotcha: the SM API's JSON decoder rejects these as integers ("invalid ip version
    # string") despite being protobuf enums -- must be the string name.
    http = load(name)["settings"]["http"]
    assert http["ipVersion"] == "V4"
    assert http["method"] == "GET"


@pytest.mark.parametrize("name", TARGETS)
def test_check_has_at_least_one_probe(name):
    assert len(load(name)["probes"]) >= 1
