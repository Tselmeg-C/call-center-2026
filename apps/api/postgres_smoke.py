"""Run a synthetic HTTP smoke against a migration-ready PostgreSQL database.

Local (CI): CALL_CENTER_STORAGE=postgres DATABASE_URL=... python -m apps.api.postgres_smoke
Live deployment: SMOKE_BASE_URL=https://<frontend>/api SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=...
  -- logs in as the existing Admin instead of provisioning one, and tags every created record with a
  per-run suffix so reruns don't collide. Leaves one "Smoke Sales" user and "Smoke Customer" behind.
"""
import os
import secrets
import time
from io import BytesIO
from openpyxl import Workbook

base_url = os.getenv("SMOKE_BASE_URL")
run = str(int(time.time()))[-6:]
bcn = f"99{run[-4:]}"
password = secrets.token_urlsafe(24)
sales_email = f"smoke-sales-{run}@example.test"
if base_url:
    import httpx

    client = httpx.Client(base_url=base_url, timeout=30)
    origin = {"origin": base_url.rsplit("/api", 1)[0]}
    admin_email, admin_password = os.environ["SMOKE_ADMIN_EMAIL"], os.environ["SMOKE_ADMIN_PASSWORD"]
else:
    if os.getenv("CALL_CENTER_STORAGE") != "postgres" or not os.getenv("DATABASE_URL"):
        raise SystemExit("Set CALL_CENTER_STORAGE=postgres and DATABASE_URL (or SMOKE_BASE_URL for a live deployment)")
    from fastapi.testclient import TestClient
    from apps.api.main import app, provision_user, Provision

    client = TestClient(app, base_url="http://localhost")
    origin = {"origin": "http://localhost:3000"}
    admin_email, admin_password = "smoke-admin@example.test", password
    provision_user(Provision(name="Smoke Admin", email=admin_email, role="Admin", password=password))
assert client.post("/session/login", json={"email": admin_email, "password": admin_password}).status_code == 200
assert client.get("/health/ready").status_code == 200
sales = client.post("/admin/users", json={"name": "Smoke Sales", "email": sales_email, "role": "Sales", "password": password}, headers=origin)
assert sales.status_code == 201
sales_id = sales.json()["id"]
reasons = client.get("/admin/closure-reasons").json()
reason_id = next((item["id"] for item in reasons if item["active"]), None) or client.post("/admin/closure-reasons", json={"label": "Smoke closure"}, headers=origin).json()["id"]


def import_customer(name, submission_id):
    workbook = Workbook(); workbook.active.append(["bcn", "customer_name"]); workbook.active.append([bcn, name])
    payload = BytesIO(); workbook.save(payload)
    return client.post(f"/admin/imports?submission_id={submission_id}", files={"file": ("smoke.xlsx", payload.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}, headers=origin)


imported = import_customer("Smoke Customer", f"smoke-import-{run}")
assert imported.status_code == 201 and imported.json()["created"] == 1
assert client.get(f"/admin/imports/smoke-import-{run}/errors?page=1&page_size=25").json()["total"] == 0
assigned = client.post(f"/admin/assignments/manual/{bcn}", json={"ownerId": sales_id, "submissionId": f"smoke-assignment-{run}"}, headers=origin)
assert assigned.status_code == 200
assert client.post("/session/logout", headers=origin).status_code == 204
assert client.post("/session/login", json={"email": sales_email, "password": password}).status_code == 200
assert client.get("/customers", params={"mine": "true"}).status_code == 200
interaction = client.post(f"/customers/{bcn}/interactions", json={"outcome": "Contact", "note": "Synthetic smoke", "submissionId": f"smoke-interaction-{run}"}, headers=origin)
assert interaction.status_code == 200
followup = client.post(f"/customers/{bcn}/follow-ups", json={"type": "Reminder", "due": "2026-09-20", "note": "Synthetic next", "submissionId": f"smoke-followup-{run}"}, headers=origin)
assert followup.status_code == 200
completed = client.post(f"/customers/{bcn}/follow-ups/{followup.json()['id']}/complete", json={"outcome": "Attempt", "submissionId": f"smoke-complete-{run}"}, headers=origin)
assert completed.status_code == 200
assert completed.json()["interactionId"].startswith("interaction-")
detail = client.get(f"/customers/{bcn}")
assert detail.status_code == 200 and detail.json()["followUps"][0]["interactionId"] == completed.json()["interactionId"]
closed = client.post(f"/customers/{bcn}/close", json={"reasonId": reason_id, "submissionId": f"smoke-close-{run}"}, headers=origin)
assert closed.status_code == 200 and closed.json()["status"] == "Closed"
reopened = client.post(f"/customers/{bcn}/reopen", json={"submissionId": f"smoke-reopen-{run}"}, headers=origin)
assert reopened.status_code == 200 and reopened.json()["status"] == "Open" and reopened.json()["ownerId"] == sales_id
assert client.get("/workload").status_code == 200
assert client.post("/session/logout", headers=origin).status_code == 204
assert client.post("/session/login", json={"email": admin_email, "password": admin_password}).status_code == 200
reimported = import_customer("Smoke Customer Reimported", f"smoke-reimport-{run}")
assert reimported.status_code == 201 and reimported.json()["created"] == 0 and reimported.json()["updated"] == 1
# Reimport refreshes source fields only: owner, status, history and follow-ups must survive it.
after = client.get(f"/customers/{bcn}").json()
assert after["name"] == "Smoke Customer Reimported" and after["ownerId"] == sales_id and after["status"] == "Open"
assert {"Closure", "Reopen"} <= {item.get("kind") for item in after["histories"]}
assert after["followUps"][0]["interactionId"] == completed.json()["interactionId"]
assert client.get("/admin/reports").status_code == 200
assert client.get("/admin/audit").status_code == 200
assert client.post("/session/logout", headers=origin).status_code == 204
assert client.get("/session/me").status_code == 401
print("postgres HTTP smoke passed")
