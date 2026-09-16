from alembic import context
from sqlalchemy import engine_from_config, pool
import os

# Railway's managed Postgres plugin (and most standard providers) hand back a bare
# postgresql://... URL; SQLAlchemy's default dialect for that scheme is psycopg2, which
# apps/api/requirements.txt does not install (psycopg v3 only) -- pin it, same as
# apps/api/storage.database_url() (duplicated, not imported: alembic's own module loader runs
# this file standalone, outside the `apps` package, so a package-relative import doesn't resolve
# here). Found against a real Railway deployment while implementing #27: every boot's `alembic
# upgrade head` failed purely because of this driver mismatch.
def _database_url() -> str:
    url = os.environ["DATABASE_URL"]
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url

config = context.config
config.set_main_option("sqlalchemy.url", _database_url().replace("%", "%%"))
target_metadata = None

def run_migrations_online():
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction(): context.run_migrations()

try:
    run_migrations_online()
except Exception:
    raise SystemExit("Migration failed; check database availability and schema compatibility.") from None
