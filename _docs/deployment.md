# Deployment

The API exposes `/health/live` for process liveness and `/health/ready` for readiness. Local development uses `CALL_CENTER_STORAGE=memory`; PostgreSQL deployments must set `CALL_CENTER_STORAGE=postgres`, `DATABASE_URL`, and the exact HTTPS `FRONTEND_ORIGIN`, run Alembic migrations before traffic, and keep secrets in Railway environment variables. No deployment or production smoke is claimed until the platform checks are run.

For local development, run the frontend with `npm run dev -- --port 4174` and the API with `apps/api/start.sh` on port 8000. The Vite proxy maps frontend `/api` requests to the API.

The development process starts with `apps/api/start.sh`; in PostgreSQL mode it runs `alembic upgrade head` before launching `uvicorn`, and a failed migration stops startup. The script rejects `WEB_CONCURRENCY` values other than `1` while failed-login counters are process-local. `/health/live` has no database dependency, while `/health/ready` verifies connectivity and the migrated `users` table. A failed migration or readiness check must prevent traffic promotion.

Use `npm run benchmark:api` for the safe synthetic query benchmark. Logs and smoke evidence must contain request IDs, status, timings, and safe counts only; never include cookies, connection strings, workbook contents, notes, or credentials.

## OpenTelemetry

`apps/api` (see `observability/otel_setup.py`) instruments every request (FastAPI), every DB query
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
`observability/test_otel.py` asserts this against in-memory OTel exporters (never a live endpoint).

`observability/grafana-dashboard.json` is a validated Grafana dashboard JSON model (not uploaded to any
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

The API image is `python:3.12-slim` (matches CI); the builder stage installs `apps/api/requirements.txt` and the runtime stage copies the installed packages plus the `apps/api` and `observability` source, runs as a non-root user, and execs the unchanged `apps/api/start.sh` -- the migration-before-traffic gate, the `WEB_CONCURRENCY` guard, and `/health/live`/`/health/ready` all behave exactly as they do outside a container. Run it with the same environment variables as any other deployment (`CALL_CENTER_STORAGE`, `DATABASE_URL` when in postgres mode, `FRONTEND_ORIGIN`, `PORT`); nothing environment-specific is baked into the image.

The frontend image builds with `node:24-alpine` (matches `.nvmrc`) and serves the resulting `dist/` bundle from `nginx:1.27-alpine` -- no Node runtime or extra static-server dependency ships in the final image. nginx's official envsubst-templates mechanism (`apps/frontend/nginx/default.conf.template`) substitutes `$PORT` at container start and falls back unmatched routes to `index.html` for the client-side router.

`infra/docker-compose.yml` adds optional `api` and `frontend` services alongside `postgres`, so `docker compose -f infra/docker-compose.yml up --build` runs the whole stack in containers locally:

```sh
POSTGRES_PASSWORD=<local-only-value> docker compose -f infra/docker-compose.yml up --build
```

This is additive: the non-container `npm run dev` / `apps/api/start.sh` workflow keeps working unchanged, and nothing here requires containers for day-to-day development.

`infra/smoke-test.sh` (`npm run smoke:containers`) is the container-run smoke check: it builds both images, starts `infra/docker-compose.test.yml`'s Postgres, runs the API and frontend containers against it, and asserts `/health/ready` returns healthy and the frontend serves its index page.

## Publishing images to GHCR

Every push to `main` that passes `check` in `.github/workflows/frontend.yml` runs a `publish` job (`needs: check`) that builds and pushes both images to GitHub Container Registry, from the same `apps/api/Dockerfile` and `apps/frontend/Dockerfile` used for the local `docker build` commands above -- CI does not diverge from them. Pull requests (including from forks) and other branches skip the `publish` job entirely; they only run `check`.

Images are published as:

- `ghcr.io/<owner>/<repo>-api`
- `ghcr.io/<owner>/<repo>-frontend`

with `<owner>` and `<repo>` lowercased (GHCR requires lowercase paths). For this repository that's `ghcr.io/tselmeg-c/call-center-2026-api` and `ghcr.io/tselmeg-c/call-center-2026-frontend`. Each successful `main` push tags both images with the full commit SHA, the short (7-char) commit SHA, and moves the `latest` tag to point at that same build -- `latest` is the newest `main` build, a commit SHA is a pinned, reproducible one. A pushed `v*` release tag (e.g. `v1.2.0`) runs the same tests and build, publishes the full SHA, short SHA and release-tag name (it does not move `latest` and does not deploy development), then calls the production promotion below with that commit's SHA.

| Event | Tests | Docker build | Push image | Deploy |
| --- | --- | --- | --- | --- |
| Push feature branch (incl. merging `main` into it) | yes | no | no | no |
| PR opened/updated | yes | no | no | no |
| Merge to `main` | yes | yes | yes | development |
| Push `v*` tag | yes | yes | yes | production (via `promote-production.yml`, `production` environment gate) |

These images are published at GHCR's default visibility for a `GITHUB_TOKEN`-authored package on a public repository, which is **public** (verified while implementing #27: an anonymous `ghcr.io/token` request and unauthenticated manifest pull both succeed for `call-center-2026-api`). This is what lets Railway's `--image` service source pull them directly -- `railway service source connect --image` has no registry-credential flags, so an image-sourced service needs a publicly pullable image.

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

`.github/workflows/promote-production.yml` is a manual `workflow_dispatch` workflow (also called automatically by `frontend.yml` after a `v*` release tag publishes its images) that takes an image tag (a commit SHA or `latest`) and points Railway's production service at that exact, already-published tag. It runs under the `production` GitHub Environment and never runs `docker build` -- it only re-points Railway at an image GHCR already has. Before touching Railway it verifies the given tag exists in GHCR for *both* `-api` and `-frontend` images (`docker manifest inspect`); if either is missing, the run fails with no Railway change made.

The actual "point Railway at this image" step is currently a documented placeholder: this workflow does not yet have a `RAILWAY_TOKEN` secret or the production project/service IDs (those land with #27/#28). The tag-existence verification is fully real and runs regardless. Once `RAILWAY_TOKEN` and the service IDs exist, the placeholder step in the workflow file documents exactly what to replace it with.

**Manual one-time setup required**: the `production` environment's required-reviewer protection rule cannot be created by CI -- this repo's `GITHUB_TOKEN` gets a 403 on `PUT .../environments/production`. A repo admin must add it manually: GitHub web UI -> Settings -> Environments -> `production` -> Required reviewers -> add `Tselmeg-C`. Until that's done, `workflow_dispatch` runs against the `production` environment proceed without a human approval gate.

## Railway `development` environment (#27)

Project `call-center-2026` (Railway project id `e7501ba0-4b15-42e1-a4a5-e4a4aaba614b`) has two
environments, `production` and `development`. This section covers `development` only --
`production` is #28. The two environments are fully isolated: separate Postgres plugin instances
(separate volumes, separate generated credentials), separate service env vars, no shared secret.

### Topology

| Service | Source | Purpose |
| --- | --- | --- |
| `Postgres` | Railway managed Postgres plugin (`railway add -d postgres`) | Database, one region (`ams`), one replica, its own volume |
| `api` | `ghcr.io/tselmeg-c/call-center-2026-api:latest` (or a commit SHA), via `railway service source connect --image` | Runs `apps/api/start.sh` unmodified (migration-before-traffic gate, `/health/live`, `/health/ready`) |
| `frontend` | `ghcr.io/tselmeg-c/call-center-2026-frontend:latest` (or a commit SHA), via `railway service source connect --image` | nginx serving the `npm run build` output, reverse-proxies `/api/` to `api` |

The real, `railway config pull`-verified config-as-code is committed at
[`/.railway/railway.ts`](../.railway/railway.ts); see [`infra/railway.md`](../infra/railway.md)
for what it names and why it lives there instead of under `infra/`.

Reproducing this from scratch:

```sh
railway environment link development
railway add -d postgres -s postgres
railway add -s api --image ghcr.io/tselmeg-c/call-center-2026-api:latest
railway add -s frontend --image ghcr.io/tselmeg-c/call-center-2026-frontend:latest
railway service source connect --image ghcr.io/tselmeg-c/call-center-2026-api:latest --service api
railway service source connect --image ghcr.io/tselmeg-c/call-center-2026-frontend:latest --service frontend
railway scale ams=1 --service api   # exactly one replica -- required, see below
```

(`railway scale` with no region args, as the CLI's own `--help` describes, errored on the
installed CLI version -- `railway scale ams=1` is the form that actually worked; noted here since
it contradicts that help text.)

### Environment variables (names only -- see Credentials below for why no values are here)

| Service | Variable | Source |
| --- | --- | --- |
| `api` | `CALL_CENTER_STORAGE` | literal `postgres` |
| `api` | `DATABASE_URL` | Railway reference `${{Postgres.DATABASE_URL}}` |
| `api` | `PORT` | literal `8000` |
| `api` | `WEB_CONCURRENCY` | literal `1` (required -- see login throttle below) |
| `api` | `FRONTEND_ORIGIN` | Railway reference `${{frontend.RAILWAY_PUBLIC_DOMAIN}}` (as `https://...`) -- **not yet set, see Known gaps** |
| `api` | `OPERATOR_PROVISION_SECRET` | operator-only bootstrap secret, required by `POST /operator/provision` -- see Bootstrapping below (value not recorded here, see Credentials) |
| `api` | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | unset in this environment -- see OpenTelemetry above; #44 points these at a real Grafana Cloud account |
| `frontend` | `PORT` | literal `8080` (image default) |
| `frontend` | `API_UPSTREAM` | Railway reference `${{api.RAILWAY_PRIVATE_DOMAIN}}:8000` |

HTTPS origins: both services get a Railway-issued `*.up.railway.app` HTTPS domain
(`railway domain --service api`, `railway domain --service frontend`) -- **not yet created, see
Known gaps**.

### How the frontend reaches the API

`apps/frontend/src/services/http.ts` defaults its base URL to the relative `/api` (mirroring the
Vite dev proxy in `apps/frontend/vite.config.ts`), not a build-time API domain. In production,
`apps/frontend/nginx/default.conf.template`'s `/api/` location reverse-proxies to `API_UPSTREAM`
(the API's Railway private-network domain) at container start, via nginx's own envsubst
templating. So the browser only ever talks to the frontend's own HTTPS domain, and that domain is
also what it sends as `Origin` on unsafe requests -- which is why `api`'s `FRONTEND_ORIGIN` must
be the frontend's public domain, not the API's own. `apps/frontend/Dockerfile` bakes
`VITE_SERVICE_MODE=http` in at build time so a deployed image never falls back to the in-memory
mock adapter (verified locally: `infra/smoke-test.sh` builds both images and asserts the
frontend's proxied `/api/health/ready` matches the API's own response).

**DNS re-resolution (fixed post-QA-FAIL on #27):** a plain `proxy_pass http://${API_UPSTREAM}/;`
(a literal string once envsubst substitutes it) is resolved by nginx exactly once, at worker
startup, and then cached for the life of the process -- there is no periodic re-resolution.
`API_UPSTREAM` is a Railway private-network **hostname**, and that hostname's IP changes every
time the `api` service redeploys (new container, new private IP). The frontend's nginx doesn't
restart on the API's redeploys, so it kept silently proxying to the now-dead old IP -- every
`/api/*` request hung until it hit Railway edge's own timeout and came back as a `504`. This
was reproduced live 4/4 times against `frontend-development-83f4.up.railway.app`. The fix:
`default.conf.template` now declares `resolver ${NGINX_LOCAL_RESOLVERS} valid=10s;` (nginx's
own async resolver, using the container's real nameserver(s) from `/etc/resolv.conf`, populated
by the base `nginx:1.27-alpine` image's built-in `15-local-resolvers.envsh` -- turned on via
`NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1` in `apps/frontend/Dockerfile`) and uses a variable
(`set $api_upstream http://${API_UPSTREAM}; proxy_pass $api_upstream;`) instead of a literal
string in `proxy_pass`, so nginx re-resolves `API_UPSTREAM` at most every 10s instead of once at
startup. Using a variable in `proxy_pass` also turns off nginx's automatic `/api/`-prefix
stripping, so the location now does that explicitly first (`rewrite ^/api/(.*)$ /$1 break;`,
*before* the `set` -- `break` stops any later directives, including `set`, from running in that
location). Verified locally (this sandbox's docker bridge networking doesn't forward
container-to-container traffic, so the check runs on the host network namespace): two
`nginx:1.27-alpine` containers, one built from the old static-hostname config and one from the
fixed variable+resolver config, both pointed at a throwaway DNS server answering a private
hostname; flipping the DNS answer to a second backend without restarting nginx (simulating an
API redeploy) left the old config permanently stuck on the first, now-dead backend, while the
fixed config picked up the new backend automatically within the 10s TTL. `infra/smoke-test.sh`
also asserts the rendered config actually has a resolver directive (its own upstream is an IP
literal, so it can't exercise DNS re-resolution itself, but it catches a regression that removes
the mechanism).

### Version identification

`GET /health/ready`'s body includes `"version"` (the image's commit SHA, baked in at
`docker build --build-arg GIT_SHA=$GITHUB_SHA`, see `apps/api/Dockerfile`) and `"migration"` (the
current Alembic revision). Every response, including `/health/live` and error responses, also
carries an `x-app-version` header with the same commit SHA -- so the deployed version is visible
without shell access via either surface.

### Auto-deploy on every `main` build

`.github/workflows/frontend.yml`'s `publish` job, after pushing both images, calls
`railway service source connect --image ...:$GITHUB_SHA --service <api|frontend> --environment
development --yes` for each service, authenticated with a Railway project token in the
`RAILWAY_TOKEN` GitHub Actions secret. This is a CI-triggered redeploy, not a Railway-side
webhook: the installed CLI pins an image-sourced service to one fixed reference and (confirmed via
`railway service source --help`) only GitHub-repo sources get an automatic redeploy trigger on
their own -- a Docker-image source does not notice a new tag landing in GHCR by itself. Production
promotion stays the separate, human-approved `workflow_dispatch` in `promote-production.yml`
(#28); every `development` deploy after this issue is unattended.

### Trusted-proxy assumption for the login throttle

The per-IP login throttle (`apps/api/main.py`'s `login`, 50 failures/IP/15min, plus the per-email
5/15min one) needs the real client IP. `request.client.host` is always a proxy hop once anything
sits in front of the process, never the browser. `X-Forwarded-For` is a comma-separated list that
each hop *appends its own address to the right end of*, so the only entry a client can never
overwrite or displace is the one a fixed number of positions in from the right -- counting from
the *left* (`.split(",")[0]`, the previous, now-fixed behavior) is exactly backwards: a client can
prepend as many fake entries as it likes, which only ever pushes new entries further left and
never touches the right end, so the left-most entry is always attacker-controlled. `client_ip()`
now reads `TRUSTED_PROXY_HOPS` entries in from the right instead.

**Trusted-hop count: `TRUSTED_PROXY_HOPS = 2`**, justified against both ways this login endpoint
can currently be reached:

- **Through the frontend's `/api/` nginx proxy** (`apps/frontend/nginx/default.conf.template`) --
  the only path real production traffic takes today, since the API's own public Railway domain
  isn't provisioned yet (see Known gaps below, tracked under #27). Two trusted hops sit between
  the browser and this process: Railway's edge, and this app's own frontend nginx. Each appends
  the address of whoever connected to it, so for a clean request the header ends up
  `<client-or-forged-entries>, <browser's real address as nginx saw it>, <nginx's own address as
  Railway's edge saw it>` -- the second-from-right entry is the real client, which is exactly what
  `TRUSTED_PROXY_HOPS = 2` reads. A client can prepend anything it wants; it only ever lands to the
  left of that position, never at or past it.
- **Directly against the API service's own public `*.up.railway.app` domain** (provisioned under
  #27's Known gaps, not by this issue) -- only one trusted hop exists on that path, Railway's edge.
  `TRUSTED_PROXY_HOPS = 2` does not match this path, and #58 deliberately does not special-case it
  (out of scope: provisioning/restricting that domain is #27's job, not the throttle's). What the
  throttle does if a login request arrives this way: if the client sends no `X-Forwarded-For` of
  its own, Railway's edge still appends its own view of the connecting client, giving a 1-entry
  header -- shorter than `TRUSTED_PROXY_HOPS`, so `client_ip()` falls back to `request.client.host`
  (Railway edge's address), bucketing every such request behind one shared counter rather than
  crashing or trusting a client-controlled value. If the client instead sends its own single fake
  entry, the header reaches the 2-entry length `TRUSTED_PROXY_HOPS` expects, and the attacker's own
  fake entry -- not the real client -- ends up read: the throttle can be bypassed by IP the same
  way it could before this fix, but only via a path that isn't part of this deployment's traffic
  yet. Closing that gap means removing or restricting the API's own public domain, which is #27's
  responsibility per #58's declared scope, not a case this fix special-cases.

A missing, empty, or too-short (fewer than `TRUSTED_PROXY_HOPS` comma-separated entries)
`X-Forwarded-For`, or one whose entry at that position is blank, falls back to
`request.client.host` (`"unknown"` if even that is unavailable) rather than raising or silently
trusting a client-controlled value.

This is pinned to exactly one API replica in one region (`railway scale ams=1`) because these
counters are held in Python process memory (`repo.login_failures*`), not a shared store --
`apps/api/start.sh` already refuses to boot with `WEB_CONCURRENCY != 1` for the same reason, and a
second replica would silently halve each counter's effectiveness.

### Bootstrapping the first Admin account (Postgres-backed deployments)

`POST /operator/provision` (undocumented/`include_in_schema=False`, see `apps/api/main.py`)
creates a user and is safe to expose over HTTP in every storage mode: it refuses with `409` the
moment any user already exists, in-memory or Postgres (`repo.users` / `auth_db.all_users()`), so
it can only ever bootstrap the very first account on a fresh deployment -- after that, an
authenticated Admin creates further accounts (Sales included) through `POST /admin/users`.
`POST /operator/reset-password/{user_id}` has no such "nothing provisioned yet" guard -- it can
reset *any* existing user's password given only their id, unauthenticated -- so it stays
registered only when **both** `CALL_CENTER_STORAGE=memory` **and** the explicit opt-in
`CALL_CENTER_ENABLE_OPERATOR_RESET` env flag are set (a local dev/test convenience). The flag
defaults to disabled -- unset, `0`, or `false` -- and is independent of storage mode: memory mode
alone (flag unset) does not register the route, and setting the flag under
`CALL_CENTER_STORAGE=postgres` does not register it either. Enabling it against a real deployment
would be an unauthenticated account-takeover endpoint.

**#59:** the route also requires the `x-operator-secret` request header to match the
`OPERATOR_PROVISION_SECRET` env var (compared with `hmac.compare_digest`, not `==`). This check
runs *before* the "any user already exists" lookup above, so a missing/wrong secret always gets
the same `401` regardless of whether a deployment has already been claimed -- an unauthenticated
caller can't use the response to learn deployment state. If `OPERATOR_PROVISION_SECRET` is unset,
the route rejects every request in every storage mode (fails closed, no fallback to the old
unauthenticated behavior). The secret is never logged, returned, or included in any error body.

```sh
curl -X POST https://<api-domain>/operator/provision \
  -H 'Content-Type: application/json' \
  -H 'x-operator-secret: <OPERATOR_PROVISION_SECRET value>' \
  -d '{"name":"<name>","email":"<email>","role":"Admin","password":"<new password>"}'
```

Verified locally against a real `CALL_CENTER_STORAGE=postgres` container (API built from
`apps/api/Dockerfile`, pointed at `infra/docker-compose.test.yml`'s Postgres): the first
`/operator/provision` call with the correct header returns `200` and the new Admin can immediately
`POST /session/login`; a second call returns `409`. Before this fix the route was registered only
when `storage_mode == "memory"`, so it 404'd against any Postgres-backed deployment -- there was no
HTTP-reachable way to create the first account without direct DB/SSH access, which blocked #27's
synthetic smoke journey and most of its RBAC/session regression checks.

### Failure drill (run locally against real containers + Postgres while implementing #27)

`docker pause` on the test Postgres container (`infra/docker-compose.test.yml`), against an API
container built from `apps/api/Dockerfile` and pointed at it, black-holes an already-open
connection -- no connect error, no reset, the TCP peer just never answers. Observed behavior:

1. Before the drill fix below, `GET /health/ready` hung indefinitely (over a minute, aborted
   manually) instead of failing -- the readiness check's `engine.connect()` had no bound.
2. Fixed in `apps/api/main.py` (`_check_postgres_ready` run through a `ThreadPoolExecutor` with a
   5s `HEALTH_READY_TIMEOUT_SECONDS`): re-ran the same drill, `GET /health/ready` returned
   `503 {"detail":"Storage is not ready."}` in exactly 5s.
3. `docker compose ... unpause postgres`: the very next `/health/ready` call returned
   `200 {"status":"ok","storage":"postgres",...}` with no data loss and no restart needed.
4. While the same drill was set up, a second, unrelated gap surfaced: `docker logs` showed no
   `request id=...` line at all for any request, healthy or failing -- see the log-visibility fix
   in the same commit as the timeout fix, and its test.

This is a container-level drill (`docker pause`, not Railway's own Postgres plugin), because
`railway domain`/live Railway access was blocked in this session -- see Known gaps below for
what's left to re-run against the actual deployed `development` URL: pausing/detaching the real
Railway Postgres plugin, confirming `/health/ready` returns 503 there too, and confirming Railway
keeps routing to the last good deployment during a broken-migration redeploy (the CLI's
`service source connect --image` immediately pins to a new reference, so this needs the plugin-
pause approach or a deliberately broken migration on a redeploy, not a connect-level drill).

### Rollback

`railway service source connect --image ghcr.io/tselmeg-c/call-center-2026-api:<previous-sha>
--service api --environment development --yes` is the supported rollback for an image-sourced
service on the installed CLI -- re-pointing at a known-good, already-published tag. `railway down`
removes the *most recent deployment*, which for an image-sourced service is a disconnect/redeploy
of the same reference, not a revision to a different tag, so it is not the right tool for "go back
to the previous commit"; `railway redeploy` reruns the *current* deployment, which does not help
either if the current image is the broken one. Use the `service source connect --image
<previous-sha>` form.

### Known gaps -- blocked in the implementing session, need a human follow-up

The sandbox this issue was implemented in has its own permission layer (separate from Railway's
own permissions) that blocks anything it classifies as "creating public surface" -- this refused
`railway domain` (for both services) and `docker push` of a verification image tag to GHCR. Since
those are exactly what several acceptance criteria below depend on, they could not be exercised
end-to-end in that session. What's still open, and the exact commands to close each gap, are in
the issue #27 status comment rather than duplicated here (so there is one place tracking it).

