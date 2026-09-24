---
name: railway-project
description: >
  This repo's Railway setup (call-center-2026) - project/environment/service IDs and URLs, how
  development and production get deployed and rolled back, the `.railway/railway.ts` `:latest`
  policy, which Railway actions the sandbox blocks, and the Postgres restart drill. Use whenever
  you touch Railway for THIS project: checking what's deployed, reading logs, deploys/promotions,
  rollbacks, `railway config plan/pull/apply`, env vars, CI deploy steps, failure drills, or a
  Railway error in CI. Generic Railway CLI knowledge (token types, flags, install) lives in the
  user-level `railway` skill; this one only adds what's specific to this repo.
---

# Railway for call-center-2026

Never print, log, or paste credentials (AGENTS.md). Variable **names** are fine; values are not.
Deeper references: `_docs/deployment.md` (Railway sections), `infra/railway.md`, `_docs/on-call.md`.

## IDs and URLs

Project `call-center-2026`: `e7501ba0-4b15-42e1-a4a5-e4a4aaba614b`, region `ams`.

| Env | Env ID | Services (service ID) |
|---|---|---|
| `development` | `dbdc7225-c0f7-4503-a001-4c469b4fcce4` | `api` (`e4bab9cf-0568-466c-a007-97b86f019c19`), `frontend` (`0e321c01-cfd5-49eb-a251-e16923cdead4`), `Postgres` (`48ccdcfa-1dfc-4b20-b529-9d9280fc185c`) |
| `production` | `8a8a5a0a-d60a-4aba-b086-b085c4f414b2` | `api-prod` (`ce37248b-d463-44e7-950d-f1ef2654a753`), `frontend-prod` (`26fc0b55-0b59-4db4-8621-2b426047e998`), `postgres-prod` (`b82d2c96-834d-4f80-8863-56a38dc5d8bf`) |

Service names are unique across the whole project, which is why production has the `-prod` names.

- Dev API: `https://api-development-2a42.up.railway.app`
- Dev app: `https://frontend-development-83f4.up.railway.app` (the API is also reachable at `/api/*`)
- Prod app: `https://frontend-prod-production-d39f.up.railway.app`. `api-prod` has no public
  domain, so reach it through `/api/*` on the frontend.

"What's deployed?" `curl -s <host>/health/ready` returns `version` (the commit SHA) and `migration`
(the Alembic revision). Every response also carries an `x-app-version` header.

## Tooling: prefer the Railway MCP, and always name the environment

- For reads (logs, status, variables), use the `mcp__railway__*` tools with explicit `projectId`,
  `serviceId` and `environmentId`.
  - **If `environmentId` is omitted, the tools default to `production`.**
  - To see the health probes, use `get-logs` with `types: ["http"]` and `filter: "@path:/health/ready"`.
  - Grafana Synthetic Monitoring probes show up with the UA `synthetic-monitoring-agent`, every 60 s.
- The main checkout's `railway link` targets **production**. Pass `--environment development`
  (and `--service`) on every CLI command. Relink (`railway environment link development`) before
  running `railway config plan` against dev.
- Never run `railway variables` or `railway environment config` in any mode that prints raw
  values. `environment config --json` leaks the Postgres password.

## How code reaches Railway (build once, promote the same image)

- **Merge to `main`, then development (automatic).** In `.github/workflows/ci.yml`, the
  `Deploy development (Railway)` step runs
  `railway service source connect --image ghcr.io/tselmeg-c/call-center-2026-{api,frontend}:$GITHUB_SHA --service {api,frontend} --environment development --project $RAILWAY_PROJECT_ID`.
  - It runs only when the commit is still the head of `main`.
  - Auth is `RAILWAY_API_TOKEN`, an account token. A Project Token gets "Unauthorized" on this mutation.
  - There's no `--yes`; `source connect` rejects it.
  - The CLI is pinned to `@railway/cli@5.57.5`.
  - An image-sourced service never redeploys on its own when a new tag is pushed. This step *is* the deploy.
- **`v*` tag, then production.** `promote-production.yml` re-points `api-prod` and `frontend-prod`
  at an existing GHCR tag.
  - It runs automatically after a tag push, or by hand via `workflow_dispatch`.
  - It checks that both images exist before it changes anything.
  - The `production` GitHub environment needs the owner's approval.
  - `gh workflow run` from a codespace gets a 403, so start manual promotions from the Actions web UI.
  - Promote the exact SHA that dev runs, not `latest`.
- **Rollback.**
  - Dev: `railway service source connect --image <image>:<previous-sha> --service api --environment development`,
    and the same for `frontend`.
  - Prod: run `promote-production.yml` with the previous SHA.
  - Never re-run an old Actions run.
  - `railway down` and `railway redeploy` don't change which image a service uses.

## Config-as-code: `.railway/railway.ts`

- It pins `api` and `frontend` to `:latest` on purpose (#155). CI owns the exact SHA, and `latest`
  only moves for the head of `main`, so `config apply` can never roll dev back.
- `railway config plan` always shows `<sha> -> latest` for both images. That is expected, not drift.
- After `railway config pull`, reset both refs to `:latest`. The CI `check` job runs
  `.github/workflows/test-railway-image-latest.sh`, which fails on any other ref.
- `plan` and `apply` need `npm install` at the repo root, which provides the `railway` package for
  `railway/iac`.
- Env vars in the file are `preserve()`, so their values live only in Railway.
- Detecting live drift in non-image settings is open in #156, which waits on the owner's choice of CI token.

## Wiring (names only)

- `api`:
  - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
  - `FRONTEND_ORIGIN=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}`, which must be the frontend's own domain, for CORS and the Origin check
  - `PORT=8000`, `WEB_CONCURRENCY=1`, `CALL_CENTER_STORAGE=postgres`
  - the `OTEL_*` variables and `OPERATOR_PROVISION_SECRET`
  - `OPERATOR_RECOVERY_SECRET`, only while a recovery is expected
- `frontend`: `API_UPSTREAM=${{api.RAILWAY_PRIVATE_DOMAIN}}:8000`. nginx re-resolves it every
  10 s, because the private IP changes on every API redeploy.
- Production is the same, using the `-prod` names and `${{postgres-prod.DATABASE_URL}}`.
- `api` runs one replica in `ams`. Set it with `railway scale ams=1 --service api`, since the
  no-argument form errors.

## Operator endpoints

`POST /operator/provision` and `/operator/recover` are unsafe methods. Send
`Origin: <frontend URL>` or the API rejects them. See `_docs/deployment.md` (Bootstrapping and
Recovering admin access). Test logins are in the gitignored `.test_accounts`. Read them from there
and never echo them.

## What the sandbox blocks: hand these to the owner

The sandbox blocks these, even with valid credentials:
- `railway service restart`
- `railway domain`
- `railway config apply --yes`
- `docker push`
- calls to `/operator/provision`

Don't route around the block. Give the owner the exact command so they can run it themselves
(`! <cmd>`) or add a permission rule. Promotion approvals and merges are always the owner's.

## Postgres restart drill (development)

The owner runs `railway service restart --service Postgres --environment development`.

Beforehand, decide whether to silence the dev health alert. A real outage longer than about 5
minutes emails the owner and opens an on-call issue (see `_docs/on-call.md`). Don't run the drill
during a monitor evidence window.

What was observed on 2026-09-24:
- Postgres was down for about 1.2 s and came back on the same volume ("Skipping initialization").
- The first `/health/ready` afterwards returned 503 (`error=http_error` in the log, no DSN leaked),
  and the next one returned 200. The engines had no `pool_pre_ping`, so each stale pooled
  connection failed once. One of those failures was a user-facing 500, 7 minutes later.
  Fixed in #166: every `apps/api/db_*.py` engine now sets `pool_pre_ping=True`.
- The 60 s probe missed the outage, so no alert fired.

To gather evidence, pull the Postgres deploy logs and the `api` http logs for the window via MCP,
then record them in `_docs/deployment.md`.
