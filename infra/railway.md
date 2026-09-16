# Railway config-as-code (#27)

The installed Railway CLI (v5.57.2) authors project config as TypeScript, not
`railway.json`/`railway.toml` (confirmed via `railway config --help`, which
lists `init`/`plan`/`apply`/`pull`, with `migrate` reserved for translating an
old JSON/TOML file -- there was none in this repo). The CLI always persists
that file at the nearest `.railway/railway.ts` relative to the repo root, so
the real, `railway config pull`-verified artifact lives at
[`/.railway/railway.ts`](../.railway/railway.ts) (auto-generated usage notes
in [`/.railway/README.md`](../.railway/README.md)), not under `infra/`. This
file is the `infra/`-side pointer to it, per issue #27's constraint to keep
Railway configuration documented under `infra/` "plus whatever `.railway/`
authoring file the installed CLI actually persists".

Running `railway config plan`/`apply` requires the `railway` npm package
(`npm install railway`, added as a root devDependency) -- the CLI resolves
`.railway/railway.ts`'s `import ... from "railway/iac"` against it.

## Topology (`development` environment)

- `Postgres` -- Railway's managed Postgres plugin (`railway add -d postgres`),
  one region (`ams`), one replica, with its own volume. Not an external
  instance.
- `api` -- image source `ghcr.io/tselmeg-c/call-center-2026-api:latest`,
  connected via `railway service source connect --image`. Start command is
  `apps/api/start.sh`, baked into the image's `CMD` -- not re-specified here.
  Pinned to exactly one replica in one region (`ams`) via `railway scale
  ams=1`, required for the process-local login-throttle counters (see
  `_docs/deployment.md`).
- `frontend` -- image source
  `ghcr.io/tselmeg-c/call-center-2026-frontend:latest`, same `source connect`
  approach. Start command is the nginx entrypoint baked into the image.

## Variable wiring

- `api`'s `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway variable
  reference to the Postgres plugin's own connection string).
- `frontend`'s `API_UPSTREAM` = `${{api.RAILWAY_PRIVATE_DOMAIN}}:8000` --
  consumed by `apps/frontend/nginx/default.conf.template`'s `/api/` reverse
  proxy at container start (nginx's own envsubst templating, not a Vite
  build-time value). This, not a build-time API domain, is what wires the
  frontend to the API: the frontend's HTTP adapter defaults to a relative
  `/api` base URL (`apps/frontend/src/services/http.ts`), so the browser
  always talks to the frontend's own domain and nginx proxies server-side.
- `api`'s `FRONTEND_ORIGIN` = `https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}`
  once the frontend's public domain exists (see the open item in the issue
  #27 status comment -- domain creation was blocked in the implementing
  session's sandbox and needs a human `railway domain` run).
- `api`'s `PORT=8000`, `WEB_CONCURRENCY=1`, `CALL_CENTER_STORAGE=postgres`.

Full names-only variable list, HTTPS origins, and commands are documented in
[`_docs/deployment.md`](../_docs/deployment.md).

## Healthcheck

`.railway/railway.ts` sets `api`'s `deploy.healthcheckPath` to
`/health/ready` with a 30s timeout, validated with `railway config plan`.
Applying it to the live project (`railway config apply --yes`) was blocked by
the implementing session's sandbox permissions (see the issue #27 status
comment) and needs a human to run it.
