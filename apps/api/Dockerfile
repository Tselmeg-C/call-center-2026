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

FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9 AS builder

WORKDIR /build

COPY apps/api/requirements.txt apps/api/requirements.txt
# Hash-locked runtime deps only (pip-compile output, #161); test-only packages are in
# requirements-dev.txt and never reach this image. A changed hash fails the build.
RUN pip install --no-cache-dir --require-hashes --prefix=/install -r apps/api/requirements.txt

FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9 AS runtime

# Non-root user the process runs as.
RUN useradd --create-home --shell /usr/sbin/nologin appuser

COPY --from=builder /install /usr/local

WORKDIR /app
COPY apps/api apps/api
COPY observability observability

RUN chown -R appuser:appuser /app
USER appuser

ENV PYTHONUNBUFFERED=1

# The commit this image was built from, surfaced without shell access via the
# x-app-version response header and /health/ready's body (see apps/api/main.py). CI passes
# --build-arg GIT_SHA=$GITHUB_SHA (.github/workflows/ci.yml); an unset default keeps
# a plain local `docker build` working.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

EXPOSE 8000

CMD ["sh", "apps/api/start.sh"]
