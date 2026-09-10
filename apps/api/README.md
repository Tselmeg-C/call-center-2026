# Local API

Run the single-process in-memory API with `python -m pip install -r requirements.txt` and `uvicorn main:app --app-dir apps/api --reload`. Memory state is intentionally lost on restart; PostgreSQL mode persists the implemented domain state and requires migrations first.
For a deployment-style start, use `apps/api/start.sh`; PostgreSQL mode applies Alembic migrations before serving traffic.

Operator provisioning and password recovery must be attached to this same process and read secret input without echo. No credentials are accepted as command-line arguments or written to logs.
Storage selection is explicit: `CALL_CENTER_STORAGE=memory` is the local default; `CALL_CENTER_STORAGE=postgres` requires `DATABASE_URL` and fails clearly when absent. The complete domain repository switch is staged for the persistence parity issue.
See [`../../_docs/persistence.md`](../../_docs/persistence.md) for migrations and adapter details and [`../../_docs/deployment.md`](../../_docs/deployment.md) for health and runtime rules.
