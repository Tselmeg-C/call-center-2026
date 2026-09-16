# syntax=docker/dockerfile:1
# Multi-stage build for apps/api. Final image runs apps/api/start.sh unchanged
# (migration-before-traffic gate, WEB_CONCURRENCY guard, /health/live and
# /health/ready all stay exactly as they behave outside a container).
#
# Build (from repo root, so the build context includes apps/api):
#   docker build -f apps/api/Dockerfile -t call-center-api .
# Run:
#   docker run --rm -p 8000:8000 \
#     -e CALL_CENTER_STORAGE=memory \
#     -e FRONTEND_ORIGIN=http://localhost:4174 \
#     call-center-api

FROM python:3.12-slim AS builder

WORKDIR /build

COPY apps/api/requirements.txt apps/api/requirements.txt
RUN pip install --no-cache-dir --prefix=/install -r apps/api/requirements.txt

FROM python:3.12-slim AS runtime

# Non-root user the process runs as.
RUN useradd --create-home --shell /usr/sbin/nologin appuser

COPY --from=builder /install /usr/local

WORKDIR /app
COPY apps/api apps/api
COPY observability observability

RUN chown -R appuser:appuser /app
USER appuser

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["sh", "apps/api/start.sh"]
