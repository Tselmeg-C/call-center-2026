# Release and recovery

The release operator owns the backup and restore commands; the application operator verifies migration, readiness, and synthetic smoke results; the service owner approves traffic switching and rollback. No single step is considered complete without its recorded evidence.

Keep development and production Railway environments, databases, origins, and secrets separate. Both environments are in one Railway project; production uses its own services (`api-prod`, `frontend-prod`, `postgres-prod`). Record the deployed commit and Alembic revision, take a provider-managed backup before migrations, restore into an isolated database, run readiness and synthetic smoke checks, then switch traffic. Never place credentials, dumps, or customer contents in evidence.

MVP recovery targets are RPO 24 hours and RTO 4 hours. Daily encrypted backups should be retained for 30 days; audit history is retained for at least 365 days and is not automatically purged. A release record must include backup age, restore duration, schema revision, readiness evidence, and synthetic smoke results before production promotion.

The release record must contain only safe identifiers, timestamps, elapsed durations, row counts, schema/commit revisions, and pass/fail outcomes. It must not contain credentials, connection strings, cookies, dumps, workbook contents, or customer notes.

For a development rehearsal, restore the provider backup into a new isolated database, set its connection as `DATABASE_URL`, and run `CALL_CENTER_STORAGE=postgres apps/api/start.sh`; the startup migration gate must complete before the readiness check. Record only the backup identifier, backup age, elapsed restore-to-ready time, Alembic revision, row counts, and synthetic smoke pass/fail. Never target a running database during restore, and never record the connection value or dump contents.

## Scope note (#28)

On 2026-09-23 the service owner took scheduled backups (development and production), the timed restore rehearsal, and the restored-application smoke out of #28's scope. The backup, restore, RPO/RTO, and restore-rehearsal steps above are the target procedure and have **not** been exercised yet. Until they are, production has no verified backup and no measured recovery time. Railway's Postgres volume is the only copy of production data.

## Release record: first production release (2026-09-23)

| Item | Evidence |
| --- | --- |
| Commit | `f17ad0bc6fbb1180a2cbf682e25516ca0c7fdf47` (merge of #141) |
| CI | [CI run 35883827934](https://github.com/Tselmeg-C/call-center-2026/actions/runs/35883827934), `push` to `main`, success |
| Images | `ghcr.io/tselmeg-c/call-center-2026-{api,frontend}:f17ad0b...`, the same tags development ran when verified. No rebuild. |
| Dependency lockfiles | `package-lock.json` and `apps/api/requirements.txt` at that commit |
| Schema revision | `030_login_failure_events` (Alembic runs in `apps/api/start.sh` before traffic; a failed migration stops startup) |
| Promotion | [Promote to production run 35910206055](https://github.com/Tselmeg-C/call-center-2026/actions/runs/35910206055), `workflow_dispatch`, tag verified in GHCR for both images, success |
| Go/no-go approval | `Tselmeg-C` approved the `production` environment for that run (comment: "test run gh action") |
| Readiness | `GET https://frontend-prod-production-d39f.up.railway.app/api/health/ready` returns 200: `status=ok`, `storage=postgres`, `version=f17ad0b...`, `migration=030_login_failure_events` |
| Synthetic smoke | `apps/api/postgres_smoke.py` against production: **pass**. It covers Admin/Sales login, import, reimport preservation (owner, status, history, follow-ups survive), manual assignment, interaction, follow-up create/complete, close/reopen, workload, reports, audit, logout, and a 401 after logout. |
| Monitoring | Grafana Synthetic Monitoring `health-ready-production`: `probe_success = 1`. The `oncall-health-ready-production` alert is active. |
| Backups / restore | Out of scope (see Scope note). Not verified. |

This record holds no credentials, connection strings, cookies, or customer data. The smoke data is synthetic and labelled (`smoke-sales-<n>@example.test`, "Smoke Customer", BCN `99xxxx`) and stays in place so the audit trail stays intact.

The promotion re-deployed the image production was already running, so it shows that the workflow and its approval gate work. It can't show that Railway switches images. After the next promotion with a new SHA, confirm `version` in `/api/health/ready` changed.

## Repeat release

1. Merge to `main` and wait for CI to pass. Development auto-deploys the new SHA; confirm it with development's `/health/ready`.
2. Push a `v*` tag, or run *Actions -> Promote to production -> Run workflow* in the web UI with the full SHA development is running (not `latest`).
3. Approve the `production` environment. That approval is the go/no-go record.
4. Confirm production's `/api/health/ready` shows the new `version` and the expected `migration`.
5. Run the synthetic smoke against production (command in `_docs/deployment.md`, *Railway `production` environment*) and record the result here.

## Rollback

Run *Promote to production* with the previous release's full SHA and approve it. This works only while the schema is backward-compatible: the old image must run against the current `migration`. For an incompatible migration, the documented path is an isolated restore-and-switch, which needs the backups that are currently out of scope.
