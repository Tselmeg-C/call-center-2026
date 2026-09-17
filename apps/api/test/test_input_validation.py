"""#64: follow-up and assignment-rule input is rejected with 422 before anything is stored,
identically in memory mode and PostgreSQL mode (PostgreSQL runs need TEST_DATABASE_URL).

Use --tb=no so even unexpected assertion failures cannot print credentials."""
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from .. import assignment_rules, main
from ..assignment_rules import ConditionError
from .test_auth_adapters import ORIGIN, migrate, postgres_url  # noqa: F401 -- postgres_url is a fixture

BCN = "000964"
INVALID = {"detail": "Invalid request."}
NOW = datetime.now(timezone.utc)
YESTERDAY = (NOW - timedelta(days=1)).date().isoformat()
ISO_Z = (NOW + timedelta(days=3)).isoformat(timespec="milliseconds").replace("+00:00", "Z")  # what toISOString() sends


@pytest.fixture(params=["memory", "postgres"])
def env(request, monkeypatch):
    databases = {}
    if request.param == "postgres":
        from ..db_activity import ActivityDatabase
        from ..db_assignment import AssignmentDatabase
        from ..db_auth import AuthDatabase
        from ..db_customers import CustomerDatabase
        url = request.getfixturevalue("postgres_url")
        migrate()
        databases = {"auth_db": AuthDatabase(url, create_schema=False), "customer_db": CustomerDatabase(url, create_schema=False), "assignment_db": AssignmentDatabase(url, create_schema=False), "activity_db": ActivityDatabase(url, create_schema=False)}
    for name in ("auth_db", "customer_db", "assignment_db", "activity_db"):
        monkeypatch.setattr(main, name, databases.get(name))
    main.repo.reset(); main.repo.customers.clear()
    secret = secrets.token_urlsafe(24)
    admin = main.provision_user(main.Provision(name="Admin", email="admin64@example.test", role="Admin", password=secret))
    sales = main.provision_user(main.Provision(name="Sales", email="sales64@example.test", role="Sales", password=secret))
    if databases:
        databases["customer_db"].upsert_source(bcn=BCN, name="Validation Co", source={})
        databases["customer_db"].save_operational(bcn=BCN, owner_id=sales.id, status="Open", version=0)
    else:
        main.repo.customers[BCN] = {"bcn": BCN, "name": "Validation Co", "ownerId": sales.id, "ownerName": "Sales", "status": "Open", "phones": [], "source": {}, "version": 0, "histories": []}
    clients = []
    try:
        for user in (admin, sales):
            client = TestClient(main.app, base_url="http://localhost"); clients.append(client)
            assert client.post("/session/login", json={"email": user.email, "password": secret}).status_code == 200
        yield SimpleNamespace(mode=request.param, admin=clients[0], sales=clients[1], sales_id=sales.id)
    finally:
        for client in clients: client.close()
        for database in databases.values(): database.engine.dispose()
        main.repo.reset()


def sid() -> str:
    return secrets.token_hex(8)


def create_followup(client, **overrides):
    body = {"type": "Reminder", "due": None, "note": "Call back", "submissionId": sid()} | overrides
    response = client.post(f"/customers/{BCN}/follow-ups", json=body, headers=ORIGIN)
    assert response.status_code == 200, response.text  # the endpoint has no explicit 201
    return response.json()


def followup_state(followup_id):
    """What the cache and (in PostgreSQL mode) the database hold for one follow-up."""
    cached = next(item for item in main.repo.followups.values() if item["id"] == followup_id)
    stored = None
    if main.activity_db is not None:
        row = next(item for item in main.activity_db.followups(BCN) if item.id == followup_id)
        stored = (row.type, row.due, row.note, row.status, row.version)
    return (cached["type"], cached["due"], cached["note"], cached["status"], cached.get("version")), stored


def assert_invalid(response):
    assert response.status_code == 422 and response.json() == INVALID, response.text


# ---- follow-ups: FollowUpCreate on create and PATCH ------------------------------------------

BAD_FOLLOWUP_BODIES = [
    *({"type": value} for value in ("appointment", "Follow-up needed", "", None, 1)),
    *({"due": value} for value in ("not-a-date", "2026-13-45", "2026-02-30", "", "   ", 20260920, ["2026-09-20"], "2026-09-20T08:00", "1999-12-31", "1999-12-31T23:59:59Z", (NOW + timedelta(days=5 * 366)).isoformat())),
    {"type": "Appointment", "due": None},
    *({"note": value} for value in ("", "   \n", "x" * 4001, " " + "x" * 4001, None)),
    *({"submissionId": value} for value in ("", "   ", "s" * 121, None, 5)),
    {"status": "Completed"},
    {"dueKind": "none"},
]


@pytest.mark.parametrize("patch", BAD_FOLLOWUP_BODIES)
def test_followup_create_and_update_reject_bad_input_without_writing(env, patch):
    body = {"type": "Reminder", "due": YESTERDAY, "note": "Call back", "submissionId": sid()} | patch
    assert_invalid(env.sales.post(f"/customers/{BCN}/follow-ups", json=body, headers=ORIGIN))
    existing = create_followup(env.sales)
    before = followup_state(existing["id"])
    assert_invalid(env.sales.patch(f"/customers/{BCN}/follow-ups/{existing['id']}", json=body, headers=ORIGIN))
    assert followup_state(existing["id"]) == before
    assert len(main.repo.followups) == 1 and (main.activity_db is None or len(main.activity_db.followups(BCN)) == 1)


def test_followup_missing_type_and_bad_due_on_patch_keep_old_values(env):
    existing = create_followup(env.sales, type="Appointment", due=ISO_Z, note="Visit")
    before = followup_state(existing["id"])
    for body in ({"note": "x", "submissionId": sid()}, {"type": "Appointment", "due": "not-a-date", "note": "Changed", "submissionId": sid()}):
        assert_invalid(env.sales.patch(f"/customers/{BCN}/follow-ups/{existing['id']}", json=body, headers=ORIGIN))
    assert followup_state(existing["id"]) == before
    detail = env.sales.get(f"/customers/{BCN}").json()
    if env.mode == "postgres":
        assert [(item["type"], item["note"]) for item in detail["followUps"]] == [("Appointment", "Visit")]


@pytest.mark.parametrize("due", [None, YESTERDAY, NOW.date().isoformat(), ISO_Z, "2026-09-20T08:00:00+02:00", "2000-01-01"])
def test_followup_accepts_valid_due_including_past(env, due):
    created = create_followup(env.sales, due=due)
    updated = env.sales.patch(f"/customers/{BCN}/follow-ups/{created['id']}", json={"type": "Appointment" if due else "Reminder", "due": due, "note": "Edited", "submissionId": sid()}, headers=ORIGIN)
    assert updated.status_code == 200, updated.text


def test_followup_note_is_trimmed_before_storage_and_idempotency(env):
    submission = sid()
    created = create_followup(env.sales, note="  padded note \n", submissionId=submission)
    assert created["note"] == "padded note"
    replay = env.sales.post(f"/customers/{BCN}/follow-ups", json={"type": "Reminder", "due": None, "note": "padded note", "submissionId": submission}, headers=ORIGIN)
    assert replay.status_code == 200 and replay.json()["id"] == created["id"]
    exact = create_followup(env.sales, note="x" * 4000, submissionId="s" * 120)
    updated = env.sales.patch(f"/customers/{BCN}/follow-ups/{exact['id']}", json={"type": "Reminder", "due": None, "note": " " + "y" * 4000 + " ", "submissionId": "e" * 120}, headers=ORIGIN)
    assert updated.status_code == 200 and updated.json()["note"] == "y" * 4000


# ---- follow-ups: cancel and complete ---------------------------------------------------------

def test_cancel_body_validation_and_no_body_fallback(env):
    item = create_followup(env.sales)
    for body in ({"submissionId": sid(), "reason": "x"}, {"submissionId": ""}, {"submissionId": "s" * 121}, {}):
        assert_invalid(env.sales.post(f"/customers/{BCN}/follow-ups/{item['id']}/cancel", json=body, headers=ORIGIN))
    assert followup_state(item["id"])[0][3] == "Open"
    cancelled = env.sales.post(f"/customers/{BCN}/follow-ups/{item['id']}/cancel", headers=ORIGIN)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "Cancelled"
    other = create_followup(env.sales)
    assert env.sales.post(f"/customers/{BCN}/follow-ups/{other['id']}/cancel", json={"submissionId": "c" * 120}, headers=ORIGIN).status_code == 200


@pytest.mark.parametrize("body", [
    {"outcome": "contact"}, {"outcome": "Other"}, {"outcome": None}, {"outcome": 1},
    {"note": "x" * 4001}, {"note": 5}, {"submissionId": "s" * 121}, {"submissionId": " "}, {"extra": True},
])
def test_complete_and_interaction_reject_bad_input(env, body):
    item = create_followup(env.sales)
    request = {"outcome": "Contact", "note": None, "submissionId": sid()} | body
    assert_invalid(env.sales.post(f"/customers/{BCN}/follow-ups/{item['id']}/complete", json=request, headers=ORIGIN))
    assert_invalid(env.sales.post(f"/customers/{BCN}/interactions", json=request, headers=ORIGIN))
    assert followup_state(item["id"])[0][3] == "Open"
    missing = {key: value for key, value in request.items() if key != "outcome"}
    assert_invalid(env.sales.post(f"/customers/{BCN}/interactions", json=missing, headers=ORIGIN))


def test_complete_idempotency_is_scoped_per_user(env):
    item = create_followup(env.sales)
    shared = sid()
    first = env.sales.post(f"/customers/{BCN}/follow-ups/{item['id']}/complete", json={"outcome": "Contact", "note": "Done", "submissionId": shared}, headers=ORIGIN)
    assert first.status_code == 200 and first.json()["status"] == "Completed"
    assert env.sales.post(f"/customers/{BCN}/follow-ups/{item['id']}/complete", json={"outcome": "Attempt", "note": "Changed", "submissionId": shared}, headers=ORIGIN).status_code == 409
    # Another user reusing A's submissionId with a different payload no longer hits A's 409.
    other = env.admin.post(f"/customers/{BCN}/follow-ups/{item['id']}/complete", json={"outcome": "Attempt", "note": "Admin", "submissionId": shared}, headers=ORIGIN)
    assert other.status_code == 200 and other.json()["status"] == "Completed"
    if env.mode == "memory":
        assert (f"followup:{env.sales_id}:{BCN}", shared) in main.repo.submissions


# ---- assignment rules ------------------------------------------------------------------------

def create_rule(env, **overrides):
    body = {"name": f"Rule {sid()}", "conditions": [], "memberIds": [env.sales_id], "active": True} | overrides
    response = env.admin.post("/admin/assignment-rules", json=body, headers=ORIGIN)
    assert response.status_code == 201, response.text
    return response.json()


def version(env) -> int:
    return env.admin.get("/admin/assignment-version").json()


def rules_snapshot(env):
    stored = None
    if main.assignment_db is not None:
        stored = [(row.id, row.name, row.position, row.active, row.conditions) for row in main.assignment_db.ordered_rules()], main.assignment_db.get_setting("assignment_version")
    return [dict(rule) for rule in main.repo.rules], main.repo.assignment_version, stored


def junk_conditions(env):
    return [
        "field", 3, {"field": "name"}, None, [[[[{}]]]], ["x"], [None],
        [{"field": "name", "operator": "=", "value": "x", "foo": 1}],
        [{"field": 1, "operator": "=", "value": "x"}], [{"field": "name", "operator": ["="], "value": "x"}],
        [{"field": "n" * 65, "operator": "=", "value": "x"}],
        [{"field": "name", "operator": "is-null"}] * 51,
    ]


def bad_rule_fields(env):
    return [
        *({"name": value} for value in ("", "   ", "n" * 121, " " + "n" * 121, 5, None, ["x"])),
        *({"active": value} for value in ("true", 1, "yes", None)),
        *({"conditions": value} for value in junk_conditions(env)),
        *({"memberIds": value} for value in (env.sales_id, None, [1], [None], [""], ["m" * 121], [env.sales_id] * 101, {"a": 1})),
        {"position": 2}, {"ownerId": "x"},
    ]


def test_rule_create_rejects_bad_input_without_writing(env):
    create_rule(env)
    before = rules_snapshot(env)
    for field in bad_rule_fields(env):
        body = {"name": "Fresh", "conditions": [], "memberIds": [env.sales_id], "active": True} | field
        assert_invalid(env.admin.post("/admin/assignment-rules", json=body, headers=ORIGIN))
    assert_invalid(env.admin.post("/admin/assignment-rules", json={"name": 1, "conditions": "x", "memberIds": 2, "active": "no"}, headers=ORIGIN))
    assert_invalid(env.admin.post("/admin/assignment-rules", json={"conditions": [], "memberIds": [env.sales_id]}, headers=ORIGIN))
    assert rules_snapshot(env) == before


def test_rule_patch_rejects_bad_input_without_writing(env):
    rule = create_rule(env)
    before = rules_snapshot(env)
    url = f"/admin/assignment-rules/{rule['id']}"
    for field in [*bad_rule_fields(env), *({"order": value} for value in ("2", 2.5, True, 0, -1, 10**12, None)), *({"version": value} for value in ("3", 3.5, True, None))]:
        assert_invalid(env.admin.patch(url, json={"active": False} | field, headers=ORIGIN))
    for body in ({}, {"version": version(env)}, {"version": 3}, {"position": 2}, None, []):
        assert_invalid(env.admin.patch(url, json=body, headers=ORIGIN))
    assert_invalid(env.admin.patch(url, json={"name": 1, "conditions": 2, "memberIds": "x", "active": "y", "order": "z", "version": "v"}, headers=ORIGIN))
    assert rules_snapshot(env) == before


def test_rule_patch_stale_version_still_409(env):
    rule = create_rule(env)
    before = rules_snapshot(env)
    for stale in (0, -1, version(env) + 5):
        response = env.admin.patch(f"/admin/assignment-rules/{rule['id']}", json={"active": False, "version": stale}, headers=ORIGIN)
        assert response.status_code == 409 and response.json() == {"detail": "Assignment configuration is stale."}
    assert rules_snapshot(env) == before


def test_rule_name_trim_length_and_duplicates(env):
    first = create_rule(env, name="  Padded  ")
    assert first["name"] == "Padded"
    second = create_rule(env, name="n" * 120)
    patched = env.admin.patch(f"/admin/assignment-rules/{second['id']}", json={"name": "  Renamed  ", "version": version(env)}, headers=ORIGIN)
    assert patched.status_code == 200 and patched.json()["name"] == "Renamed"
    assert env.admin.patch(f"/admin/assignment-rules/{second['id']}", json={"name": " " + "m" * 120 + " "}, headers=ORIGIN).status_code == 200
    for response in (
        env.admin.post("/admin/assignment-rules", json={"name": " padded ", "conditions": [], "memberIds": [env.sales_id]}, headers=ORIGIN),
        env.admin.patch(f"/admin/assignment-rules/{second['id']}", json={"name": " PADDED "}, headers=ORIGIN),
    ):
        assert response.status_code == 409 and response.json() == {"detail": "Rule already exists."}


def test_rule_order_bounds_and_shared_order(env):
    first, second = create_rule(env), create_rule(env)
    for value in (1, 1_000_000, first["order"]):
        response = env.admin.patch(f"/admin/assignment-rules/{second['id']}", json={"order": value}, headers=ORIGIN)
        assert response.status_code == 200 and response.json()["order"] == value
    listed = env.admin.get("/admin/assignment-rules")
    assert listed.status_code == 200 and [rule["order"] for rule in listed.json()] == [first["order"], first["order"]]


def test_rule_patch_null_members_and_conditions_are_422_and_member_messages_unchanged(env):
    rule = create_rule(env)
    url = f"/admin/assignment-rules/{rule['id']}"
    for field in ("name", "conditions", "memberIds", "active", "order", "version"):
        assert_invalid(env.admin.patch(url, json={"active": False, field: None} if field != "active" else {"order": 1, "active": None}, headers=ORIGIN))
    assert env.admin.patch(url, json={"memberIds": []}, headers=ORIGIN).json() == {"detail": "Rule must have at least one eligible member."}
    assert env.admin.patch(url, json={"memberIds": ["ghost"]}, headers=ORIGIN).json() == {"detail": "Eligible members must be active Sales users."}
    deduped = env.admin.patch(url, json={"memberIds": [env.sales_id, env.sales_id]}, headers=ORIGIN)
    assert deduped.status_code == 200 and deduped.json()["memberIds"] == [env.sales_id]
    capped = env.admin.post("/admin/assignment-rules", json={"name": "Hundred", "conditions": [], "memberIds": [env.sales_id] * 100}, headers=ORIGIN)
    assert capped.status_code == 201 and capped.json()["memberIds"] == [env.sales_id]


BAD_CONDITIONS = [
    ("name", "=", 5), ("name", "!=", ""), ("name", "contains", ""), ("name", "contains", "   "), ("name", "=", "x" * 256), ("name", "=", None),
    ("name", "in", []), ("name", "in", ["a"] * 501), ("name", "in", ["a", 1]), ("name", "in", ["a", " "]), ("name", "in", ["x" * 256]), ("name", "in", "a"),
    *(("propensity_score", ">", value) for value in ("NaN", "Infinity", "-inf", "sNaN", "1" * 65, True, "abc", [])),
    ("propensity_score", "between", ["1", "NaN"]), ("propensity_score", "between", ["-Infinity", "1"]), ("propensity_score", "between", ["5", "1"]), ("propensity_score", "between", ["1"]), ("propensity_score", "between", "1,2"),
    *(("last_purchase_date", "=", value) for value in ("2026-01-01garbage", "2026-01-01T10:00", "20260101", "2026-02-30", 20260101, " 2026-01-01")),
    ("last_purchase_date", "between", ["2026-01-01", "2025-01-01"]), ("last_purchase_date", "between", ["2026-01-01T00:00", "2026-02-01"]),
    ("previously_contacted", "=", "true"),
]


@pytest.mark.parametrize("field,operator,value", BAD_CONDITIONS)
def test_condition_values_are_checked_by_type(field, operator, value):
    with pytest.raises(ConditionError):
        assignment_rules.validate_condition(field, operator, value)


def test_condition_value_errors_are_422_with_message_on_create_and_patch(env):
    rule = create_rule(env)
    before = rules_snapshot(env)
    for field, operator, value in BAD_CONDITIONS:
        conditions = [{"field": field, "operator": operator, "value": value}]
        created = env.admin.post("/admin/assignment-rules", json={"name": "Bad", "conditions": conditions, "memberIds": [env.sales_id]}, headers=ORIGIN)
        patched = env.admin.patch(f"/admin/assignment-rules/{rule['id']}", json={"conditions": conditions}, headers=ORIGIN)
        for response in (created, patched):
            assert response.status_code == 422 and response.json()["detail"] != INVALID["detail"], (field, operator, response.text)
    assert rules_snapshot(env) == before


# ---- frontend compatibility (happy paths, both modes) ----------------------------------------

def test_frontend_followup_and_interaction_flows(env):
    appointment = create_followup(env.sales, type="Appointment", due=ISO_Z, note="Site visit")
    reminder = create_followup(env.sales, type="Reminder", due=ISO_Z, note="Follow-up")
    needed = create_followup(env.sales, type="Reminder", due=None, note="Follow-up")
    edited = env.sales.patch(f"/customers/{BCN}/follow-ups/{needed['id']}", json={"type": "Reminder", "due": None, "note": "Edited", "submissionId": sid()}, headers=ORIGIN)
    assert edited.status_code == 200 and edited.json()["note"] == "Edited"
    assert env.sales.post(f"/customers/{BCN}/follow-ups/{reminder['id']}/cancel", json={"submissionId": sid()}, headers=ORIGIN).json()["status"] == "Cancelled"
    assert env.sales.post(f"/customers/{BCN}/follow-ups/{appointment['id']}/complete", json={"outcome": "Contact", "note": "Visited", "submissionId": sid()}, headers=ORIGIN).json()["status"] == "Completed"
    assert env.sales.post(f"/customers/{BCN}/follow-ups/{needed['id']}/complete", json={"outcome": "Attempt", "note": None, "submissionId": sid()}, headers=ORIGIN).json()["status"] == "Completed"
    for note in ("Called", None):
        assert env.sales.post(f"/customers/{BCN}/interactions", json={"outcome": "Attempt", "note": note, "submissionId": sid()}, headers=ORIGIN).status_code == 200
    assert env.sales.post(f"/customers/{BCN}/interactions", json={"outcome": "Contact", "submissionId": sid()}, headers=ORIGIN).status_code == 200


def builder_conditions():
    """Every field kind and operator the rule builder offers, shaped as draftToCondition sends them."""
    conditions = []
    for field, kind in (("name", "text"), ("propensity_score", "numeric"), ("last_purchase_date", "date"), ("previously_contacted", "boolean")):
        for operator in sorted(assignment_rules.allowed_operators(kind)):
            if operator in assignment_rules.NULL_OPERATORS: value = None
            elif operator == "in": value = ["Acme", "Beta"]
            elif operator == "between": value = {"numeric": ["0.5", "1"], "date": ["2025-01-01", "2026-01-01"]}[kind]
            elif kind == "boolean": value = True
            else: value = {"text": "Acme", "numeric": "-0.25", "date": "2025-06-30"}[kind]
            conditions.append({"field": field, "operator": operator, "value": value})
    return conditions


def test_frontend_rule_editor_toggle_and_reorder(env):
    conditions = builder_conditions()
    created = env.admin.post("/admin/assignment-rules", json={"name": "Builder", "conditions": conditions, "memberIds": [env.sales_id], "active": True}, headers=ORIGIN)
    assert created.status_code == 201, created.text
    other = create_rule(env)
    saved = env.admin.patch(f"/admin/assignment-rules/{created.json()['id']}", json={"name": "Builder 2", "conditions": conditions, "memberIds": [env.sales_id], "active": False, "version": version(env)}, headers=ORIGIN)
    assert saved.status_code == 200 and len(saved.json()["conditions"]) == len(conditions)
    assert env.admin.patch(f"/admin/assignment-rules/{other['id']}", json={"active": False}, headers=ORIGIN).json()["active"] is False
    current, neighbor = created.json(), other
    first = env.admin.patch(f"/admin/assignment-rules/{current['id']}", json={"order": neighbor["order"], "version": version(env)}, headers=ORIGIN)
    second = env.admin.patch(f"/admin/assignment-rules/{neighbor['id']}", json={"order": current["order"], "version": version(env)}, headers=ORIGIN)
    assert first.status_code == 200 and second.status_code == 200
    assert [rule["id"] for rule in env.admin.get("/admin/assignment-rules").json()] == [neighbor["id"], current["id"]]


def test_inactive_member_blocks_rule_save_until_unchecked(env):
    rule = create_rule(env)
    if main.auth_db is not None: main.auth_db.update_user(env.sales_id, {"active": False})
    main.repo.users[env.sales_id]["active"] = False
    url = f"/admin/assignment-rules/{rule['id']}"
    blocked = env.admin.patch(url, json={"name": "Still", "memberIds": [env.sales_id], "version": version(env)}, headers=ORIGIN)
    assert blocked.status_code == 422 and blocked.json() == {"detail": "Eligible members must be active Sales users."}
