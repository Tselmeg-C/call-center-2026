"""Structural tests for infra/grafana-alerting/*.json and infra/grafana_alerting_apply.py (#35).

No network call, no Grafana credentials needed -- validates the committed config-as-code is
internally consistent and safe (no real-looking secret committed, @claude/on-call present where
required, every rule enabled) without ever reaching the live stack.

Run with: python3 -m pytest infra/test_grafana_alerting.py
"""
import json
import re
from pathlib import Path

import pytest

ALERTING_DIR = Path(__file__).resolve().parent / "grafana-alerting"

ALL_RULE_FILES = [
    "alert-rule-health-ready.json",
    "alert-rule-health-ready-production.json",
    "alert-rule-error-rate.json",
    "alert-rule-latency-p95.json",
]


def load(name):
    with open(ALERTING_DIR / name, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.mark.parametrize(
    "name",
    ALL_RULE_FILES + ["contact-point-github-issue.json", "notification-policy-route.json"],
)
def test_file_is_valid_json(name):
    load(name)  # raises if invalid


@pytest.mark.parametrize("name", ALL_RULE_FILES)
def test_alert_rule_shape(name):
    rule = load(name)
    for field in ("uid", "title", "condition", "data", "for", "labels", "annotations", "isPaused"):
        assert field in rule, f"{name} missing required field {field!r}"
    assert rule["labels"].get("service") == "call-center-api"
    assert rule["labels"].get("environment") == ("production" if "production" in name else "development")
    # refIds referenced by "condition" and each query's own model.refId must be internally consistent.
    ref_ids = {q["refId"] for q in rule["data"]}
    assert rule["condition"] in ref_ids
    for q in rule["data"]:
        assert q["model"]["refId"] == q["refId"]


@pytest.mark.parametrize(
    "name, instance",
    [
        ("alert-rule-health-ready.json", "https://api-development-2a42.up.railway.app/health/ready"),
        ("alert-rule-health-ready-production.json", "https://frontend-prod-production-d39f.up.railway.app/api/health/ready"),
    ],
)
def test_health_ready_rule_is_enabled_and_not_blocked(name, instance):
    rule = load(name)
    assert rule["isPaused"] is False
    assert "#44" not in rule["annotations"]["description"]
    # Queries the live readiness URL directly, no OTel/#44 dependency.
    exprs = " ".join(q["model"].get("expr", "") for q in rule["data"])
    assert "probe_success" in exprs
    assert "/health/ready" in exprs
    # Must match the Synthetic Monitoring check's target exactly, or probe_success never matches.
    assert f'instance="{instance}"' in exprs


@pytest.mark.parametrize("name", ALL_RULE_FILES)
def test_all_rules_enabled_and_not_described_as_blocked(name):
    rule = load(name)
    assert rule["isPaused"] is False
    assert "#44" not in rule["annotations"]["description"]


def test_apply_script_applies_every_rule_file():
    import grafana_alerting_apply as apply

    assert sorted(apply.RULES) == sorted(ALL_RULE_FILES)
    assert sorted(apply.RULES) == sorted(p.name for p in ALERTING_DIR.glob("alert-rule-*.json"))


def test_contact_point_shape_and_github_target():
    cp = load("contact-point-github-issue.json")
    assert cp["type"] == "webhook"
    settings = cp["settings"]
    assert settings["url"] == "https://api.github.com/repos/Tselmeg-C/call-center-2026/issues"
    assert settings["httpMethod"] == "POST"
    payload = settings["payload"]["template"]
    # The rendered payload must be valid JSON once Grafana's Go template placeholders are stripped
    # out to something inert, so a malformed template can't silently ship.
    inert = re.sub(r"\{\{.*?\}\}", "X", payload, flags=re.DOTALL)
    parsed = json.loads(inert)
    assert set(parsed.keys()) == {"title", "body", "labels"}
    assert parsed["labels"] == ["on-call"]
    assert "@claude" in payload
    assert "on-call" in payload  # label name also appears in the payload's labels array


def test_contact_point_secret_is_a_placeholder_not_a_real_token():
    cp = load("contact-point-github-issue.json")
    value = cp["settings"]["authorization_credentials"]
    assert value.startswith("REPLACE-IN-GRAFANA-UI-ONLY")
    # Real fine-grained GitHub PATs are "github_pat_" + 82 base62 chars; make sure nobody pastes
    # a real-shaped one in here by accident.
    assert not re.match(r"^gh[pousr]_[A-Za-z0-9]{20,}$", value)
    assert not value.startswith("github_pat_")


def test_notification_policy_route_matches_contact_point_and_documents_repeat_behavior():
    route = load("notification-policy-route.json")
    cp = load("contact-point-github-issue.json")
    assert route["receiver"] == cp["name"]
    assert route["group_interval"] == "5m"
    assert route["repeat_interval"] == "4h"
    assert any("service=call-center-api" in m for m in route["matchers"])


def test_no_json_file_contains_a_real_looking_secret():
    token_patterns = [
        re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
        re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
        re.compile(r"glsa_[A-Za-z0-9_]{20,}"),  # Grafana service account token shape
    ]
    for path in ALERTING_DIR.glob("*.json"):
        text = path.read_text(encoding="utf-8")
        for pattern in token_patterns:
            assert not pattern.search(text), f"possible real secret in {path.name}"


def test_apply_script_never_places_tokens_on_a_command_line_literal():
    script = (Path(__file__).resolve().parent / "grafana_alerting_apply.py").read_text(encoding="utf-8")
    # Credentials must be read from os.environ, not argparse flags.
    assert "os.environ.get(\"GRAFANA_SERVICE_ACCOUNT_TOKEN\")" in script
    assert "--token" not in script
    assert "add_argument(\"--pat\"" not in script
