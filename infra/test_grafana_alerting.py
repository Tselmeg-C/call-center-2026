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
    "alert-rule-health-monitor-stale.json",
]


def load(name):
    with open(ALERTING_DIR / name, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.mark.parametrize(
    "name",
    ALL_RULE_FILES
    + [
        "contact-point-github-issue.json",
        "notification-policy-route.json",
        "notification-policy-route-email.json",
        "notification-policy-route-monitor-stale.json",
    ],
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


# Owner-created in the Grafana UI (#95); the address lives only in Grafana, never in this repo.
EMAIL_CONTACT_POINT = "TselmegC"


def test_email_route_references_an_existing_receiver_and_continues():
    import grafana_alerting_apply as apply

    route = load("notification-policy-route-email.json")
    assert route["receiver"] == EMAIL_CONTACT_POINT
    # continue: true, and listed before the GitHub route, so the GitHub route still matches too.
    assert route["continue"] is True
    assert apply.POLICY_ROUTE_FILES[-2:] == ["notification-policy-route-email.json", "notification-policy-route.json"]
    assert route["repeat_interval"] == "4h"


def _labels_match(route, labels):
    return all(labels.get(k) == v for k, v in (m.split("=", 1) for m in route["matchers"]))


def _receivers(labels):
    """Receivers the managed routes deliver to, walked the way Alertmanager does
    (first match, keep going on continue)."""
    import grafana_alerting_apply as apply

    receivers = []
    for route in (load(n) for n in apply.POLICY_ROUTE_FILES):
        if _labels_match(route, labels):
            receivers.append(route["receiver"])
            if not route["continue"]:
                break
    return receivers


@pytest.mark.parametrize("environment", ["development", "production"])
def test_health_ready_alerts_route_to_both_email_and_github_issue(environment):
    """Walks the managed routes the way Alertmanager does (first match, keep going on continue)."""
    import grafana_alerting_apply as apply

    labels = load(
        "alert-rule-health-ready.json" if environment == "development" else "alert-rule-health-ready-production.json"
    )["labels"]
    assert labels["environment"] == environment
    assert _receivers(labels) == [EMAIL_CONTACT_POINT, "on-call-github-issue"]


def test_warning_rules_do_not_email():
    route = load("notification-policy-route-email.json")
    for name in ("alert-rule-error-rate.json", "alert-rule-latency-p95.json"):
        assert not _labels_match(route, load(name)["labels"])


def test_github_route_unchanged_by_email_route():
    route = load("notification-policy-route.json")
    assert route["receiver"] == "on-call-github-issue"
    assert (route["group_interval"], route["repeat_interval"], route["continue"]) == ("5m", "4h", False)


def test_merge_routes_keeps_unrelated_routes_and_replaces_ours_in_place():
    import grafana_alerting_apply as apply

    other_before = {"receiver": "someone-else", "matchers": ["a=b"]}
    other_after = {"receiver": "another", "matchers": ["c=d"]}
    stale_github = {"receiver": "on-call-github-issue", "matchers": ["old=1"]}
    ours = [{"receiver": EMAIL_CONTACT_POINT}, {"receiver": "on-call-github-issue"}]
    merged = apply.merge_routes([other_before, stale_github, other_after], ours)
    assert merged == [other_before, *ours, other_after]
    # Applying twice is idempotent, and an empty tree just gets ours.
    assert apply.merge_routes(merged, ours) == merged
    assert apply.merge_routes([], ours) == ours


def test_no_committed_file_contains_an_email_address():
    email = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
    for path in ALERTING_DIR.glob("*.json"):
        assert not email.search(path.read_text(encoding="utf-8")), path.name


# --- #99: dead man's switch for the development health monitor -------------------------------

STALE_RULE = "alert-rule-health-monitor-stale.json"


def test_stale_monitor_rule_query_and_nodata():
    rule = load(STALE_RULE)
    expr = rule["data"][0]["model"]["expr"]
    assert expr.startswith("sum(count_over_time(")
    assert 'probe_success{job="health-ready-development"}[30m]' in expr
    assert rule["noDataState"] == "Alerting"  # no samples in 30m == monitor stopped == fire
    assert rule["isPaused"] is False
    assert "stopped reporting" in rule["title"] and "(development)" in rule["title"]
    notes = " ".join(rule["annotations"].values())
    assert "enabled" in notes and "quota" in notes
    assert "_docs/deployment.md#development-health-monitor-95" in rule["annotations"]["runbook_url"]


def test_stale_monitor_rule_emails_owner_only():
    import grafana_alerting_apply as apply

    assert apply.POLICY_ROUTE_FILES[0] == "notification-policy-route-monitor-stale.json"
    assert _receivers(load(STALE_RULE)["labels"]) == [EMAIL_CONTACT_POINT]


def test_dev_health_ready_does_not_fire_on_no_data_but_production_still_does():
    assert load("alert-rule-health-ready.json")["noDataState"] == "OK"
    assert load("alert-rule-health-ready-production.json")["noDataState"] == "Alerting"


def test_merge_routes_with_two_email_routes_is_idempotent():
    import grafana_alerting_apply as apply

    ours = [load(n) for n in apply.POLICY_ROUTE_FILES]
    other = {"receiver": "someone-else", "matchers": ["a=b"]}
    live_before_99 = [other, load("notification-policy-route-email.json"), load("notification-policy-route.json")]
    merged = apply.merge_routes(live_before_99, ours)
    assert merged == [other, *ours]
    assert apply.merge_routes(merged, ours) == merged
