"""#160: cross-IP login detection, strict report/audit dates, the first-Admin provision race,
history-delete rules and DB parameter hiding -- each in memory mode and PostgreSQL mode
(PostgreSQL runs need TEST_DATABASE_URL).

Use --tb=no so even unexpected assertion failures cannot print credentials."""
import logging
import secrets
import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .. import main
from ..db_activity import ActivityDatabase
from ..db_assignment import AssignmentDatabase
from ..db_auth import AuthDatabase
from ..db_customers import CustomerDatabase
from ..db_login_throttle import LoginThrottleStore
from .test_auth_adapters import ORIGIN, migrate, postgres_url  # noqa: F401 -- postgres_url is a fixture

BCN = "000160"
INVALID = {"detail": "Invalid request."}
DB_NAMES = ("auth_db", "customer_db", "assignment_db", "activity_db", "login_throttle_db")


@pytest.fixture(params=["memory", "postgres"])
def store(request, monkeypatch):
    """Empty store in the requested mode, with every adapter (including the shared login throttle) wired."""
    databases = {}
    if request.param == "postgres":
        url = request.getfixturevalue("postgres_url")
        migrate()
        databases = {"auth_db": AuthDatabase(url, create_schema=False), "customer_db": CustomerDatabase(url, create_schema=False), "assignment_db": AssignmentDatabase(url, create_schema=False), "activity_db": ActivityDatabase(url, create_schema=False), "login_throttle_db": LoginThrottleStore(url, create_schema=False)}
    for name in DB_NAMES:
        monkeypatch.setattr(main, name, databases.get(name))
    main.repo.reset(); main.repo.customers.clear()
    try:
        yield SimpleNamespace(mode=request.param, **{name: databases.get(name) for name in DB_NAMES})
    finally:
        for database in databases.values(): database.engine.dispose()
        main.repo.reset()


def new_user(email, role, password):
    return main.provision_user(main.Provision(name=email.split("@")[0], email=email, role=role, password=password))


def signed_in(user, password):
    client = TestClient(main.app, base_url="http://localhost")
    assert client.post("/session/login", json={"email": user.email, "password": password}).status_code == 200
    return client


@pytest.fixture
def env(store):
    password = secrets.token_urlsafe(24)
    admin = new_user("admin160@example.test", "Admin", password)
    owner = new_user("owner160@example.test", "Sales", password)
    other = new_user("other160@example.test", "Sales", password)
    if store.customer_db is not None:
        store.customer_db.upsert_source(bcn=BCN, name="Hardening Co", source={})
        store.customer_db.save_operational(bcn=BCN, owner_id=owner.id, status="Open", version=0)
    else:
        main.repo.customers[BCN] = {"bcn": BCN, "name": "Hardening Co", "ownerId": owner.id, "ownerName": owner.name, "status": "Open", "phones": [], "source": {}, "version": 0, "histories": []}
    clients = SimpleNamespace(admin=signed_in(admin, password), owner=signed_in(owner, password), other=signed_in(other, password), anon=TestClient(main.app, base_url="http://localhost"))
    try:
        yield SimpleNamespace(store=store, clients=clients, admin=admin, owner=owner, other=other)
    finally:
        for client in vars(clients).values(): client.close()


# ---- finding 1: cross-IP login failures -------------------------------------------------------

def login(client, email, password, ip):
    return client.post("/session/login", json={"email": email, "password": password}, headers={"x-real-ip": ip})


def detection_lines(caplog):
    return [record for record in caplog.records if "login.cross_ip_failures" in record.getMessage()]


def test_cross_ip_failures_never_lock_the_account_out(store):
    password = secrets.token_urlsafe(24); wrong = secrets.token_urlsafe(24)
    user = new_user("victim160@example.test", "Sales", password)
    with TestClient(main.app, base_url="http://localhost") as client:
        for index in range(10):
            ip = f"198.51.100.{index + 1}"
            for _ in range(5):
                response = login(client, user.email, wrong, ip)
                assert response.status_code == 401 and response.json() == {"detail": "Unable to sign in."}
            blocked = login(client, user.email, wrong, ip)
            assert blocked.status_code == 429 and blocked.headers["retry-after"] == "900" and blocked.json() == {"detail": "Too many sign-in attempts."}
        ok = login(client, user.email, password, "198.51.100.11")
    assert ok.status_code == 200 and "call_center_session=" in ok.headers["set-cookie"]


@pytest.mark.parametrize("known", [True, False])
def test_cross_ip_failures_log_one_warning_at_twenty(store, caplog, known):
    email = "target160@example.test"; wrong = "Wrong-" + secrets.token_urlsafe(16)
    user = new_user(email, "Sales", secrets.token_urlsafe(24)) if known else None
    with TestClient(main.app, base_url="http://localhost") as client, caplog.at_level(logging.WARNING, logger="call-center.api"):
        for attempt in range(1, 22):
            ip = f"203.0.113.{(attempt - 1) // 5 + 1}"  # 5 per IP: never reaches the per-email+IP 429
            before = len(detection_lines(caplog))
            assert login(client, email, wrong, ip).status_code == 401
            added = detection_lines(caplog)[before:]
            assert len(added) == (1 if attempt == 20 else 0), attempt
            if attempt == 20:
                line = added[0]
                assert line.levelno == logging.WARNING
                assert f"account={user.id if user else 'none'}" in line.getMessage() and "count=20" in line.getMessage()
    assert email not in caplog.text and wrong not in caplog.text and "203.0.113." not in caplog.text


# ---- finding 2: audit/report dates -------------------------------------------------------------

BAD_DATES = ["foo", "2026-02-30", "2026-9-1", "2026-09-24T10:00:00", "24.09.2026", ""]
ROUTES = ["/admin/audit", "/admin/reports"]


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("field", ["start", "end"])
@pytest.mark.parametrize("value", BAD_DATES)
def test_invalid_dates_are_422(env, route, field, value):
    response = env.clients.admin.get(route, params={field: value})
    assert response.status_code == 422 and response.json() == INVALID, response.text
    assert env.clients.anon.get(route, params={field: value}).status_code == 401
    assert env.clients.owner.get(route, params={field: value}).status_code == 403


@pytest.mark.parametrize("route", ROUTES)
def test_reversed_range_is_422_and_equal_bounds_are_fine(env, route):
    assert env.clients.admin.get(route, params={"start": "2026-09-25", "end": "2026-09-24"}).status_code == 422
    assert env.clients.admin.get(route, params={"start": "2026-09-24", "end": "2026-09-24"}).status_code == 200


def test_valid_ranges_filter_inclusively_by_utc_date(env):
    today = datetime.now(timezone.utc).date(); yesterday = (today - timedelta(days=1)).isoformat(); today = today.isoformat()
    assert env.clients.owner.post(f"/customers/{BCN}/interactions", json={"outcome": "Attempt", "submissionId": secrets.token_hex(8)}, headers=ORIGIN).status_code == 200
    admin = env.clients.admin
    daily = lambda **params: {item["date"]: item["attempts"] for item in admin.get("/admin/reports", params=params).json()["daily"]}
    assert daily() == daily(start=today) == daily(end=today) == daily(start=today, end=today) == {today: 1}
    assert daily(end=yesterday) == {}
    total = lambda **params: admin.get("/admin/audit", params=params).json()["total"]
    assert total(start=today, end=today) == total() >= 1
    assert total(end=yesterday) == 0


# ---- finding 3: first-Admin provision race -----------------------------------------------------

@pytest.mark.parametrize("same_email", [False, True])
def test_concurrent_first_admin_provision_creates_one_user(store, monkeypatch, same_email):
    secret = secrets.token_urlsafe(24); monkeypatch.setenv("OPERATOR_PROVISION_SECRET", secret)
    barrier = threading.Barrier(2); results = [None, None]

    def call(index):
        email = "first@example.test" if same_email else f"first{index}@example.test"
        with TestClient(main.app, base_url="http://localhost") as client:
            barrier.wait()
            results[index] = client.post("/operator/provision", json={"name": "First", "email": email, "password": secrets.token_urlsafe(24)}, headers=ORIGIN | {"x-operator-secret": secret})

    threads = [threading.Thread(target=call, args=(index,)) for index in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    assert sorted(response.status_code for response in results) == [200, 409]
    assert next(response for response in results if response.status_code == 409).json() == {"detail": "Initial Admin already provisioned."}
    users = store.auth_db.all_users() if store.auth_db is not None else list(main.repo.users.values())
    assert len(users) == 1


def test_memory_user_ids_do_not_collide_after_removal(store):
    if store.mode != "memory": pytest.skip("memory-mode id scheme")
    first = new_user("a160@example.test", "Sales", secrets.token_urlsafe(24))
    second = new_user("b160@example.test", "Sales", secrets.token_urlsafe(24))
    del main.repo.users[first.id]
    third = new_user("c160@example.test", "Sales", secrets.token_urlsafe(24))
    assert third.id != second.id and len(main.repo.users) == 2


# ---- finding 4: history delete rules -----------------------------------------------------------

def add_note(client):
    response = client.post(f"/customers/{BCN}/notes", json={"text": "Called about renewal", "submissionId": secrets.token_hex(8)}, headers=ORIGIN)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def close(env):
    reason = env.clients.admin.post("/admin/closure-reasons", json={"label": f"Won {secrets.token_hex(3)}"}, headers=ORIGIN).json()
    response = env.clients.owner.post(f"/customers/{BCN}/close", json={"reasonId": reason["id"], "submissionId": secrets.token_hex(8)}, headers=ORIGIN)
    assert response.status_code == 200 and response.json()["status"] == "Closed", response.text


def delete(client, record_id):
    return client.delete(f"/customers/{BCN}/history/{record_id}", headers=ORIGIN)


def assert_history_deleted_audited(env, record_id, audit_calls):
    if env.store.assignment_db is not None:
        items = env.clients.admin.get("/admin/audit", params={"action": "History deleted"}).json()["items"]
        assert [(item["target"], item["details"]) for item in items] == [(BCN, {"recordId": record_id})]
    else:  # memory mode has no audit table; append_audit is the write
        assert audit_calls == [("History deleted", BCN, {"recordId": record_id})]


def spy_audit(monkeypatch):
    calls = []; real = main.append_audit
    monkeypatch.setattr(main, "append_audit", lambda actor, action, target, details: (calls.append((action, target, details)) if action == "History deleted" else None, real(actor, action, target, details)))
    return calls


def test_owner_deletes_history_on_closed_customer(env, monkeypatch):
    record_id = add_note(env.clients.owner); close(env); calls = spy_audit(monkeypatch)
    response = delete(env.clients.owner, record_id)
    assert response.status_code == 200
    body = response.json()
    assert body["deleted"] is True and body["deletedBy"] == env.owner.id
    assert_history_deleted_audited(env, record_id, calls)
    assert delete(env.clients.owner, record_id).json() == body  # idempotent


def test_owner_deletes_entry_written_by_previous_owner(env):
    record_id = add_note(env.clients.owner)
    assert env.clients.admin.post(f"/admin/assignments/manual/{BCN}", json={"ownerId": env.other.id, "submissionId": secrets.token_hex(8)}, headers=ORIGIN).status_code == 200
    if env.store.customer_db is not None: main.repo.customers.pop(BCN, None)  # reload ownership from the store
    response = delete(env.clients.other, record_id)
    assert response.status_code == 200 and response.json()["deletedBy"] == env.other.id


@pytest.mark.parametrize("closed", [False, True])
def test_non_owner_sales_cannot_delete_and_admin_can(env, closed):
    record_id = add_note(env.clients.owner)
    if closed: close(env)
    assert delete(env.clients.other, record_id).status_code == 403
    response = delete(env.clients.admin, record_id)
    assert response.status_code == 200 and response.json()["deletedBy"] == env.admin.id
    assert delete(env.clients.admin, record_id).json() == response.json()


# ---- finding 5: DB parameter hiding ------------------------------------------------------------

@pytest.mark.parametrize("cls", [ActivityDatabase, AssignmentDatabase, CustomerDatabase, AuthDatabase, LoginThrottleStore])
def test_every_engine_hides_parameters(cls):
    database = cls("sqlite:///:memory:", create_schema=False)
    try:
        assert database.engine.hide_parameters is True
    finally:
        database.engine.dispose()


def test_integrity_error_does_not_contain_bound_values():
    database = ActivityDatabase("sqlite:///:memory:")
    marker = "Recognisable-Label-160"
    try:
        with database.engine.begin() as connection:
            connection.execute(text("INSERT INTO closure_reasons (id, label, active) VALUES (:id, :label, true)"), {"id": "reason-160", "label": marker})
        with pytest.raises(IntegrityError) as caught, database.engine.begin() as connection:
            connection.execute(text("INSERT INTO closure_reasons (id, label, active) VALUES (:id, :label, true)"), {"id": "reason-160", "label": marker})
        assert marker not in str(caught.value) and "reason-160" not in str(caught.value)
    finally:
        database.engine.dispose()
