# Deployment

The API exposes `/health/live` for process liveness and `/health/ready` for readiness. Local development uses `CALL_CENTER_STORAGE=memory`; PostgreSQL deployments must set `CALL_CENTER_STORAGE=postgres`, `DATABASE_URL`, and the exact HTTPS `FRONTEND_ORIGIN`, run Alembic migrations before traffic, and keep secrets in Railway environment variables. No deployment or production smoke is claimed until the platform checks are run.

The development process starts with `uvicorn apps.api.main:app --host 0.0.0.0 --port $PORT --workers 1`; keep one worker while the in-process failed-login counters are enabled. `/health/live` has no database dependency, while `/health/ready` verifies connectivity and the migrated `users` table. A failed migration or readiness check must prevent traffic promotion.

Use `npm run benchmark:api` for the safe synthetic query benchmark. Logs and smoke evidence must contain request IDs, status, timings, and safe counts only; never include cookies, connection strings, workbook contents, notes, or credentials.
