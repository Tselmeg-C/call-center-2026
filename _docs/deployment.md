# Deployment

The API exposes `/health/live` for process liveness and `/health/ready` for readiness. Local development uses `CALL_CENTER_STORAGE=memory`; PostgreSQL deployments must set `CALL_CENTER_STORAGE=postgres`, `DATABASE_URL`, and the exact HTTPS `FRONTEND_ORIGIN`, run Alembic migrations before traffic, and keep secrets in Railway environment variables. No deployment or production smoke is claimed until the platform checks are run.

For local development, run the frontend with `npm run dev -- --port 4174` and the API with `apps/api/start.sh` on port 8000. The Vite proxy maps frontend `/api` requests to the API.

The development process starts with `apps/api/start.sh`; in PostgreSQL mode it runs `alembic upgrade head` before launching `uvicorn`, and a failed migration stops startup. The script rejects `WEB_CONCURRENCY` values other than `1` while failed-login counters are process-local. `/health/live` has no database dependency, while `/health/ready` verifies connectivity and the migrated `users` table. A failed migration or readiness check must prevent traffic promotion.

Use `npm run benchmark:api` for the safe synthetic query benchmark. Logs and smoke evidence must contain request IDs, status, timings, and safe counts only; never include cookies, connection strings, workbook contents, notes, or credentials.
