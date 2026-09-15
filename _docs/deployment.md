# Deployment

The API exposes `/health/live` for process liveness and `/health/ready` for readiness. Local development uses `CALL_CENTER_STORAGE=memory`; PostgreSQL deployments must set `CALL_CENTER_STORAGE=postgres`, `DATABASE_URL`, and the exact HTTPS `FRONTEND_ORIGIN`, run Alembic migrations before traffic, and keep secrets in Railway environment variables. No deployment or production smoke is claimed until the platform checks are run.

For local development, run the frontend with `npm run dev -- --port 4174` and the API with `apps/api/start.sh` on port 8000. The Vite proxy maps frontend `/api` requests to the API.

The development process starts with `apps/api/start.sh`; in PostgreSQL mode it runs `alembic upgrade head` before launching `uvicorn`, and a failed migration stops startup. The script rejects `WEB_CONCURRENCY` values other than `1` while failed-login counters are process-local. `/health/live` has no database dependency, while `/health/ready` verifies connectivity and the migrated `users` table. A failed migration or readiness check must prevent traffic promotion.

Use `npm run benchmark:api` for the safe synthetic query benchmark. Logs and smoke evidence must contain request IDs, status, timings, and safe counts only; never include cookies, connection strings, workbook contents, notes, or credentials.

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
