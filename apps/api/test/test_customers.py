"""#118: GET /customers (list) must embed each row's histories/followUps the same way
GET /customers/{bcn} (detail) does. The Postgres branch of list_customers used to hardcode
histories/followUps to [], which silently broke every follow-up-driven frontend feature
(dashboard buckets, "Next action", "Save & complete follow-up") and the history-derived
customer status -- memory mode was never affected, so this has to run against real
PostgreSQL to catch a regression of the old Postgres-branch code.
"""
from datetime import datetime, timedelta, timezone

import pytest

from .. import main
from ..db_activity import ActivityDatabase
from ..db_auth import AuthDatabase
from ..db_customers import CustomerDatabase
from .test_auth_adapters import migrate, postgres_url  # noqa: F401  (shared fixture)


def test_postgres_list_customers_matches_detail_followups_and_histories(postgres_url, monkeypatch):
    migrate()
    auth = AuthDatabase(postgres_url, create_schema=False)
    customers = CustomerDatabase(postgres_url, create_schema=False)
    activities = ActivityDatabase(postgres_url, create_schema=False)
    monkeypatch.setattr(main, "customer_db", customers)
    monkeypatch.setattr(main, "activity_db", activities)
    main.repo.reset()
    try:
        # customers.owner_id has a real FK to users, so seed an actual Sales user, not just repo.users.
        auth.create_user(user_id="sales", name="Sales Rep", email="sales@example.test", role="Sales", password_hash=main.password_hash.hash("synthetic-not-used-1234"))
        main.repo.users["sales"] = {"id": "sales", "name": "Sales Rep", "email": "sales@example.test", "role": "Sales", "active": True}
        customers.upsert_source(bcn="000001", name="Follow-up Co", source={}, primary_phone="555-0001")
        customers.save_operational(bcn="000001", owner_id="sales", status="Open", version=0)
        customers.upsert_source(bcn="000002", name="No Follow-ups Co", source={})
        customers.save_operational(bcn="000002", owner_id="sales", status="Open", version=0)

        now = datetime.now(timezone.utc)
        yesterday = (now - timedelta(days=1)).isoformat()
        today = now.isoformat()
        for record in (
            {"id": "fu-overdue", "bcn": "000001", "actorId": "sales", "type": "Reminder", "due": yesterday, "status": "Open", "note": "overdue"},
            {"id": "fu-today", "bcn": "000001", "actorId": "sales", "type": "Reminder", "due": today, "status": "Open", "note": "due today"},
            {"id": "fu-undated", "bcn": "000001", "actorId": "sales", "type": "Reminder", "due": None, "status": "Open", "note": "undated"},
            {"id": "fu-done", "bcn": "000001", "actorId": "sales", "type": "Appointment", "due": today, "status": "Completed", "note": "done"},
        ):
            activities.save_followup(record)
        activities.save_activity(record_id="hist-1", bcn="000001", actor_id="sales", kind="Interaction", outcome="Contact", text="Spoke with customer")

        actor = main.User(id="sales", name="Sales Rep", email="sales@example.test", role="Sales")
        page = main.list_customers(user=actor, page=1, page_size=25, mine=False, q="", status_filter=None, owner=None)
        listed = {item.bcn: item for item in page.items}

        assert listed["000001"].followUps, "list endpoint omitted followUps for a customer with open follow-ups"
        assert {item["id"] for item in listed["000001"].followUps} == {"fu-overdue", "fu-today", "fu-undated", "fu-done"}
        assert listed["000001"].histories and listed["000001"].histories[0]["kind"] == "Interaction"
        # A customer with no activity at all still round-trips as an explicit empty list, not omitted.
        assert listed["000002"].followUps == [] and listed["000002"].histories == []

        detail = main.get_customer("000001", actor)
        assert sorted(listed["000001"].followUps, key=lambda item: item["id"]) == sorted(detail.followUps, key=lambda item: item["id"])
        assert {item["id"] for item in listed["000001"].histories} == {item["id"] for item in detail.histories}

        # The exact shape the frontend (apps/frontend/src/lib/adapt.ts toFollowUp/toActivities)
        # reads: "note"/"due"/"status" for follow-ups, "text"/"kind"/"outcome" for history events.
        overdue = next(item for item in listed["000001"].followUps if item["id"] == "fu-overdue")
        assert overdue["note"] == "overdue" and overdue["status"] == "Open" and overdue["due"] is not None
        interaction = next(item for item in listed["000001"].histories if item["id"] == "hist-1")
        assert interaction["text"] == "Spoke with customer" and interaction["outcome"] == "Contact"
    finally:
        auth.engine.dispose()
        customers.engine.dispose()
        activities.engine.dispose()
        main.repo.reset()
