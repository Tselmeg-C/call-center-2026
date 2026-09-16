import os

def mode() -> str:
    value = os.getenv("CALL_CENTER_STORAGE", "memory").casefold()
    if value not in {"memory", "postgres"}:
        raise RuntimeError("CALL_CENTER_STORAGE must be memory or postgres")
    if value == "postgres" and not os.getenv("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL is required for postgres storage")
    return value

def database_url() -> str:
    """DATABASE_URL with the SQLAlchemy dialect pinned to +psycopg. Railway's managed Postgres
    plugin (and most standard providers, e.g. Heroku-style URLs) hand back a bare
    `postgresql://...` or `postgres://...` value; SQLAlchemy's default dialect for that scheme is
    psycopg2, which apps/api/requirements.txt does not install (psycopg v3 only). Every
    postgres-mode caller (this module's four DB classes in main.py, apps/api/migrations/env.py)
    must go through this instead of reading os.environ["DATABASE_URL"] directly. Found against a
    real Railway deployment while implementing #27: every boot's `alembic upgrade head` failed
    with the DB completely reachable and correctly migrated, purely because of this driver
    mismatch."""
    url = os.environ["DATABASE_URL"]
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url
