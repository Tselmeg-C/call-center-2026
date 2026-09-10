# Persistence

Start PostgreSQL with `docker compose -f infra/docker-compose.yml up -d postgres` after setting `POSTGRES_PASSWORD` in the environment, then run `DATABASE_URL="$DATABASE_URL" alembic -c apps/api/alembic.ini upgrade head`. Credentials belong in the environment and are never committed or logged.

`CALL_CENTER_STORAGE=memory` is the explicit local/test setting. `CALL_CENTER_STORAGE=postgres` requires `DATABASE_URL` and never silently falls back to memory; migrations must be applied before the API is ready. Authentication, customer source/operational fields, assignment/audit records, activity/follow-up records, and durable retry records use SQLAlchemy adapters in PostgreSQL mode; the in-memory suite remains the fast default.

With a migration-ready database, run `CALL_CENTER_STORAGE=postgres DATABASE_URL=... python -m apps.api.postgres_smoke` for the synthetic HTTP smoke. The command reports only pass/fail text.

Run the synthetic query benchmark with `npm run benchmark:api`. It uses 10,000 customers and 150,000 combined interaction, follow-up, and audit events with 30 samples per query shape; output contains counts and p50/p95 timings only.
