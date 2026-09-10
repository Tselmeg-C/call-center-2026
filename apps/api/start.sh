#!/bin/sh
set -eu

if [ "${CALL_CENTER_STORAGE:-memory}" = "postgres" ]; then
  : "${DATABASE_URL:?DATABASE_URL is required for postgres storage}"
  alembic -c apps/api/alembic.ini upgrade head
fi

exec uvicorn apps.api.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers "${WEB_CONCURRENCY:-1}"
