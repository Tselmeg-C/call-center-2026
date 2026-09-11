# Persistence

Start PostgreSQL with `docker compose -f infra/docker-compose.yml up -d postgres` after setting `POSTGRES_PASSWORD` in the environment, then run `DATABASE_URL="$DATABASE_URL" alembic -c apps/api/alembic.ini upgrade head`. Credentials belong in the environment and are never committed or logged.

`CALL_CENTER_STORAGE=memory` is the explicit local/test setting. `CALL_CENTER_STORAGE=postgres` requires `DATABASE_URL` and never silently falls back to memory; migrations must be applied before the API is ready. Authentication, customer source/operational fields, assignment/audit records, activity/follow-up records, and durable retry records use SQLAlchemy adapters in PostgreSQL mode; the in-memory suite remains the fast default.

With a migration-ready database, run `CALL_CENTER_STORAGE=postgres python -m apps.api.postgres_smoke` for the synthetic HTTP smoke. The command reports only pass/fail text.

Run the synthetic query benchmark with `npm run benchmark:api`. It uses 10,000 customers and 150,000 combined interaction, follow-up, and audit events with 30 samples per query shape; output contains counts and p50/p95 timings only.


## Delivery stages and implemented state

The issue sequence defines acceptance ownership; it does not imply later adapters are absent from today's code.

| Issue | Delivery stage | Current implementation |
| --- | --- | --- |
| #22 | Identities, sessions, local account recovery | PostgreSQL auth adapter; shared memory/PostgreSQL authentication checks |
| #23 | Customers and imports | PostgreSQL adapters and durable import-job retry records exist; full acceptance remains in progress |
| #24 | Ownership, rules and audit | PostgreSQL adapters and actor-scoped assignment retries exist; full acceptance remains in progress |
| #25 | Activity, lifecycle and retries | PostgreSQL adapters and durable lifecycle retry links exist; full acceptance remains in progress |
| #26 | Normal full-app database switch and parity | `CALL_CENTER_STORAGE=postgres` selects all current adapters; full-app parity belongs to #26 |

## Isolated PostgreSQL acceptance checks

Use the disposable test compose project, never the development compose database. This loopback-only database contains synthetic test data and uses local trust authentication, so there are no credentials in its commands. CI creates its own disposable PostgreSQL service with the same test database naming guard.

The two Compose files are intentionally standalone: `docker-compose.yml` runs the password-protected development database on port 5432; `docker-compose.test.yml` runs the disposable test database on loopback port 55432. Do not combine them with multiple `-f` arguments: Compose would merge development environment and port settings into the test service. Keeping the small files separate avoids password interpolation and port-reset overrides in test setup.

```sh
docker compose -p call-center-tests -f infra/docker-compose.test.yml up -d --wait
export TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55432/call_center_test
python -m pytest apps/api/test_auth.py apps/api/test_auth_adapters.py --tb=no
docker compose -p call-center-tests -f infra/docker-compose.test.yml down -v
```

Each PostgreSQL test requires a database ending in `_test` or `_ci`, creates a unique schema, applies Alembic migrations, and drops only that schema in cleanup. Checks cover an empty schema, prior revision upgrade, repeated upgrade, PostgreSQL constraints, concurrent normalized identity conflicts, injected transaction rollback, released connections, and sessions across separate API processes. Cookies move between test processes only through anonymous pipes. Keep `--tb=no` to prevent assertion diagnostics from exposing generated secrets. With no `TEST_DATABASE_URL`, PostgreSQL cases skip and the complete existing memory suite remains runnable.

## Operator commands

With `DATABASE_URL` supplied by environment/secret storage and migrations applied:

```sh
CALL_CENTER_STORAGE=postgres python -m apps.api.operator
```

Choose `provision` to create an Admin or `reset` to recover an existing user ID. Password input uses `getpass`; no password arguments or secret output are accepted. Normalized duplicate identities fail safely. Recovery replaces the hash and revokes every session in one transaction; an unknown ID changes nothing. Database-backed commands work independently of the API process. PostgreSQL mode exposes no operator HTTP endpoints. Memory mode retains its same-process operator functions and cannot be provisioned by a separate console process.

## Migration and restore strategy

Run `alembic -c apps/api/alembic.ini upgrade head` with `DATABASE_URL` already in the environment before starting the API. Migrations run transactionally; failures return a safe message without the URL or SQL values. Do not rewrite applied revisions. New auth constraints intentionally reject pre-existing invalid identities or session records: repair data through a reviewed migration or restore a compatible backup before retrying. Back up the database before upgrading, verify restoration into an isolated database, and retain the matching application revision. Roll back by restoring that verified backup and matching application, not by destructive down-migration. Never run acceptance cleanup against application data.
