"""Shared auth contract plus isolated, migration-managed PostgreSQL acceptance checks.

Use --tb=no so even unexpected assertion failures cannot print credentials.
"""
import os
import secrets
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from datetime import date
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import main, db_auth
from .db_auth import AuthDatabase, SessionRow, UserRow, digest, StorageError

ORIGIN = {"origin": "http://localhost:3000"}


def test_history_delete_is_atomic_authorized_and_idempotent(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from .db_activity import ActivityDatabase, ActivityRow
    from .db_assignment import AssignmentDatabase, AuditRow
    from .db_customers import CustomerDatabase

    url = f"sqlite+pysqlite:///{tmp_path / 'delete.db'}"
    activities = ActivityDatabase(url)
    assignments = AssignmentDatabase(url)
    customers = CustomerDatabase(url)
    monkeypatch.setattr(main, "activity_db", activities)
    monkeypatch.setattr(main, "assignment_db", assignments)
    monkeypatch.setattr(main, "customer_db", customers)
    main.repo.reset()
    try:
        customers.upsert_source(bcn="000001", name="Synthetic", source={})
        customers.save_operational(bcn="000001", owner_id="sales", status="Open", version=0)
        activities.save_activity(record_id="note", bcn="000001", actor_id="sales", kind="Standalone note", outcome=None, text="Synthetic note")
        main.repo.customers.clear()
        actor = main.User(id="sales", name="Sales", email="sales@example.test", role="Sales")
        with pytest.raises(HTTPException) as forbidden:
            main.delete_history("000001", "note", actor.model_copy(update={"id": "other"}))
        assert forbidden.value.status_code == 403 and main.repo.customers == {}
        def fail_commit(session):
            if session.bind is activities.engine:
                session.flush()
                raise RuntimeError("Injected failure")
        event.listen(Session, "before_commit", fail_commit)
        try:
            with pytest.raises(RuntimeError, match="Injected failure"):
                main.delete_history("000001", "note", actor)
        finally:
            event.remove(Session, "before_commit", fail_commit)
        assert main.repo.customers == {}
        with Session(activities.engine) as session:
            assert session.get(ActivityRow, "note").deleted_at is None
            assert session.scalar(select(AuditRow)) is None
        result = main.delete_history("000001", "note", actor)
        assert result["deleted"] is True and result["deletedBy"] == actor.id
        assert main.repo.customers["000001"]["histories"][0]["deleted"] is True
        main.repo.customers.clear()
        assert main.delete_history("000001", "note", actor.model_copy(update={"id": "admin", "role": "Admin"})) == result
        with Session(activities.engine) as session:
            assert session.get(ActivityRow, "note").deleted_by == actor.id
            assert len(list(session.scalars(select(AuditRow)))) == 1
    finally:
        for database in (activities, assignments, customers): database.engine.dispose()
        main.repo.reset()


@pytest.mark.parametrize("operation", ["followup", "interaction", "note"])
def test_activity_creation_is_atomic_and_replays(operation, tmp_path, monkeypatch):
    from fastapi import HTTPException
    from .db_activity import ActivityDatabase, FollowUpRow, ActivityRow, IdempotencyRow
    from .db_customers import CustomerDatabase
    from .db_assignment import AssignmentDatabase, AuditRow

    url = f"sqlite+pysqlite:///{tmp_path / 'followup.db'}"
    activities = ActivityDatabase(url)
    customers = CustomerDatabase(url)
    assignments = AssignmentDatabase(url)
    monkeypatch.setattr(main, "activity_db", activities)
    monkeypatch.setattr(main, "customer_db", customers)
    monkeypatch.setattr(main, "assignment_db", assignments)
    main.repo.reset()
    try:
        customers.upsert_source(bcn="000001", name="Synthetic", source={})
        customers.save_operational(bcn="000001", owner_id="sales", status="Open", version=0)
        main.repo.customers.clear()
        actor = main.User(id="sales", name="Sales", email="sales@example.test", role="Sales")
        create, body, cache, tables = {
            "followup": (main.create_followup, main.FollowUpCreate(type="Reminder", due=None, note="Synthetic reminder", submissionId="create"), main.repo.followups, (FollowUpRow, ActivityRow, IdempotencyRow)),
            "interaction": (main.create_interaction, main.InteractionCreate(outcome="Contact", note="Synthetic contact", submissionId="create"), main.repo.interactions, (ActivityRow, IdempotencyRow, AuditRow)),
            "note": (main.create_note, main.NoteCreate(text="Synthetic note", submissionId="create"), main.repo.notes, (ActivityRow, IdempotencyRow, AuditRow)),
        }[operation]
        def fail_commit(session):
            if session.bind is activities.engine:
                session.flush()
                raise RuntimeError("Injected failure")
        event.listen(Session, "before_commit", fail_commit)
        try:
            with pytest.raises(RuntimeError, match="Injected failure"):
                create("000001", body, actor)
        finally:
            event.remove(Session, "before_commit", fail_commit)
        assert main.repo.customers == {} and cache == {}
        with Session(activities.engine) as session:
            assert all(session.scalar(select(table)) is None for table in tables)
        result = create("000001", body, actor)
        assert create("000001", body, actor) == result
        with pytest.raises(HTTPException) as conflict:
            create("000001", body.model_copy(update={"text" if operation == "note" else "note": "Different content"}), actor)
        assert conflict.value.status_code == 409
        assert len(cache) == 1 and len(main.repo.customers["000001"]["histories"]) == 1
        with Session(activities.engine) as session:
            assert all(len(list(session.scalars(select(table)))) == 1 for table in tables)
        with pytest.raises(HTTPException) as forbidden:
            create("000001", body, actor.model_copy(update={"id": "other"}))
        assert forbidden.value.status_code == 403
        main.repo.customers["000001"]["status"] = "Closed"
        with pytest.raises(HTTPException) as closed:
            create("000001", body.model_copy(update={"submissionId": "closed"}), actor)
        assert closed.value.status_code == 409
    finally:
        activities.engine.dispose(); customers.engine.dispose(); assignments.engine.dispose()
        main.repo.reset()


def test_rule_updates_compare_persisted_version_and_rollback(tmp_path, monkeypatch):
    from copy import deepcopy
    from fastapi import HTTPException
    from .db_assignment import AssignmentDatabase

    database = AssignmentDatabase(f"sqlite+pysqlite:///{tmp_path / 'rules.db'}")
    monkeypatch.setattr(main, "assignment_db", database)
    main.repo.reset()
    try:
        database.create_rule(rule_id="rule", name="Original", position=1, actor_id="admin")
        database.set_setting("assignment_version", {"value": 2})
        main.repo.rules = [{"id": "rule", "name": "Original", "order": 1, "ownerId": None, "active": True}]
        main.repo.assignment_version = 2
        actor = main.User(id="admin", name="Admin", email="admin@example.test", role="Admin")
        # Another request wins after this process cached configuration version 2.
        database.update_rule("rule", {"name": "Winner"}, actor.id, 2)
        before = deepcopy(main.repo.rules)
        with pytest.raises(HTTPException) as stale:
            main.update_assignment_rule("rule", {"name": "Loser", "version": 2}, actor)
        assert stale.value.status_code == 409
        assert main.repo.rules == before and main.repo.assignment_version == 2
        assert database.ordered_rules()[0].name == "Winner" and database.get_setting("assignment_version") == {"value": 3}
        assert database.audit()[1] == 2
        result = main.update_assignment_rule("rule", {"active": False, "version": 3}, actor)
        assert result["name"] == "Winner" and result["active"] is False
        assert main.repo.assignment_version == 4
        before = deepcopy(main.repo.rules)
        def fail_commit(session):
            if session.bind is database.engine:
                session.flush()
                raise RuntimeError("Injected failure")
        event.listen(Session, "before_commit", fail_commit)
        try:
            with pytest.raises(RuntimeError, match="Injected failure"):
                main.update_assignment_rule("rule", {"name": "Rolled back", "version": 4}, actor)
        finally:
            event.remove(Session, "before_commit", fail_commit)
        assert main.repo.rules == before and main.repo.assignment_version == 4
        assert database.ordered_rules()[0].name == "Winner" and database.get_setting("assignment_version") == {"value": 4}
        assert database.audit()[1] == 3
    finally:
        database.engine.dispose()
        main.repo.reset()


def test_manual_assignment_commit_and_rollback(tmp_path, monkeypatch):
    from .db_assignment import AssignmentDatabase, AssignmentHistoryRow, AuditRow
    from .db_customers import CustomerDatabase
    from fastapi import HTTPException

    url = f"sqlite+pysqlite:///{tmp_path / 'manual.db'}"
    customers = CustomerDatabase(url)
    assignments = AssignmentDatabase(url)
    monkeypatch.setattr(main, "customer_db", customers)
    monkeypatch.setattr(main, "assignment_db", assignments)
    monkeypatch.setattr(main, "activity_db", None)
    main.repo.reset()
    try:
        customers.upsert_source(bcn="000001", name="Synthetic", source={})
        main.repo.customers.clear()
        main.repo.users["sales"] = {"id": "sales", "name": "Sales", "role": "Sales", "active": True}
        actor = main.User(id="admin", name="Admin", email="admin@example.test", role="Admin")
        body = main.AssignmentRequest(ownerId="sales", expectedVersion=0, submissionId="manual")
        def fail_commit(session):
            if session.bind is assignments.engine:
                session.flush()
                raise RuntimeError("Injected failure")
        event.listen(Session, "before_commit", fail_commit)
        try:
            with pytest.raises(RuntimeError, match="Injected failure"):
                main.assign_customer("000001", body, actor)
        finally:
            event.remove(Session, "before_commit", fail_commit)
        assert main.repo.customers == {} and main.repo.submissions == {}
        assert customers.get("000001").owner_id is None and customers.get("000001").version == 0
        with Session(assignments.engine) as session:
            assert session.scalar(select(AssignmentHistoryRow)) is None and session.scalar(select(AuditRow)) is None
        result = main.assign_customer("000001", body, actor)
        assert result.ownerId == "sales" and result.version == 1
        assert main.assign_customer("000001", body, actor) == result
        unchanged = main.assign_customer("000001", main.AssignmentRequest(ownerId="sales", expectedVersion=1, submissionId="unchanged"), actor)
        assert unchanged == result
        with pytest.raises(HTTPException) as stale:
            main.assign_customer("000001", main.AssignmentRequest(ownerId=None, expectedVersion=0, submissionId="stale"), actor)
        assert stale.value.status_code == 409
        assert customers.get("000001").owner_id == "sales" and customers.get("000001").version == 1
        with Session(assignments.engine) as session:
            assert len(list(session.scalars(select(AssignmentHistoryRow)))) == 1
            assert len(list(session.scalars(select(AuditRow)))) == 1
    finally:
        customers.engine.dispose(); assignments.engine.dispose()
        main.repo.reset()


@pytest.mark.parametrize("changes", [{"active": False}, {"role": "Admin"}])
def test_owner_identity_change_rolls_back_and_releases_only_open(changes, tmp_path, monkeypatch):
    from copy import deepcopy
    from fastapi import HTTPException
    from .db_assignment import AssignmentDatabase, AssignmentHistoryRow, AuditRow
    from .db_customers import CustomerDatabase

    url = f"sqlite+pysqlite:///{tmp_path / 'owner.db'}"
    auth = AuthDatabase(url)
    customers = CustomerDatabase(url)
    assignments = AssignmentDatabase(url)
    for name, database in (("auth_db", auth), ("customer_db", customers), ("assignment_db", assignments)):
        monkeypatch.setattr(main, name, database)
    main.repo.reset()
    try:
        auth.create_user(user_id="sales", name="Sales", email="sales@example.test", role="Sales", password_hash=main.password_hash.hash(secrets.token_urlsafe(24)))
        token, expires = auth.issue("sales")
        main.repo.users = {"sales": {"id": "sales", "name": "Sales", "email": "sales@example.test", "role": "Sales", "active": True}}
        main.repo.sessions[token] = ("sales", expires)
        main.repo.customers = {}
        for bcn, status in (("000001", "Open"), ("000002", "Closed")):
            customers.upsert_source(bcn=bcn, name="Synthetic", source={})
            customers.save_operational(bcn=bcn, owner_id="sales", status=status, version=3)
            main.repo.customers[bcn] = {"bcn": bcn, "ownerId": "sales", "ownerName": "Sales", "status": status, "version": 3, "histories": []}
        before = deepcopy((main.repo.users, main.repo.customers, main.repo.sessions))
        actor = main.User(id="admin", name="Admin", email="admin@example.test", role="Admin")
        def fail_commit(session):
            if session.bind is assignments.engine:
                session.flush()
                raise RuntimeError("Injected failure")
        event.listen(Session, "before_commit", fail_commit)
        try:
            with pytest.raises(RuntimeError, match="Injected failure"):
                main.update_user("sales", main.UserPatch(**changes), actor)
        finally:
            event.remove(Session, "before_commit", fail_commit)
        assert before == (main.repo.users, main.repo.customers, main.repo.sessions)
        assert auth.user_for_session(token).active
        assert auth.user_by_email("sales@example.test").role == "Sales"
        assert all(row.owner_id == "sales" and row.version == 3 for row in customers.all())
        with Session(assignments.engine) as session:
            assert session.scalar(select(AssignmentHistoryRow)) is None and session.scalar(select(AuditRow)) is None
        main.update_user("sales", main.UserPatch(**changes), actor)
        assert auth.user_for_session(token) is None and token not in main.repo.sessions
        assert customers.get("000001").owner_id is None and customers.get("000001").version == 4
        assert customers.get("000002").owner_id == "sales" and customers.get("000002").version == 3
        assert main.repo.customers["000001"]["ownerId"] is None and main.repo.customers["000002"]["ownerId"] == "sales"
        with Session(assignments.engine) as session:
            assert len(list(session.scalars(select(AssignmentHistoryRow)))) == 1
            assert len(list(session.scalars(select(AuditRow)))) == 2
        with pytest.raises(HTTPException) as blocked:
            main.update_user("sales", main.UserPatch(active=False), main.User(**main.repo.users["sales"]))
        assert blocked.value.status_code == 422
    finally:
        for database in (auth, customers, assignments): database.engine.dispose()
        main.repo.reset()


@pytest.mark.parametrize("backend", ["sqlite", "postgres"])
def test_bulk_assignment_atomic_rollback_and_retry(backend, request, tmp_path, monkeypatch):
    from .db_assignment import AssignmentDatabase, AssignmentHistoryRow, AssignmentRunRow, AuditRow
    from .db_customers import CustomerDatabase
    from fastapi import HTTPException

    url = request.getfixturevalue("postgres_url") if backend == "postgres" else f"sqlite+pysqlite:///{tmp_path / 'bulk.db'}"
    if backend == "postgres": migrate()
    auth = AuthDatabase(url, create_schema=backend == "sqlite")
    customers = CustomerDatabase(url, create_schema=backend == "sqlite")
    assignments = AssignmentDatabase(url, create_schema=backend == "sqlite")
    monkeypatch.setattr(main, "customer_db", customers)
    monkeypatch.setattr(main, "assignment_db", assignments)
    main.repo.reset()
    try:
        hashed = main.password_hash.hash(secrets.token_urlsafe(24))
        for user_id, role in (("admin", "Admin"), ("sales", "Sales")):
            auth.create_user(user_id=user_id, name=user_id, email=user_id + "@example.test", role=role, password_hash=hashed)
            main.repo.users[user_id] = {"id": user_id, "name": user_id, "role": role, "active": True}
        for bcn in ("000002", "000001"):
            customers.upsert_source(bcn=bcn, name="Synthetic", source={})
        main.repo.customers = {"000001": {"bcn": "000001", "ownerId": None, "version": 0}}
        main.repo.fallback_sales = ["sales"]
        actor = main.User(id="admin", name="admin", email="admin@example.test", role="Admin")
        body = main.AssignmentRunRequest(scope="unassigned", submissionId="atomic")
        def fail_commit(session):
            if session.bind is assignments.engine:
                session.flush()
                raise RuntimeError("Injected failure")
        event.listen(Session, "before_commit", fail_commit)
        try:
            with pytest.raises(RuntimeError, match="Injected failure"):
                main.run_assignment(body, actor)
        finally:
            event.remove(Session, "before_commit", fail_commit)
        assert all(row.owner_id is None and row.version == 0 for row in customers.all())
        assert main.repo.customers["000001"]["ownerId"] is None and main.repo.assignment_runs == {}
        with Session(assignments.engine) as session:
            assert all(session.scalar(select(table)) is None for table in (AssignmentHistoryRow, AuditRow, AssignmentRunRow))
        result = main.run_assignment(body, actor)
        assert result["assigned"] == 2
        assert main.repo.customers["000001"]["ownerId"] == "sales"
        assert main.run_assignment(body, actor) == result
        with pytest.raises(HTTPException) as conflict:
            main.run_assignment(main.AssignmentRunRequest(scope="all-open", submissionId="atomic"), actor)
        assert conflict.value.status_code == 409
        assert all(row.owner_id == "sales" and row.version == 1 for row in customers.all())
        with Session(assignments.engine) as session:
            assert len(list(session.scalars(select(AssignmentHistoryRow)))) == 2
            assert len(list(session.scalars(select(AuditRow)))) == 2
            assert len(list(session.scalars(select(AssignmentRunRow)))) == 1
    finally:
        for database in (auth, customers, assignments): database.engine.dispose()
        main.repo.reset()


@pytest.fixture
def postgres_url(monkeypatch):
    raw = os.getenv("TEST_DATABASE_URL")
    if not raw:
        pytest.skip("TEST_DATABASE_URL required for real PostgreSQL checks")
    url = make_url(raw)
    if url.get_backend_name() != "postgresql" or not (url.database or "").endswith(("_test", "_ci")):
        pytest.fail("Use a dedicated PostgreSQL database ending in _test or _ci", pytrace=False)
    engine = create_engine(url, hide_parameters=True)
    schema = "auth_test_" + uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = url.update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(hide_password=False)
    monkeypatch.setenv("DATABASE_URL", isolated)
    try:
        yield isolated
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()


def migrate(revision="head"):
    command.upgrade(Config("apps/api/alembic.ini"), revision)


@pytest.fixture(params=["memory", "postgres"])
def adapter(request, monkeypatch):
    database = None
    if request.param == "postgres":
        url = request.getfixturevalue("postgres_url")
        migrate()
        database = AuthDatabase(url, create_schema=False)
    main.repo.reset()
    monkeypatch.setattr(main, "auth_db", database)
    for name in ("customer_db", "assignment_db", "activity_db"):
        monkeypatch.setattr(main, name, None)
    try:
        yield database
    finally:
        if database:
            assert database.engine.pool.checkedout() == 0
            database.engine.dispose()
        main.repo.reset()


def provision(email="admin@example.test", role="Admin", password=None):
    secret = password or secrets.token_urlsafe(24)
    user = main.provision_user(main.Provision(name="Synthetic", email=email, role=role, password=secret))
    return user, secret


def sign_in(client, email, secret):
    return client.post("/session/login", json={"email": email, "password": secret})


def test_shared_identity_validation_and_safe_failures(adapter):
    user, secret = provision("  STRAẞE@example.test  ")
    assert user.email == "strasse@example.test"
    with pytest.raises(ValueError, match="normalized identity already exists"):
        provision(" STRASSE@EXAMPLE.TEST ")
    with TestClient(main.app, base_url="http://localhost") as client:
        unknown = sign_in(client, "unknown@example.test", secrets.token_urlsafe(24))
        wrong = sign_in(client, user.email, secrets.token_urlsafe(24))
        if adapter:
            adapter.update_user(user.id, {"active": False})
        else:
            main.repo.users[user.id]["active"] = False
        inactive = sign_in(client, user.email, secret)
        assert all(response.status_code == 401 for response in (unknown, wrong, inactive))
        assert unknown.json() == wrong.json() == inactive.json() == {"detail": "Unable to sign in."}
        assert all("set-cookie" not in response.headers for response in (unknown, wrong, inactive))
        for payload in ({"email": "x" * 255, "password": secret}, {"email": user.email, "password": "x" * 11}, {"email": user.email, "password": "x" * 129}, {"email": [], "password": secret}):
            response = client.post("/session/login", json=payload)
            assert response.status_code == 422 and response.json() == {"detail": "Invalid request."}
    with pytest.raises(ValueError):
        provision("short@example.test", password=secrets.token_hex(5))


def test_shared_password_boundaries_and_transport(adapter, caplog):
    for length in (12, 128):
        secret = " " + secrets.token_hex(100)[:length - 3] + "界 "
        user, _ = provision(f"length-{length}@example.test", password=secret)
        with TestClient(main.app, base_url="https://api.example.test") as client:
            response = sign_in(client, user.email, secret)
            assert response.status_code == 200
            assert set(response.json()) == {"id", "name", "email", "role", "active"}
            cookie = response.headers["set-cookie"].lower()
            assert all(value in cookie for value in ("httponly", "secure", "samesite=lax", "path=/", "max-age=28800"))
            token = client.cookies.get("call_center_session")
            assert secret not in response.text and token not in response.text
            assert client.post("/session/logout").status_code == 403
            assert client.post("/session/logout", headers={"origin": "https://foreign.example"}).status_code == 403
            assert client.post("/session/logout", headers={"referer": "http://localhost:3000/settings"}).status_code == 204
            assert secret not in caplog.text and token not in caplog.text
        with TestClient(main.app, base_url="http://localhost") as client:
            response = client.options("/session/me", headers={"origin": "http://localhost:3000", "access-control-request-method": "GET"})
            assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
            assert response.headers["access-control-allow-credentials"] == "true"
            response = client.options("/session/me", headers={"origin": "http://localhost:3000.evil.test", "access-control-request-method": "GET"})
            assert "access-control-allow-origin" not in response.headers


def test_shared_session_clock_logout_recovery_and_role(adapter, monkeypatch):
    clock = [datetime(2030, 1, 1, tzinfo=timezone.utc)]
    monkeypatch.setattr(main, "utcnow", lambda: clock[0])
    monkeypatch.setattr(db_auth, "utcnow", lambda: clock[0])
    user, secret = provision()
    with TestClient(main.app, base_url="http://localhost") as client:
        assert sign_in(client, user.email, secret).status_code == 200
        clock[0] += timedelta(hours=8) - timedelta(microseconds=1)
        assert client.get("/session/me").status_code == 200
        clock[0] += timedelta(microseconds=1)
        assert client.get("/session/me").status_code == 401
        assert client.post("/admin/users", headers=ORIGIN, json={"name": "Other", "email": "other@example.test", "password": secret}).status_code == 401
        assert sign_in(client, user.email, secret).status_code == 200
        response = client.post("/session/logout", headers=ORIGIN)
        assert response.status_code == 204 and "Max-Age=0" in response.headers["set-cookie"]
        assert client.get("/session/me").status_code == 401
        assert client.post("/session/logout", headers=ORIGIN).status_code == 204
        assert sign_in(client, user.email, secret).status_code == 200
        new_secret = secrets.token_urlsafe(24)
        main.operator_reset_password(user.id, main.ResetPassword(password=new_secret))
        assert client.get("/session/me").status_code == 401
        assert sign_in(client, user.email, secret).status_code == 401
        assert sign_in(client, user.email, new_secret).status_code == 200
        if adapter:
            adapter.update_user(user.id, {"role": "Sales"})
        else:
            main.repo.users[user.id]["role"] = "Sales"
        assert client.get("/admin/users").status_code in (401, 403)
        assert sign_in(client, user.email, new_secret).json()["role"] == "Sales"
        if adapter:
            adapter.update_user(user.id, {"active": False})
        else:
            main.repo.users[user.id]["active"] = False
        assert client.get("/session/me").status_code == 401


def test_postgres_migrations_constraints_and_rollback(postgres_url, monkeypatch):
    migrate("008_assignment_settings")
    migrate()
    migrate()
    database = AuthDatabase(postgres_url, create_schema=False)
    secret = secrets.token_urlsafe(24)
    hashed = main.password_hash.hash(secret)
    kwargs = dict(user_id="persisted", name="Synthetic", email="persisted@example.test", role="Admin", password_hash=hashed)
    database.create_user(**kwargs)
    token, _ = database.issue("persisted")
    with database.transaction() as session:
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == main.ALEMBIC_HEAD
        stored = session.get(SessionRow, digest(token))
        assert stored.digest != token and stored.digest == digest(token)
    # Actual PostgreSQL constraint violations, each rolled back independently.
    for changes in ({"role": "Other"}, {"email": " Upper@example.test "}, {"email": "straße@example.test"}, {"email": "\ttrim@example.test\n"}, {"password_hash": secrets.token_urlsafe(24)}, {"name": " "}, {"active": None}):
        row = dict(id=uuid4().hex, name="Synthetic", email=uuid4().hex + "@example.test", role="Admin", active=True, password_hash=hashed) | changes
        with pytest.raises(IntegrityError):
            with Session(database.engine) as session, session.begin():
                session.execute(UserRow.__table__.insert().values(**row))
    now = datetime.now(timezone.utc)
    for changes in ({"digest": secrets.token_urlsafe(24)}, {"user_id": "missing"}, {"expires_at": now}, {"revoked_at": now - timedelta(seconds=1)}):
        row = dict(digest=digest(secrets.token_urlsafe(24)), user_id="persisted", issued_at=now, expires_at=now + timedelta(hours=8)) | changes
        with pytest.raises(IntegrityError):
            with Session(database.engine) as session, session.begin():
                session.add(SessionRow(**row)); session.flush()
    barrier = Barrier(2)
    def create_same(index):
        barrier.wait()
        try:
            database.create_user(**(kwargs | {"user_id": f"race-{index}", "email": (" Race@Example.Test " if index else "race@example.test")}))
            return "created"
        except ValueError as exc:
            assert str(exc) == "normalized identity already exists"
            return "conflict"
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(create_same, range(2))) == ["conflict", "created"]
    assert len([user for user in database.all_users() if user.email == "race@example.test"]) == 1
    def fail_before_commit(session):
        if session.bind is database.engine:
            raise RuntimeError("Injected failure")
    event.listen(Session, "before_commit", fail_before_commit)
    try:
        with pytest.raises(RuntimeError, match="Injected failure"):
            database.create_user(**(kwargs | {"user_id": "rolled-back", "email": "rollback@example.test"}))
        with pytest.raises(RuntimeError, match="Injected failure"):
            database.reset_password("persisted", main.password_hash.hash(secrets.token_urlsafe(24)))
    finally:
        event.remove(Session, "before_commit", fail_before_commit)
    assert database.user_by_email("rollback@example.test") is None
    assert database.user_by_email("persisted@example.test").password_hash == hashed
    assert database.user_for_session(token).id == "persisted"
    before = len(database.all_users())
    assert database.reset_password("missing", hashed) is None
    assert len(database.all_users()) == before and database.user_for_session(token).id == "persisted"
    # UoW rollback includes identity and session rows in the same transaction.
    with pytest.raises(RuntimeError, match="Injected failure"):
        with database.transaction() as session:
            session.get(UserRow, "persisted").name = "Changed"
            session.get(SessionRow, digest(token)).revoked_at = now
            session.flush()
            raise RuntimeError("Injected failure")
    assert database.user_by_email("persisted@example.test").name == "Synthetic"
    assert database.user_for_session(token).id == "persisted"
    def unavailable(*args):
        from sqlalchemy.exc import OperationalError
        raise OperationalError("private connection", {}, Exception(secrets.token_urlsafe(24)))
    event.listen(database.engine, "before_cursor_execute", unavailable)
    try:
        with pytest.raises(StorageError, match=r"^Storage operation failed\.$"):
            database.all_users()
        monkeypatch.setattr(main, "auth_db", database)
        with TestClient(main.app, base_url="http://localhost") as client:
            response = client.get("/session/me")
            assert response.status_code == 503 and response.json() == {"detail": "Storage operation failed."}
    finally:
        event.remove(database.engine, "before_cursor_execute", unavailable)
    assert database.engine.pool.checkedout() == 0
    database.engine.dispose()


def test_postgres_customer_import_persists_and_rolls_back(postgres_url):
    from .db_customers import CustomerCollectionRow, CustomerDatabase, CustomerRow, PhoneRow

    migrate()
    auth = AuthDatabase(postgres_url, create_schema=False)
    customers = CustomerDatabase(postgres_url, create_schema=False)
    try:
        hashed = main.password_hash.hash(secrets.token_urlsafe(24))
        for user_id in ("admin", "sales"):
            auth.create_user(user_id=user_id, name=user_id, email=f"{user_id}@example.test", role="Admin" if user_id == "admin" else "Sales", password_hash=hashed)
        result = {"jobId": "import-1", "submissionId": "first", "filename": "synthetic.xlsx", "processed": 2, "created": 1, "updated": 0, "errorRows": 1, "status": "Partial", "errors": [{"row": 3, "field": "bcn", "reason": "Invalid bcn"}], "actorId": "admin"}
        customers.ingest_sources([{"bcn": "000123", "name": "Original", "source": {"customer_name": "Original"}, "typed": {"propensity_score": Decimal("0.875000"), "last_purchase_date": date(2025, 1, 2), "recent": True}, "collections": [{"kind": "vendor", "slot": 4, "name": "Synthetic vendor", "revenue": Decimal("12.500000")}], "primary_phone": "555-0100"}], result)
        with Session(customers.engine) as session:
            row = session.get(CustomerRow, "000123")
            assert row.bcn == "000123" and row.propensity_score == Decimal("0.875000") and row.last_purchase_date == date(2025, 1, 2) and row.recent is True
            assert session.query(CustomerCollectionRow).one().slot == 4
            session.add(PhoneRow(bcn="000123", phone="555-0101", primary=False)); session.commit()
        customers.save_operational(bcn="000123", owner_id="sales", status="Closed", version=7)
        customers.ingest_sources([{"bcn": "000123", "name": "Reimported", "source": {"customer_name": "Reimported"}, "typed": {"propensity_score": None, "last_purchase_date": None, "recent": None}, "collections": [], "primary_phone": None}], {**result, "jobId": "import-2", "submissionId": "second", "processed": 1, "created": 0, "updated": 1, "errorRows": 0, "status": "Completed", "errors": []})
        row = customers.get("000123")
        assert row.name == "Reimported" and row.owner_id == "sales" and row.status == "Closed" and row.version == 7 and row.propensity_score is None and row.last_purchase_date is None and row.recent is None
        assert customers.phones("000123") == ["555-0101"]
        assert customers.import_errors("admin", "first", 1, 1) == ([{"row": 3, "field": "bcn", "reason": "Invalid bcn"}], 1)
        with pytest.raises(IntegrityError):
            customers.ingest_sources([{"bcn": "000999", "name": "Rolled back", "source": {}, "primary_phone": None}], {**result, "submissionId": "conflict"})
        assert customers.get("000999") is None and customers.import_job("admin", "conflict") is None
        barrier = Barrier(2)
        def concurrent_import(index):
            barrier.wait()
            customers.ingest_sources([{"bcn": "000777", "name": f"Winner {index}", "source": {"customer_name": f"Winner {index}"}, "typed": {"propensity_rank": index}, "primary_phone": f"555-01{index}"}], {**result, "jobId": f"race-{index}", "submissionId": f"race-{index}", "errorRows": 0, "status": "Completed", "errors": []})
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(concurrent_import, (1, 2)))
        row = customers.get("000777")
        assert (row.name, row.propensity_rank, customers.phones("000777")) in (("Winner 1", 1, ["555-011"]), ("Winner 2", 2, ["555-012"]))
    finally:
        auth.engine.dispose(); customers.engine.dispose()


def test_postgres_process_restart(postgres_url):
    migrate()
    # Transport synthetic cookies only over anonymous process pipes, never args/files/output.
    seed = '''
import json, secrets
from datetime import timedelta
from apps.api.main import app, provision_user, Provision, auth_db
from apps.api import db_auth
from fastapi.testclient import TestClient
secret = secrets.token_urlsafe(24)
user = provision_user(Provision(name="Restart", email="restart@example.test", password=secret))
client = TestClient(app, base_url="http://localhost")
assert client.post("/session/login", json={"email": user.email, "password": secret}).status_code == 200
valid = client.cookies.get("call_center_session")
revoked, _ = auth_db.issue(user.id)
auth_db.revoke(revoked)
now = db_auth.utcnow()
db_auth.utcnow = lambda: now - timedelta(hours=9)
expired, _ = auth_db.issue(user.id)
print(json.dumps([valid, revoked, expired]))
'''
    verify = '''
import json, sys
from fastapi.testclient import TestClient
from apps.api.main import app, auth_db
from apps.api.db_auth import SessionRow, digest
from sqlalchemy import select
cookies = json.load(sys.stdin)
with auth_db.transaction() as session:
    records = list(session.scalars(select(SessionRow)))
    assert len(records) == 3
    assert {row.digest for row in records} == {digest(token) for token in cookies}
    assert all(row.digest not in cookies for row in records)
for token, status in zip(cookies, [200, 401, 401]):
    with TestClient(app, base_url="http://localhost") as client:
        client.cookies.set("call_center_session", token)
        assert client.get("/session/me").status_code == status
with TestClient(app, base_url="http://localhost") as client:
    assert client.post("/operator/reset-password/anything", headers={"origin": "http://localhost:3000"}, json={}).status_code == 404
'''
    env = os.environ | {"CALL_CENTER_STORAGE": "postgres", "DATABASE_URL": postgres_url}
    first = subprocess.run([sys.executable, "-c", seed], env=env, capture_output=True)
    assert first.returncode == 0
    second = subprocess.run([sys.executable, "-c", verify], env=env, input=first.stdout, capture_output=True)
    assert second.returncode == 0


def test_postgres_operator_console(postgres_url, monkeypatch, capsys):
    migrate()
    from . import operator
    database = AuthDatabase(postgres_url, create_schema=False)
    monkeypatch.setattr(main, "auth_db", database)
    monkeypatch.setattr(main, "storage_mode", "postgres")
    secret = secrets.token_urlsafe(24)
    monkeypatch.setattr(operator, "getpass", lambda _: secret)
    answers = iter(["provision", "Synthetic", " Console@example.test "])
    monkeypatch.setattr("builtins.input", lambda _: next(answers))
    operator.main()
    user = database.user_by_email("console@example.test")
    token, _ = database.issue(user.id)
    answers = iter(["provision", "Duplicate", "CONSOLE@example.test"])
    with pytest.raises(SystemExit, match="Operator request rejected"):
        operator.main()
    secret = secrets.token_urlsafe(24)
    answers = iter(["reset", user.id])
    operator.main()
    assert database.user_for_session(token) is None
    assert main.password_hash.verify(secret, database.user_by_email(user.email).password_hash)
    answers = iter(["reset", "missing"])
    with pytest.raises(SystemExit, match="Operator request rejected"):
        operator.main()
    output = capsys.readouterr()
    assert output.out == "Operator request completed.\n" * 2 and output.err == ""
    assert database.engine.pool.checkedout() == 0
    database.engine.dispose()
