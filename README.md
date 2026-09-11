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

The TanStack frontend in `apps/frontend` is the active application. Its routes cover the dashboard, customer browsing, administration, imports, assignments, reports and audit views.

Mock controls are available on sign-in and application pages:

- Normal: sign-in and sample reads succeed.
- Loading: the next operation stays pending until you select Normal or reset. Controls remain usable while pending.
- Empty: sample reads return a no-data message.
- Error: the next sign-in or sample read fails once; Retry succeeds. Selecting Error again arms another failure.
- Expired session: clears the session and returns to sign-in with an expiry message. Sign in again to continue, or select Normal first.
- Reset mock state: restores original fixtures, clears scenarios/errors, signs out, and returns to sign-in.

Session and fixture state live only in memory, survive navigation, and reset on a full browser reload. Separate tabs have independent mock state. Logout, expiry, and reset invalidate pending requests; no durable browser storage is used. Mock role guards demonstrate behavior and are not a production security boundary.

Backlog work should extend the routes and services under `apps/frontend`; the former Next prototype is retired.

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
npm test
npm run build
```

The frontend workspace type-checks the route tree during CI; add focused tests alongside future backlog behavior.

GitHub Actions runs installation, linting, type checking, and a production build on pushes and pull requests.

## Production build locally

```sh
npm run build
npm start
```

Open http://localhost:3000. The root npm workspace scripts delegate to `apps/frontend`; dependencies are locked in the root `package-lock.json`.
