# Local API

Run the single-process in-memory API with `python -m pip install -r requirements.txt` and `uvicorn main:app --app-dir apps/api --reload`. Memory state is intentionally lost on restart; PostgreSQL mode persists the implemented domain state and requires migrations first.
For a deployment-style start, use `apps/api/start.sh`; PostgreSQL mode applies Alembic migrations before serving traffic.

In memory mode, operator provisioning and password recovery must be attached to this same process. In PostgreSQL mode, run `CALL_CENTER_STORAGE=postgres python -m apps.api.operator` with `DATABASE_URL` supplied in the environment; the console reads secret input without echo. No credentials are accepted as command-line arguments or written to logs.
Storage selection is explicit: `CALL_CENTER_STORAGE=memory` is the local default; `CALL_CENTER_STORAGE=postgres` requires `DATABASE_URL` and fails clearly when absent. In PostgreSQL mode every domain -- auth, customers, assignment, and activity -- reads and writes through its SQLAlchemy adapter, including customer search/detail/history pagination, Sales workload buckets, Admin reports, and Admin audit, each filtering and aggregating in SQL rather than loading full tables into the process.
See [`../../_docs/persistence.md`](../../_docs/persistence.md) for migrations and adapter details and [`../../_docs/deployment.md`](../../_docs/deployment.md) for health and runtime rules.

Run the complete in-memory suite with `python -m pytest apps/api --tb=no`. Real PostgreSQL acceptance setup, isolated cleanup, migration upgrades and backup/restore strategy are documented in the [persistence runbook](../../_docs/persistence.md#isolated-postgresql-acceptance-checks).
