"""Run a synthetic HTTP smoke against a migration-ready PostgreSQL database."""
import os
from fastapi.testclient import TestClient

if os.getenv("CALL_CENTER_STORAGE") != "postgres" or not os.getenv("DATABASE_URL"):
    raise SystemExit("Set CALL_CENTER_STORAGE=postgres and DATABASE_URL")

from apps.api.main import app, repo

repo.reset()
client = TestClient(app, base_url="http://localhost")
origin = {"origin": "http://localhost:3000"}
password = "safe synthetic test password"
created = client.post("/operator/provision", json={"name": "Smoke Admin", "email": "smoke-admin@example.test", "role": "Admin", "password": password}, headers=origin)
assert created.status_code == 200
assert client.post("/session/login", json={"email": "smoke-admin@example.test", "password": password}).status_code == 200
assert client.get("/health/ready").status_code == 200
assert client.get("/customers").status_code == 200
assert client.post("/session/logout", headers=origin).status_code == 204
assert client.get("/session/me").status_code == 401
print("postgres HTTP smoke passed")
