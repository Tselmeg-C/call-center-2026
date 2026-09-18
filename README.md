# call-center-2026

Capstone project for AI Dev Zoomcamp 2026: a Sales customer-contact management application.

The active frontend lives in `apps/frontend` and uses TanStack Start with the supplied customer-contact design.

## Local setup

Use Node.js 24 and its bundled npm. If you use nvm, run `nvm install` and `nvm use` from the repository root. No environment variables or credentials are required for this scaffold.

Run all commands from the repository root:

```sh
npm ci
npm run dev -- --port 4174
```

Open http://localhost:4174. Start the optional in-memory API separately with `apps/api/start.sh` (port 8000); the frontend proxies `/api` requests to it.

## Frontend

The TanStack frontend in `apps/frontend` is the active application. Its routes cover the dashboard, customer browsing, customer detail, administration (users, import, assignment, reports, audit), and sign-in.

### Service layer: mock vs. real HTTP

Every route reads and writes through `apps/frontend/src/services` (`types.ts`, `mock.ts`, `http.ts`, `provider.tsx`) instead of static data — one `Services` interface, two implementations, one composition setting:

- `VITE_SERVICE_MODE` unset (the local dev default) uses `mock.ts`, an in-memory adapter seeded with synthetic users and customers. It mirrors the real backend's rules (idempotent mutations by `submissionId`, ownership gates, role checks, single-owner-per-rule bulk assignment) without a running API.
- `VITE_SERVICE_MODE=http` uses `http.ts`, a real `fetch` adapter against the FastAPI backend (`apps/api`), covering every operation in [`packages/shared/openapi.yaml`](packages/shared/openapi.yaml). It defaults to same-origin `/api` (ridden by the Vite dev proxy in `vite.config.ts`); override with `VITE_API_URL` for a split-origin deployment.

Sign-in is real in both modes (`/login`, email + password) and session state comes from `services.subscribeSession`; there are no persona pickers or scenario/reset controls. The mock's seeded accounts all share the password `synthetic-only` (also used by `packages/shared/contract-fixtures.json`): `alex@example.test` (Admin), `river@example.test` and `sky@example.test` (Sales). Signed-out visitors are redirected to `/login`; a Sales session reaching an Admin URL directly is bounced back to the dashboard, and the backend independently rejects the underlying requests regardless.

To run against the real backend:

```sh
CALL_CENTER_STORAGE=memory FRONTEND_ORIGIN=http://localhost:4174 \
  uvicorn apps.api.main:app --port 8000   # apps/api/README.md has the pip install step
VITE_SERVICE_MODE=http npm run dev -- --port 4174
```

`FRONTEND_ORIGIN` must match the origin the frontend actually runs at — the backend rejects unsafe requests (POST/PATCH/PUT/DELETE) from any other Origin (see `packages/shared/service-map.md`).

Known, deliberate gap given the current backend contract: `GET /admin/closure-reasons` is Admin-only, so a Sales session in HTTP mode can't list reasons to close its own customers (the mock relaxes this one read for Sales, since it's non-sensitive reference data).

Customer browsing decisions and display rules are documented in [`_docs/customer-browsing.md`](_docs/customer-browsing.md).
Sales workload bucket definitions, UTC behavior, and the boundary fixture table are documented in [`_docs/workload.md`](_docs/workload.md).
Interaction and note permissions, validation, idempotency, and soft deletion are documented in [`_docs/interactions.md`](_docs/interactions.md).
Follow-up validation, lifecycle transitions, UTC semantics, and next-action rules are documented in [`_docs/follow-ups-lifecycle.md`](_docs/follow-ups-lifecycle.md).
Administration and authentication policies are documented in [`_docs/administration.md`](_docs/administration.md) and [`_docs/authentication.md`](_docs/authentication.md).
Import, assignment, and reporting/audit definitions are documented in [`_docs/excel-import.md`](_docs/excel-import.md), [`_docs/assignment.md`](_docs/assignment.md), and [`_docs/reporting-audit.md`](_docs/reporting-audit.md).
The Sales OpenAPI contract and service mapping are documented in [`_docs/api-contract.md`](_docs/api-contract.md), [`packages/shared/openapi.yaml`](packages/shared/openapi.yaml), and [`packages/shared/service-map.md`](packages/shared/service-map.md).
The local FastAPI authentication service is documented in [`apps/api/README.md`](apps/api/README.md); install its requirements and run `uvicorn main:app --app-dir apps/api --reload` for the single-process in-memory API.
PostgreSQL setup, adapter selection, migrations, and the synthetic benchmark are documented in [`_docs/persistence.md`](_docs/persistence.md). Runtime health, deployment topology, and migration-before-traffic rules are documented in [`_docs/deployment.md`](_docs/deployment.md).

## Checks

```sh
npm run lint
npm run typecheck
npm test              # unit tests: mock/http adapters, UI-shape mapping (vitest)
npm run build
npm run contract:check
```

`npm test` runs `apps/frontend`'s Vitest suite (mock adapter business rules, the HTTP adapter's request shaping and error mapping, and the service-to-UI type adapters) plus the route tree type-check; it needs no running backend.

Two automated real-HTTP journeys (Sales and Admin) exercise `apps/frontend/src/services/http.ts` against the actual FastAPI backend over real network calls, with `CALL_CENTER_STORAGE=memory` — no mocked `fetch`, no ASGI test client. They spawn and tear down their own backend process (`apps/api`'s Python dependencies must already be installed: `pip install -r apps/api/requirements.txt`) and cover import/reimport, manual and bulk assignment, interactions/notes, follow-ups (create/edit/cancel/complete), closure/reopen, reports, audit, and unauthorized direct requests:

```sh
npm run test:journey
```

They're kept separate from `npm test` (a different Vitest config, `apps/frontend/vitest.journey.config.ts`) so the default fast lane never needs Python. The operator secret they need to provision the first Admin (`x-operator-secret`) is generated randomly for each run and passed only to the spawned backend, so no setup is needed: no `.env` entry and no exported variable.

## CI/CD

`.github/workflows/ci.yml` runs `check` (install, contract check, lint, typecheck, unit tests, build, backend auth tests, real-HTTP journeys, PostgreSQL migration + HTTP smoke, benchmark smoke), then publishes and deploys:

| Event | Tests | Docker build | Push image | Deploy |
| --- | --- | --- | --- | --- |
| Push to a feature branch / PR | yes | no | no | no |
| Merge to `main` | yes | yes (once per commit) | `<full-sha>`, `<short-sha>`, `latest` | Railway `development` |
| Push a `v*` tag (e.g. `v1.0.0`) | yes | no (re-tags `main`'s image; builds only if missing) | adds `v1.0.0` | Railway `production`, after approval |
| Docs-only change (`_docs/**`, `**/*.md`, `.claude/**`) | no | no | no | no |

Deploys always pin the full-SHA image. Re-running an old `main` run does not move `latest` or redeploy development; roll back explicitly (see [Rollback](#rollback)).

Cut a release:

```sh
git checkout main && git pull
git tag v1.0.0 && git push origin v1.0.0
```

## Production build locally

```sh
npm run build
npm start
```

Open http://localhost:3000. The root npm workspace scripts delegate to `apps/frontend`; dependencies are locked in the root `package-lock.json`.

## Railway deployment

The app runs on [Railway](https://railway.com) project `call-center-2026` with two isolated environments, `development` and `production` (separate Postgres, separate variables). Full details: [`_docs/deployment.md`](_docs/deployment.md); config-as-code: [`.railway/railway.ts`](.railway/railway.ts) and [`infra/railway.md`](infra/railway.md).

### Services

| Service | Source | Notes |
| --- | --- | --- |
| `Postgres` | Railway managed Postgres plugin | region `ams`, own volume |
| `api` | `ghcr.io/tselmeg-c/call-center-2026-api:<sha>` | runs migrations before traffic; healthcheck `/health/ready`; **exactly 1 replica** (login throttle is process-local) |
| `frontend` | `ghcr.io/tselmeg-c/call-center-2026-frontend:<sha>` | nginx; proxies `/api/` to `api` over Railway's private network |

### One-time setup

Install the CLI (`npm install -g @railway/cli`), then `railway login` and `railway link` to the project.

```sh
railway environment link development
railway add -d postgres -s postgres
railway add -s api --image ghcr.io/tselmeg-c/call-center-2026-api:latest
railway add -s frontend --image ghcr.io/tselmeg-c/call-center-2026-frontend:latest
railway scale ams=1 --service api
railway domain --service api
railway domain --service frontend
```

Set service variables (Railway dashboard → service → Variables, or `railway variables --set "NAME=value" --service <service> --environment <env>`). Never commit the values.

| Service | Variable | Value |
| --- | --- | --- |
| `api` | `CALL_CENTER_STORAGE` | `postgres` |
| `api` | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `api` | `PORT` | `8000` |
| `api` | `WEB_CONCURRENCY` | `1` |
| `api` | `FRONTEND_ORIGIN` | `https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}` |
| `api` | `OPERATOR_PROVISION_SECRET` | long random secret, only for bootstrapping the first Admin |
| `api` | `OTEL_*` | see [Grafana Cloud observability](#grafana-cloud-observability) |
| `frontend` | `PORT` | `8080` |
| `frontend` | `API_UPSTREAM` | `${{api.RAILWAY_PRIVATE_DOMAIN}}:8000` |

GitHub repository settings:

- **Secret `RAILWAY_API_TOKEN`**: a Railway *account* token (railway.com/account/tokens). CI uses it to re-point the `development` services at each new image; a project token can't do that (`Unauthorized`).
- **Environment `production`** (Settings → Environments): add required reviewers, otherwise production promotions run without approval.

### Bootstrap the first Admin

On a fresh database, create the first Admin once; afterwards `POST /operator/provision` returns `409` and further users are created in the app (Admin → Users).

```sh
curl -X POST https://<api-domain>/operator/provision \
  -H 'Content-Type: application/json' \
  -H "x-operator-secret: $OPERATOR_PROVISION_SECRET" \
  -d '{"name":"<name>","email":"<email>","role":"Admin","password":"<12+ chars>"}'
```

Locked out later? Run the local operator console inside the service: `railway run --service api --environment development -- python -m apps.api.operator` and choose `reset`.

### Deploys

- **Development**: automatic on every merge to `main` (see [CI/CD](#cicd)).
- **Production**: push a `v*` tag, or run *Actions → Promote to production* with a full commit SHA. Both go through the `production` approval. (The final Railway call in `promote-production.yml` is still a placeholder until production is provisioned, #28.)

### Rollback

Point the service back at a previous, already-published image — never re-run an old Actions run:

```sh
railway service source connect --image ghcr.io/tselmeg-c/call-center-2026-api:<previous-sha> --service api --environment development
railway service source connect --image ghcr.io/tselmeg-c/call-center-2026-frontend:<previous-sha> --service frontend --environment development
```

For production, run *Actions → Promote to production* with the previous release's SHA.

Health: `GET /health/live` (process up), `GET /health/ready` (database reachable and migrated; body and the `x-app-version` header show the deployed commit SHA).

## Grafana Cloud observability

The API exports traces, metrics and logs over OTLP/HTTP (protobuf) ([`observability/otel_setup.py`](observability/otel_setup.py)); the exporters append `/v1/traces`, `/v1/metrics` and `/v1/logs` to `OTEL_EXPORTER_OTLP_ENDPOINT`. Grafana Cloud's `/otlp` gateway doesn't speak gRPC, so `OTEL_EXPORTER_OTLP_PROTOCOL` is not used. It's configured only by environment variables; with `OTEL_EXPORTER_OTLP_ENDPOINT` unset, OTel is fully disabled (local dev and CI). Only an allowlist of attributes (route, method, status, DB operation, request id) is ever exported — no cookies, credentials, notes or workbook content.

### Setup

1. In Grafana Cloud, open **Connections → Add new connection → OpenTelemetry (OTLP)** and create a token. Its access policy should only have `metrics:write`, `logs:write` and `traces:write`.
2. Copy the endpoint and the ready-made `Authorization=Basic ...` header from that page (the value is `base64(instanceID:token)`, don't assemble it by hand).
3. Set on the Railway `api` service, per environment:

   | Variable | Value |
   | --- | --- |
   | `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://otlp-gateway-<region>.grafana.net/otlp` |
   | `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic <from step 2>` |
   | `OTEL_SERVICE_NAME` | `call-center-api` |
   | `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=development` for dev (matches the Railway environment name), or `prod` |

   Dev and prod share one Grafana Cloud stack; `deployment.environment` tells them apart.
4. Redeploy `api`, send a few requests, then check **Explore** (Tempo for traces, Loki for logs, Prometheus for `http_server_request_duration_seconds_*`).

### Dashboard

Import [`observability/grafana-dashboard.json`](observability/grafana-dashboard.json) via **Dashboards → New → Import** or `POST /api/dashboards/db` (request rate, 5xx rate and p95 latency for `/customers`, `/workload`, `/sales/workload`, `/admin/reports`, plus log volume and recent log lines, per environment). Regenerate it with `python3 -m observability._gen_grafana_dashboard > observability/grafana-dashboard.json`. Importing via the Grafana HTTP API needs a Grafana **service account token** (Editor), not the OTLP ingest token. It's live at `/d/call-center-api/call-center-api-request-telemetry` on the stack.

- **Datasources:** panels use the `$metrics` / `$logs` datasource variables, preselected by regex to the stack's `grafanacloud-*-prom` / `grafanacloud-*-logs`, so no panel needs editing after import.
- **Environment filter:** `deployment.environment` is a resource attribute, so metric panels join it from `target_info`: `... * on (job, instance) group_left(deployment_environment) max by (job, instance, deployment_environment) (target_info{job="call-center-api", deployment_environment="$environment"})`. The `max by` keeps the join one-to-one when a `(job, instance)` has several `target_info` series. The `Environment` dropdown reads `label_values(target_info{job="call-center-api"}, deployment_environment)`. Loki panels filter the `service_name` / `deployment_environment` stream labels directly.

OTel names show up in Grafana with underscores: `http.route` → `http_route`, `deployment.environment` → `deployment_environment`, `http.server.request.duration` → `http_server_request_duration_seconds`. Metrics carry `job="call-center-api"` (from `service.name`).

## Containers

`apps/api/Dockerfile` and `apps/frontend/Dockerfile` build reproducible images for both apps; `infra/docker-compose.yml` runs the full stack (`postgres`, `api`, `frontend`) in containers with `docker compose -f infra/docker-compose.yml up --build`. This is additive -- the non-container `npm run dev` / `apps/api/start.sh` workflow above keeps working unchanged. `npm run smoke:containers` builds both images and smoke-checks them against `infra/docker-compose.test.yml`'s Postgres. See [`_docs/deployment.md`](_docs/deployment.md) for exact commands and details.
