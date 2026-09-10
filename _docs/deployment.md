# Deployment

The API exposes `/health/live` for process liveness and `/health/ready` for readiness. Local development uses `CALL_CENTER_STORAGE=memory`; PostgreSQL deployments must set `CALL_CENTER_STORAGE=postgres` and `DATABASE_URL`, run Alembic migrations before traffic, and keep secrets in Railway environment variables. No deployment or production smoke is claimed until the platform checks are run.
