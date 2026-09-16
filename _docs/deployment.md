# Deployment

The API exposes `/health/live` for process liveness and `/health/ready` for readiness. Local development uses `CALL_CENTER_STORAGE=memory`; PostgreSQL deployments must set `CALL_CENTER_STORAGE=postgres`, `DATABASE_URL`, and the exact HTTPS `FRONTEND_ORIGIN`, run Alembic migrations before traffic, and keep secrets in Railway environment variables. No deployment or production smoke is claimed until the platform checks are run.

For local development, run the frontend with `npm run dev -- --port 4174` and the API with `apps/api/start.sh` on port 8000. The Vite proxy maps frontend `/api` requests to the API.

The development process starts with `apps/api/start.sh`; in PostgreSQL mode it runs `alembic upgrade head` before launching `uvicorn`, and a failed migration stops startup. The script rejects `WEB_CONCURRENCY` values other than `1` while failed-login counters are process-local. `/health/live` has no database dependency, while `/health/ready` verifies connectivity and the migrated `users` table. A failed migration or readiness check must prevent traffic promotion.

Use `npm run benchmark:api` for the safe synthetic query benchmark. Logs and smoke evidence must contain request IDs, status, timings, and safe counts only; never include cookies, connection strings, workbook contents, notes, or credentials.

## OpenTelemetry

`apps/api` (see `apps/api/otel_setup.py`) instruments every request (FastAPI), every DB query
(SQLAlchemy), and the existing `origin_guard` request log with the OpenTelemetry SDK, and can
export traces, metrics, and logs over OTLP -- all configured only through environment variables,
never a hardcoded endpoint or credential:

| Variable | Purpose | Example |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint (Grafana Cloud's Tempo/Loki/Mimir OTLP gateway once #27 exists). **Unset means OTel is fully disabled**: no exporter is constructed, no background export thread starts, no network call is ever attempted. | `https://otlp-gateway-<region>.grafana.net/otlp` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Auth for that endpoint (Grafana Cloud instance ID + API key, as `Authorization=Basic <base64>` or `key=value` pairs). | `Authorization=Basic <redacted>` |
| `OTEL_SERVICE_NAME` | Service name attached to every span/log/metric. Defaults to `call-center-api` if unset. | `call-center-api` |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes, most importantly `deployment.environment` (`dev` or `prod`) -- this is how environments are told apart in Grafana, not separate Grafana Cloud accounts. | `deployment.environment=prod` |

Real Grafana Cloud values (the actual OTLP endpoint URL, instance ID, and API key) are never
committed to this repository. They exist only as Railway environment variables, and only once
#27 (https://github.com/Tselmeg-C/call-center-2026/issues/27) provisions that live account and
deployment -- until then these variables are simply left unset, and the API runs with OTel
cleanly disabled, exactly as it does today in local dev and CI.

Dev and prod use the *same* variable names; only the values differ (dev typically leaves
`OTEL_EXPORTER_OTLP_ENDPOINT` unset entirely and runs with OTel disabled, while prod sets all
four once #27 supplies the Grafana Cloud instance).

Every span, log record, and metric label -- including each metric data point's exemplars --
passes through an explicit attribute allowlist (`otel_setup.ALLOWED_ATTRIBUTES`, the per-metric
`Views`, and `otel_setup._redact_metrics_data` for the exemplar path the `Views` alone don't
cover) before export: only route, method, status code, DB system/operation, and the existing
`x-request-id` are ever allowed through -- cookies, auth headers, connection strings, and
note/workbook free text are structurally impossible to export, not just absent by convention.
`apps/api/test_otel.py` asserts this against in-memory OTel exporters (never a live endpoint).

`_docs/grafana-dashboard.json` is a validated Grafana dashboard JSON model (not uploaded to any
live account -- see #27) with request rate/error rate/duration panels for `/customers`,
`/sales/workload`, and `/admin/reports`, plus log volume, each split by the `deployment.environment`
resource attribute, using the exact metric (`http.server.request.duration`) and label
(`http.route`, `http.response.status_code`, `deployment_environment`) names this instrumentation
actually emits.

### Benchmark overhead

`apps/api/benchmark.py` accepts `BENCHMARK_OTEL=1` to re-run the same synthetic benchmark with the
OTel SDK enabled, exporting to in-memory exporters (no live collector is available to this task).
Three `BENCHMARK_SCALE=ci` runs each, OTel disabled vs. enabled, against a throwaway local
PostgreSQL instance:

| Query | Baseline p50 (ms) | OTel-enabled p50 (ms) | Baseline p95 (ms) | OTel-enabled p95 (ms) |
| --- | --- | --- | --- | --- |
| `/customers` search | ~13.5 | ~19.2 | ~20.0 | ~26.3 |
| `/sales/workload` | ~15.7 | ~21.3 | ~24.2 | ~32.7 |
| `/admin/reports` | ~30.3 | ~37.3 | ~43.0 | ~48.0 |
| `/admin/audit` | ~11.7 | ~16.5 | ~19.2 | ~26.4 |

Instrumentation overhead is roughly 4-6ms added to p50 at this CI-sized dataset (a few hundred
rows -- the same small smoke scale the CI benchmark job already uses; see
`_docs/persistence.md` for why `full` scale isn't run in CI). That is well under 1% of the
1000ms p95 target for every query -- the SDK's per-span/per-log overhead is real but negligible
next to actual query latency; it does not change whether the existing p95 targets hold.

## Container images

`apps/api/Dockerfile` and `apps/frontend/Dockerfile` are multi-stage builds so later deployment (Railway or otherwise) can run a built, versioned image instead of buildpack/Nixpacks source auto-detection. Build them from the repository root (so the build context includes the workspace lockfile and both apps' source):

```sh
docker build -f apps/api/Dockerfile -t call-center-api .
docker build -f apps/frontend/Dockerfile -t call-center-frontend .
```

The API image is `python:3.12-slim` (matches CI); the builder stage installs `apps/api/requirements.txt` and the runtime stage copies the installed packages plus `apps/api` source, runs as a non-root user, and execs the unchanged `apps/api/start.sh` -- the migration-before-traffic gate, the `WEB_CONCURRENCY` guard, and `/health/live`/`/health/ready` all behave exactly as they do outside a container. Run it with the same environment variables as any other deployment (`CALL_CENTER_STORAGE`, `DATABASE_URL` when in postgres mode, `FRONTEND_ORIGIN`, `PORT`); nothing environment-specific is baked into the image.

The frontend image builds with `node:24-alpine` (matches `.nvmrc`) and serves the resulting `dist/` bundle from `nginx:1.27-alpine` -- no Node runtime or extra static-server dependency ships in the final image. nginx's official envsubst-templates mechanism (`apps/frontend/nginx/default.conf.template`) substitutes `$PORT` at container start and falls back unmatched routes to `index.html` for the client-side router.

`infra/docker-compose.yml` adds optional `api` and `frontend` services alongside `postgres`, so `docker compose -f infra/docker-compose.yml up --build` runs the whole stack in containers locally:

```sh
POSTGRES_PASSWORD=<local-only-value> docker compose -f infra/docker-compose.yml up --build
```

This is additive: the non-container `npm run dev` / `apps/api/start.sh` workflow keeps working unchanged, and nothing here requires containers for day-to-day development.

`infra/smoke-test.sh` (`npm run smoke:containers`) is the container-run smoke check: it builds both images, starts `infra/docker-compose.test.yml`'s Postgres, runs the API and frontend containers against it, and asserts `/health/ready` returns healthy and the frontend serves its index page.

## Publishing images to GHCR

Every push to `main` that passes `check` in `.github/workflows/frontend.yml` runs a `publish` job (`needs: check`) that builds and pushes both images to GitHub Container Registry, from the same `apps/api/Dockerfile` and `apps/frontend/Dockerfile` used for the local `docker build` commands above -- CI does not diverge from them. Pull requests (including from forks) only run the `docker build` steps; nothing is ever pushed off `main`.

Images are published as:

- `ghcr.io/<owner>/<repo>-api`
- `ghcr.io/<owner>/<repo>-frontend`

with `<owner>` and `<repo>` lowercased (GHCR requires lowercase paths). For this repository that's `ghcr.io/tselmeg-c/call-center-2026-api` and `ghcr.io/tselmeg-c/call-center-2026-frontend`. Each successful `main` push tags both images with the full commit SHA and moves the `latest` tag to point at that same build -- `latest` is the newest `main` build, a commit SHA is a pinned, reproducible one.

These images are published at GHCR's default visibility for a `GITHUB_TOKEN`-authored package, which is **private**. This is deliberate, not an oversight: pulling them (including for the `docker pull`/`docker run` below) requires being authenticated to GHCR with access to this repository.

```sh
docker pull ghcr.io/tselmeg-c/call-center-2026-api:<sha>
docker run --rm -p 8000:8000 \
  -e CALL_CENTER_STORAGE=postgres \
  -e DATABASE_URL=postgresql+psycopg://user:pass@host:5432/call_center \
  -e FRONTEND_ORIGIN=https://app.example.com \
  -e PORT=8000 \
  -e WEB_CONCURRENCY=1 \
  ghcr.io/tselmeg-c/call-center-2026-api:<sha>

docker pull ghcr.io/tselmeg-c/call-center-2026-frontend:<sha>
docker run --rm -p 8080:8080 -e PORT=8080 \
  ghcr.io/tselmeg-c/call-center-2026-frontend:<sha>
```

Swap `<sha>` for `latest` to run the newest `main` build instead of a pinned commit. These are the same environment variables documented above for the local build (`CALL_CENTER_STORAGE`, `DATABASE_URL`, `FRONTEND_ORIGIN`, `PORT`, `WEB_CONCURRENCY`) -- nothing changes about how the API or frontend behave once they're running in a container pulled from GHCR versus one built locally.

## Promoting a published tag to production

`.github/workflows/promote-production.yml` is a manual, `workflow_dispatch`-only workflow that takes an image tag (a commit SHA or `latest`) and points Railway's production service at that exact, already-published tag. It runs under the `production` GitHub Environment and never runs `docker build` -- it only re-points Railway at an image GHCR already has. Before touching Railway it verifies the given tag exists in GHCR for *both* `-api` and `-frontend` images (`docker manifest inspect`); if either is missing, the run fails with no Railway change made.

The actual "point Railway at this image" step is currently a documented placeholder: this workflow does not yet have a `RAILWAY_TOKEN` secret or the production project/service IDs (those land with #27/#28). The tag-existence verification is fully real and runs regardless. Once `RAILWAY_TOKEN` and the service IDs exist, the placeholder step in the workflow file documents exactly what to replace it with.

**Manual one-time setup required**: the `production` environment's required-reviewer protection rule cannot be created by CI -- this repo's `GITHUB_TOKEN` gets a 403 on `PUT .../environments/production`. A repo admin must add it manually: GitHub web UI -> Settings -> Environments -> `production` -> Required reviewers -> add `Tselmeg-C`. Until that's done, `workflow_dispatch` runs against the `production` environment proceed without a human approval gate.
