from datetime import datetime, timedelta, timezone
from io import BytesIO
from openpyxl import Workbook

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from .main import app, password_hash, repo, provision_user
from .storage import mode
from .db_auth import AuthDatabase, UserRow, SessionRow, digest
from .db_customers import CustomerDatabase
from .db_assignment import AssignmentDatabase
from .db_activity import ActivityDatabase


def test_login_logout_and_generic_failure() -> None:
    repo.reset()
    provision_user(type("P", (), {"name": "Admin", "email": "admin@example.test", "role": "Admin", "password": "correct horse battery staple"})())
    client = TestClient(app, base_url="http://localhost")
    assert client.post("/session/login", json={"email": "unknown@example.test", "password": "wrong password"}).status_code == 401
    login = client.post("/session/login", json={"email": " ADMIN@example.test ", "password": "correct horse battery staple"})
    assert login.status_code == 200 and login.json()["role"] == "Admin"
    assert client.get("/session/me").status_code == 200
    assert client.post("/session/logout", headers={"origin": "http://localhost:3000"}).status_code == 204
    assert client.get("/session/me").status_code == 401

def test_storage_selection_is_explicit(monkeypatch) -> None:
    monkeypatch.setenv("CALL_CENTER_STORAGE", "postgres"); monkeypatch.delenv("DATABASE_URL", raising=False)
    try: mode(); assert False
    except RuntimeError as exc: assert "DATABASE_URL" in str(exc)

def test_login_failure_throttle_is_generic() -> None:
    repo.reset(); client = TestClient(app, base_url="http://localhost")
    for _ in range(5): assert client.post("/session/login", json={"email": "unknown@example.test", "password": "wrong password"}).status_code == 401
    limited = client.post("/session/login", json={"email": "unknown@example.test", "password": "wrong password"})
    assert limited.status_code == 429 and limited.headers.get("retry-after") == "900" and "unknown@example.test" not in limited.text

def test_database_session_lookup_uses_digest_and_revocation() -> None:
    database = AuthDatabase("sqlite+pysqlite:///:memory:")
    from datetime import datetime, timedelta, timezone
    with Session(database.engine) as session:
        session.add(UserRow(id="u1", name="Admin", email="admin@example.test", role="Admin", active=True, password_hash="hash"))
        session.add(SessionRow(digest=digest("opaque-token"), user_id="u1", issued_at=datetime.now(timezone.utc), expires_at=datetime.now(timezone.utc) + timedelta(hours=1))); session.commit()
    assert database.user_for_session("opaque-token").id == "u1"
    assert database.user_for_session("opaque-token").id == "u1"
    database.revoke("opaque-token"); assert database.user_for_session("opaque-token") is None
    assert "opaque-token" not in {row.digest for row in Session(database.engine).query(SessionRow).all()}

def test_database_customer_upsert_preserves_operational_owner() -> None:
    database = CustomerDatabase("sqlite+pysqlite:///:memory:")
    first = database.upsert_source(bcn="000123", name="Original", source={"score": 1}, primary_phone="555")
    with Session(database.engine) as session:
        stored = session.get(type(first), "000123"); stored.owner_id = "sales-river"; stored.status = "Closed"; session.commit()
    second = database.upsert_source(bcn="000123", name="Imported", source={"score": 2}, primary_phone="777")
    assert second.name == "Imported" and second.owner_id == "sales-river" and second.status == "Closed"

def test_assignment_configuration_and_run_are_admin_only() -> None:
    repo.reset(); admin = provision_user(type("P", (), {"name": "Admin", "email": "admin@example.test", "role": "Admin", "password": "correct horse battery staple"})()); repo.users["sales-river"] = {"id": "sales-river", "name": "River Sales", "email": "river@example.test", "role": "Sales", "active": True, "password": "unused"}
    client = TestClient(app, base_url="http://localhost"); client.post("/session/login", json={"email": admin.email, "password": "correct horse battery staple"})
    created = client.post("/admin/assignment-rules", json={"name": "River", "ownerId": "sales-river"}, headers={"origin": "http://localhost:3000"})
    assert created.status_code == 201
    assert client.put("/admin/assignment-fallback", json=["sales-river"], headers={"origin": "http://localhost:3000"}).json() == ["sales-river"]
    result = client.post("/admin/assignment-runs", json={"scope": "unassigned", "submissionId": "run-1"}, headers={"origin": "http://localhost:3000"})
    assert result.status_code == 200 and result.json()["assigned"] == 1

def test_assignment_database_keeps_ordered_rules_and_audit() -> None:
    database = AssignmentDatabase("sqlite+pysqlite:///:memory:")
    database.create_rule(rule_id="r2", name="Second", position=2, actor_id="admin")
    database.create_rule(rule_id="r1", name="First", position=1, actor_id="admin")
    assert [row.id for row in database.ordered_rules()] == ["r1", "r2"]
    events, total = database.audit(); assert total == 2 and len(events) == 2

def test_activity_idempotency_replays_and_rejects_payload_reuse() -> None:
    database = ActivityDatabase("sqlite+pysqlite:///:memory:")
    assert database.save_idempotent(actor_id="u1", operation="note", submission_id="s1", payload="hello", result={"id": "n1"}) == {"id": "n1"}
    assert database.save_idempotent(actor_id="u1", operation="note", submission_id="s1", payload="hello", result={"id": "ignored"}) == {"id": "n1"}
    try: database.save_idempotent(actor_id="u1", operation="note", submission_id="s1", payload="different", result={})
    except ValueError as exc: assert "already used" in str(exc)
    else: assert False


def test_expired_session_is_rejected() -> None:
    repo.reset()
    user = provision_user(type("P", (), {"name": "Admin", "email": "admin@example.test", "role": "Admin", "password": "correct horse battery staple"})())
    repo.sessions["expired"] = (user.id, datetime.now(timezone.utc) - timedelta(seconds=1))
    client = TestClient(app); client.cookies.set("call_center_session", "expired")
    assert client.get("/session/me").status_code == 401


def test_foreign_origin_is_rejected_before_mutation() -> None:
    repo.reset(); client = TestClient(app)
    assert client.post("/session/logout", headers={"origin": "https://foreign.example"}).status_code == 403


def test_memory_unit_of_work_rolls_back_auth_state() -> None:
    repo.reset()
    try:
        with repo.transaction():
            provision_user(type("P", (), {"name": "Transient", "email": "transient@example.test", "role": "Admin", "password": "correct horse battery staple"})())
            raise RuntimeError("rollback")
    except RuntimeError:
        pass
    assert repo.users == {}


def test_operator_provision_and_recovery_revoke_session() -> None:
    repo.reset(); client = TestClient(app, base_url="http://localhost"); headers = {"origin": "http://localhost:3000"}
    provision = client.post("/operator/provision", json={"name": "Initial Admin", "email": "admin@example.test", "role": "Admin", "password": "correct horse battery staple"}, headers=headers)
    assert provision.status_code == 200 and "password" not in provision.json()
    login = client.post("/session/login", json={"email": "admin@example.test", "password": "correct horse battery staple"}); assert login.status_code == 200
    recovered = client.post(f"/operator/reset-password/{provision.json()['id']}", json={"password": "new correct horse battery staple"}, headers=headers)
    assert recovered.status_code == 200 and "password" not in recovered.json()
    assert client.get("/session/me").status_code == 401
    assert client.post("/operator/provision", json={"name": "Second", "email": "second@example.test", "role": "Admin", "password": "correct horse battery staple"}, headers=headers).status_code == 409


def test_password_bounds_and_inactive_users_have_safe_failures() -> None:
    repo.reset(); provision_user(type("P", (), {"name": "Inactive", "email": "inactive@example.test", "role": "Sales", "password": "correct horse battery staple"})()); repo.users["user-1"]["active"] = False
    client = TestClient(app, base_url="http://localhost")
    assert client.post("/session/login", json={"email": "inactive@example.test", "password": "correct horse battery staple"}).status_code == 401
    short = client.post("/session/login", json={"email": "inactive@example.test", "password": "short"})
    assert short.status_code == 422 and "short" not in short.text


def test_customer_reads_and_admin_assignment() -> None:
    repo.reset(); admin = provision_user(type("P", (), {"name": "Admin", "email": "admin@example.test", "role": "Admin", "password": "correct horse battery staple"})()); repo.users["sales-river"] = {"id": "sales-river", "name": "River Sales", "email": "river@example.test", "role": "Sales", "active": True, "password": "unused"}
    client = TestClient(app, base_url="http://localhost"); client.post("/session/login", json={"email": admin.email, "password": "correct horse battery staple"})
    assert client.get("/customers/000123").status_code == 200
    changed = client.post("/admin/assignments/manual/000125", json={"ownerId": "sales-river", "submissionId": "assign-1"}, headers={"origin": "http://localhost:3000"})
    assert changed.status_code == 200 and changed.json()["ownerId"] == "sales-river"
    assert client.post("/admin/assignments/manual/000125", json={"ownerId": "sales-river", "submissionId": "assign-1"}, headers={"origin": "http://localhost:3000"}).status_code == 200
    assert client.post("/admin/assignments/manual/000125", json={"ownerId": None, "submissionId": "assign-1"}, headers={"origin": "http://localhost:3000"}).status_code == 409
    assert client.post("/admin/assignments/manual/000125", json={"ownerId": None, "submissionId": "assign-2", "expectedVersion": 0}, headers={"origin": "http://localhost:3000"}).status_code == 409
    assert client.post("/admin/assignments/manual/000125", json={"ownerId": "missing", "submissionId": "assign-3"}, headers={"origin": "http://localhost:3000"}).status_code == 422
    assert client.get("/customers/missing").status_code == 404


def test_sales_my_scope_cannot_be_widened_and_reads_are_paginated() -> None:
    repo.reset(); provision_user(type("P", (), {"name": "Admin", "email": "admin@example.test", "role": "Admin", "password": "correct horse battery staple"})()); repo.users["sales-river"] = {"id": "sales-river", "name": "River Sales", "email": "river@example.test", "role": "Sales", "active": True, "password": password_hash.hash("correct horse battery staple")}
    client = TestClient(app, base_url="http://localhost"); client.post("/session/login", json={"email": "river@example.test", "password": "correct horse battery staple"})
    scoped = client.get("/customers", params={"mine": "true", "page_size": 1}); assert scoped.status_code == 200 and scoped.json()["total"] == 1 and scoped.json()["items"][0]["bcn"] == "000123"
    assert client.get("/customers", params={"mine": "true", "owner": "sales-sky"}).json()["total"] == 0
    assert client.get("/customers", params={"page": 0}).status_code == 422

def test_admin_xlsx_import_preserves_assignment_and_is_idempotent() -> None:
    repo.reset(); admin = provision_user(type("P", (), {"name": "Admin", "email": "admin@example.test", "role": "Admin", "password": "correct horse battery staple"})())
    client = TestClient(app, base_url="http://localhost"); client.post("/session/login", json={"email": admin.email, "password": "correct horse battery staple"})
    workbook = Workbook(); sheet = workbook.active; sheet.append(["bcn", "customer_name", "phone"]); sheet.append(["000123", "Renamed", "555-0001"]); sheet.append(["009999", "New Co", None]); payload = BytesIO(); workbook.save(payload); payload.seek(0)
    response = client.post("/admin/imports?submission_id=job-1", files={"file": ("customers.xlsx", payload.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}, headers={"origin": "http://localhost:3000"})
    assert response.status_code == 201 and response.json()["processed"] == 2 and response.json()["created"] == 1
    assert client.get("/customers/000123").json()["ownerId"] == "sales-river"
    assert client.post("/admin/imports?submission_id=job-1", files={"file": ("customers.xlsx", payload.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}, headers={"origin": "http://localhost:3000"}).json()["jobId"] == response.json()["jobId"]
