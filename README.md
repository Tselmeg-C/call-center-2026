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

Known, deliberate gaps given the current backend contract (not introduced by this frontend work): `GET /admin/closure-reasons` is Admin-only, so a Sales session in HTTP mode can't list reasons to close its own customers (the mock relaxes this one read for Sales, since it's non-sensitive reference data); `PATCH /admin/assignment-rules` supports one owner per rule with no per-field conditions, so the Assignment screen's per-rule "conditions" text is a generated description of that behavior, not a stored condition language.

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

They're kept separate from `npm test` (a different Vitest config, `apps/frontend/vitest.journey.config.ts`) so the default fast lane never needs Python.

GitHub Actions runs installation, linting, type checking, unit tests, and a production build on pushes and pull requests.

## Production build locally

```sh
npm run build
npm start
```

Open http://localhost:3000. The root npm workspace scripts delegate to `apps/frontend`; dependencies are locked in the root `package-lock.json`.

## Containers

`apps/api/Dockerfile` and `apps/frontend/Dockerfile` build reproducible images for both apps; `infra/docker-compose.yml` runs the full stack (`postgres`, `api`, `frontend`) in containers with `docker compose -f infra/docker-compose.yml up --build`. This is additive -- the non-container `npm run dev` / `apps/api/start.sh` workflow above keeps working unchanged. `npm run smoke:containers` builds both images and smoke-checks them against `infra/docker-compose.test.yml`'s Postgres. See [`_docs/deployment.md`](_docs/deployment.md) for exact commands and details.
