from alembic import context
from sqlalchemy import engine_from_config, pool
import os

config = context.config
config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"].replace("%", "%%"))
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
