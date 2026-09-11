"""Run a synthetic HTTP smoke against a migration-ready PostgreSQL database."""
import os
from io import BytesIO
from fastapi.testclient import TestClient
from openpyxl import Workbook

if os.getenv("CALL_CENTER_STORAGE") != "postgres" or not os.getenv("DATABASE_URL"):
    raise SystemExit("Set CALL_CENTER_STORAGE=postgres and DATABASE_URL")

from apps.api.main import app, operator_provision, Provision

client = TestClient(app, base_url="http://localhost")
origin = {"origin": "http://localhost:3000"}
password = __import__("secrets").token_urlsafe(24)
created = operator_provision(Provision(name="Smoke Admin", email="smoke-admin@example.test", role="Admin", password=password))
assert client.post("/session/login", json={"email": "smoke-admin@example.test", "password": password}).status_code == 200
assert client.get("/health/ready").status_code == 200
sales = client.post("/admin/users", json={"name": "Smoke Sales", "email": "smoke-sales@example.test", "role": "Sales", "password": password}, headers=origin)
assert sales.status_code == 201
sales_id = sales.json()["id"]
workbook = Workbook(); workbook.active.append(["bcn", "customer_name"]); workbook.active.append(["009990", "Smoke Customer"])
payload = BytesIO(); workbook.save(payload)
imported = client.post("/admin/imports?submission_id=smoke-import", files={"file": ("smoke.xlsx", payload.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}, headers=origin)
assert imported.status_code == 201 and imported.json()["created"] == 1
assert client.get("/admin/imports/smoke-import/errors?page=1&page_size=25").json()["total"] == 0
assigned = client.post("/admin/assignments/manual/009990", json={"ownerId": sales_id, "submissionId": "smoke-assignment"}, headers=origin)
assert assigned.status_code == 200
assert client.post("/session/logout", headers=origin).status_code == 204
assert client.post("/session/login", json={"email": "smoke-sales@example.test", "password": password}).status_code == 200
assert client.get("/customers", params={"mine": "true"}).status_code == 200
interaction = client.post("/customers/009990/interactions", json={"outcome": "Contact", "note": "Synthetic smoke", "submissionId": "smoke-interaction"}, headers=origin)
assert interaction.status_code == 200
followup = client.post("/customers/009990/follow-ups", json={"type": "Reminder", "due": "2026-09-20", "note": "Synthetic next", "submissionId": "smoke-followup"}, headers=origin)
assert followup.status_code == 200
completed = client.post(f"/customers/009990/follow-ups/{followup.json()['id']}/complete", json={"outcome": "Attempt", "submissionId": "smoke-complete"}, headers=origin)
assert completed.status_code == 200
assert completed.json()["interactionId"].startswith("interaction-")
detail = client.get("/customers/009990")
assert detail.status_code == 200 and detail.json()["followUps"][0]["interactionId"] == completed.json()["interactionId"]
assert client.get("/workload").status_code == 200
assert client.post("/session/logout", headers=origin).status_code == 204
assert client.post("/session/login", json={"email": "smoke-admin@example.test", "password": password}).status_code == 200
assert client.get("/admin/reports").status_code == 200
assert client.get("/admin/audit").status_code == 200
assert client.post("/session/logout", headers=origin).status_code == 204
assert client.get("/session/me").status_code == 401
print("postgres HTTP smoke passed")
