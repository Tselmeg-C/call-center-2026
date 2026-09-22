#!/bin/sh
set -eu

if [ "${CALL_CENTER_STORAGE:-memory}" = "postgres" ]; then
  : "${DATABASE_URL:?DATABASE_URL is required for postgres storage}"
  alembic -c apps/api/alembic.ini upgrade head
fi

if [ "${CALL_CENTER_STORAGE:-memory}" != "postgres" ] && [ "${WEB_CONCURRENCY:-1}" != "1" ]; then
  echo "WEB_CONCURRENCY must be 1 while login throttling is process-local (CALL_CENTER_STORAGE=memory)." >&2
  exit 78
fi

exec uvicorn apps.api.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers "${WEB_CONCURRENCY:-1}"
