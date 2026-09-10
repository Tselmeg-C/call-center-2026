# Persistence

Start PostgreSQL with `POSTGRES_PASSWORD=local-only docker compose -f infra/docker-compose.yml up -d postgres`, then run `DATABASE_URL=postgresql+psycopg://call_center:local-only@localhost:5432/call_center alembic -c apps/api/alembic.ini upgrade head`. Credentials belong in the environment and are never committed or logged.

Authentication is staged for the database adapter in this issue; domain repositories remain in-memory until the later persistence issues. The in-memory API suite remains the fast default.

With a migration-ready database, run `CALL_CENTER_STORAGE=postgres DATABASE_URL=... python -m apps.api.postgres_smoke` for the synthetic HTTP smoke. The command reports only pass/fail text.
