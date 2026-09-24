# On-call agent (#35)

When Grafana Cloud alerting fires on a tracked `development` signal, it opens a GitHub issue whose
sole purpose is to summon the on-call agent (`.github/workflows/claude.yml`). That agent
investigates using Tempo/Loki/metrics, implements and tests a fix in `development`, and lets it
flow through the normal CI pipeline; **a human then makes the deliberate call to promote the
resulting image to production.** The agent never touches production directly.

Grafana Cloud Synthetic Monitoring is the only health monitor. The old GitHub Actions cron
`dev-health-monitor.yml` (#27) was deleted in #95. Critical `/health/ready` alerts also email the
owner (see *Alert rules and webhook wiring* below and `_docs/deployment.md` → *Development health monitor*).

## Trigger mechanism

The actual trigger is the `secrets.CLAUDE_CODE_OAUTH_TOKEN` GitHub Actions secret being set --
**not** just the Claude GitHub App being installed on the repo (two different facts; only the app
install is confirmed as of this writing). `.github/workflows/claude.yml` runs on `issues: opened`
whenever the issue title or body contains the literal substring `@claude`:

```yaml
if: github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude'))
```

No `assigned` step, no label-based trigger -- issue creation alone fires it. Confirmed live: a
manually created test issue containing `@claude`
([#134](https://github.com/Tselmeg-C/call-center-2026/issues/134)) caused the workflow to run and
the agent to comment, in [this run](https://github.com/Tselmeg-C/call-center-2026/actions/runs/35831411962)
(6s, `conclusion: success`). That issue has been closed; it was a scratch smoke test, not part of
the alerting path itself.

## Alert rules and webhook wiring

Config-as-code lives under [`infra/grafana-alerting/`](../infra/grafana-alerting/README.md),
applied via `infra/grafana_alerting_apply.py` against the Grafana Alerting Provisioning HTTP API.
Five rules, two contact points (the GitHub-issue webhook and the owner's email) and three
notification-policy routes:

| Rule | Source | Status |
| --- | --- | --- |
| `/health/ready` failing (development) | Synthetic Monitoring `probe_success` against the live readiness URL directly -- no OTel dependency | **Applied and live** (SM check `91042`; fired for real in #136) |
| `/health/ready` failing (production, #28) | Same Synthetic Monitoring check, against `frontend-prod-production-d39f.up.railway.app/api/health/ready` | **Applied and live** (2026-09-23, `probe_success = 1`). It fires through the same contact point, so the issue says `production`. The agent still investigates and fixes in `development` only, and a human promotes the fix |
| Elevated 5xx error rate (development) | OTel metrics, joined to `target_info` on `deployment_environment` like the dashboard | **Applied and live**, `isPaused: false` (#35). 5xx share > 5% over 5m, for 10m. Idle `development` gives no data, which maps to OK |
| p95 latency SLO breach (development) | OTel metrics, same join | **Applied and live**, `isPaused: false` (#35). p95 > 1s over 5m, for 10m (target from `_docs/persistence.md`). Idle gives NaN/no data, which never crosses the threshold |
| Health monitor stopped reporting (development, #99) | Absence of Synthetic Monitoring `probe_success{job="health-ready-development"}` for 30 minutes (dead man's switch) | **Applied and live** (2026-09-24, `Normal`). **Emails the owner only and does not open an on-call issue**: a stopped check can't be fixed from the repo. See `_docs/deployment.md` → *Development health monitor* |

The webhook contact point `POST`s directly to `https://api.github.com/repos/Tselmeg-C/call-center-2026/issues`
with a custom JSON payload (`title`, `body`, `labels`) -- no new hosted middleman service. The
payload template puts `@claude` at the start of the body (matching the trigger condition above
character-for-character) and sets `labels: ["on-call"]`; GitHub's issue-creation endpoint creates
the `on-call` label automatically if it doesn't already exist yet, so no manual label setup is
needed. The body is built **only** from alert metadata the rule itself carries (alert name,
service, environment, firing time, links to the Grafana/Tempo/Loki dashboard) -- it never
interpolates raw log-line content, query results, credentials, or customer/note data, because the
Go template only ever references `.CommonLabels`, `.CommonAnnotations`, `.StartsAt` and
`.ExternalURL`, none of which can carry those.

### Email route (#95)

A second route, `infra/grafana-alerting/notification-policy-route-email.json`, sits before the
GitHub route. It matches `team=on-call, service=call-center-api, severity=critical` and sends to the
owner-created email contact point `TselmegC` (the address is kept only in Grafana), with
`continue: true` so the GitHub route still matches after it. Both `/health/ready` rules (development
and production) are `critical` and reach both receivers. The `warning` error-rate and latency rules
reach only the GitHub route. Email repeats at most every 4 h while firing, and a "resolved" email is
sent on recovery (`disableResolveMessage: false` on the contact point).

A third route, `notification-policy-route-monitor-stale.json` (#99), is listed first. It matches
`kind=monitor-stale`, a label only the stale-monitor rule carries, sends to `TselmegC` with
`continue: false`, so that alert emails once and never opens an on-call issue. The development
`/health/ready` rule has `noDataState: OK` since #99, so a stopped check doesn't also open an "API
failing" issue; the production rule still fires on no data (#169).

### Duplicate / flapping alerts

The notification-policy route sets `group_interval: 5m` and `repeat_interval: 4h`. While an alert
stays continuously firing, Grafana does not re-notify the same firing group more than once every 4
hours, so the contact point does not open a second issue for it. The webhook is a stateless `POST`
with no lookup against existing open GitHub issues, so **if an alert resolves and then re-fires
(a flap), a new issue opens** -- this is an accepted, documented limitation (building GitHub-side
dedup is explicitly out of scope for #35).

**What an operator does about a duplicate:** search issues for `label:on-call is:open`, sorted by
creation time; if two or more reference the same alert name/environment within a short window,
keep the oldest (or whichever already has agent activity/a linked PR) and close the rest with a
comment linking to the one that's being tracked, plus a short note ("duplicate of #<n>, alert
flapped"). Do not close the issue the agent is actively working -- check for a linked PR or recent
comments first.

### GitHub PAT scope

The webhook contact point's GitHub credential is a **fine-grained personal access token**: repository
access restricted to `Tselmeg-C/call-center-2026` only, permission **"Issues: Read and write" only**
-- no Contents, Actions, Pull requests, or any other permission. (A classic PAT cannot be scoped to
a single repository, which is why this must be a fine-grained one.) It is pasted **only** into the
Grafana Cloud contact point's secure `authorization_credentials` field (`secureSettings` in
`infra/grafana-alerting/contact-point-github-issue.json` -- never the value itself, just the field
name) -- never committed to this repo, never logged, never pasted into an issue/PR/screenshot. On
rotation, generate a new fine-grained PAT with the exact same scope and replace it the same way.

### Silencing during a known outage or alert flap

In Grafana Cloud: **Alerting -> Alert rules**, open the rule, and pause it (this repo's config-as-code
sets `isPaused` per rule, so re-applying with `isPaused: true` also works); or **Alerting -> Notification
policies**, add/enable a silence matching `team=on-call` for the outage window. Either stops new
`on-call` issues from opening without touching the alert rule's underlying query/threshold.

## Trigger prerequisite -- what the owner confirmed

- **Claude GitHub App installed on this repo** -- owner-reported as done (2026-09-23).
- **`CLAUDE_CODE_OAUTH_TOKEN` GitHub Actions secret set** -- confirmed live by
  [#134](https://github.com/Tselmeg-C/call-center-2026/issues/134)'s run succeeding (see above);
  this sandbox's own `gh` auth cannot list repository secrets directly (`gh secret list` 403s),
  so the live run is the only independent evidence.
- **Grafana Cloud service-account token** scoped to `alerting:write`/`dashboards:write` -- the
  owner reports this exists, but it was **not present in this implementing session's environment**
  (no `.env`, no matching env vars), so none of the `infra/grafana-alerting/*.json` config has
  actually been applied to the live stack yet. See "What's left for the owner" below.

## What the agent does once triggered

1. Reads the `on-call`-labeled issue (alert name, service, environment, firing time, dashboard
   links only -- see above).
2. Investigates using only already-permitted, safe diagnostic signals: Tempo traces, Loki logs (by
   request ID), current `/health/ready` status, the last deployed commit SHA and migration
   revision, and Grafana Cloud metrics. It never reads or surfaces credentials, connection
   strings, cookies, or customer/note content -- the same allowlist `observability/otel_setup.py`
   already enforces on export means none of that data exists in Tempo/Loki/metrics for it to read
   in the first place.
3. Implements a fix following `_docs/team/software-engineer.md`: reads the code and git history,
   commits a fix with a regression test, and pushes it to a new branch
   `claude/issue-<n>-<timestamp>`. It then comments on the issue with the root cause and a
   **"Create PR" link** for that branch. Observed live in the #148 drill (#152): the agent
   **does not open the PR itself and cannot run `pytest`** in its sandbox (test commands need an
   approval an unattended run doesn't have). A human or the orchestrator checks out the branch,
   runs the tests locally, and opens the PR from it (#153). The branch push alone does not
   trigger CI; `check` runs once that PR is opened.
4. That push runs through `.github/workflows/ci.yml`'s `check` job unmodified (lint, typecheck,
   unit tests, the PostgreSQL integration suite, real-HTTP journeys, observability checks). A
   failing gate blocks the image from ever being published.
5. **Merging to `main` is a separate, human-reviewed step** -- `ci.yml`'s `publish` job (which
   builds and pushes the image) only runs `on: push` to `main` or a `v*` tag, never on a pull
   request. So even once the agent's fix passes CI on its own branch/PR, a human (or whatever
   review path is actually observed live) merges it before an image exists to promote. This is a
   structural fact of this repo's pipeline (#33), not a design choice made here.
6. Once `publish` builds and pushes the new image (tagged by commit SHA), the agent's final action
   is a comment on the original alert issue stating the fix is ready at that commit SHA/image tag,
   and that production promotion is a manual decision (pushing a `v*` tag, or a human running
   *Actions -> Promote to production*). **The agent never creates a `v*` tag and never dispatches
   `promote-production.yml` itself** -- it has no credentials or access path to production at any
   point; its write access is limited to the repository (dev-facing).
7. If the agent cannot determine a fix (insufficient signal, or a genuine infrastructure outage
   rather than a code bug), it says so plainly on the issue with what it checked, rather than
   guessing or making an unrelated change.

## What a human operator does with the agent's output

1. Review the agent's comment/PR on the `on-call` issue.
2. If it's a PR: review and merge it (or push follow-ups) the same as any other PR in this repo.
3. Confirm CI (`check`) passed and `publish` built the image (Actions tab, or `/health/ready` on
   `development` showing the new commit SHA after Railway's auto-deploy).
4. Decide whether to promote to production: push a `v*` tag, or run *Actions -> Promote to
   production* (`workflow_dispatch`) with that commit SHA -- both go through the `production`
   environment's approval gate (see `_docs/deployment.md`).
5. If the agent said it could not determine a fix, treat it like any other page: investigate
   manually using the same Tempo/Loki/metrics signals.

## End-to-end drill

**Confirmed live:** the trigger mechanism itself -- a manually created issue containing `@claude`
causes `claude.yml` to fire and the agent to comment
([#134](https://github.com/Tselmeg-C/call-center-2026/issues/134), run
[35831411962](https://github.com/Tselmeg-C/call-center-2026/actions/runs/35831411962), evidence
contains no credentials). This is the manual stand-in the acceptance criteria explicitly allow
when the real probe/webhook isn't wired yet.

**Not run this pass, and why:** a full "alert fires -> issue opens via the real webhook -> agent
fixes a genuine synthetic bug -> CI gates pass -> image published -> human promotes" drill needs,
in order:

1. The Grafana webhook actually wired live -- **done** (#138; the live alert opened #136).
2. A real, deliberately-introduced synthetic bug landed on `main` for the agent to find --
   introducing that itself requires a merge, which the implementing engineer role for #35 does
   not do (same "never merge" rule any engineer session follows).
3. `publish` (the image build/push step) only running on a push to `main`, i.e. requiring a human
   merge of whatever fix the agent proposes (see step 5 in "What the agent does" above) before
   there's an image to promote at all.

So a fully unattended version of this drill isn't something one engineering session can execute
solo end-to-end -- it inherently needs a human merge in the middle, which is consistent with "a
human then makes the deliberate call to promote," just one step earlier than production promotion.
**Recommended follow-up**, once the webhook is wired: open a small synthetic bug fix PR by hand
(not merged), then separately create/merge a tiny deliberately-broken commit to `main`, let the
Grafana `/health/ready` alert (or a manual `on-call`-labeled stand-in issue) summon the agent, and
walk through steps 1-6 above with a human doing the merge and the promotion. Record the run URL,
the PR/commit, and the promotion decision as evidence, the same way this document records #134.

### Error-rate drill (#148), 2026-09-23

A real synthetic bug went through the normal pipeline, a real Grafana rule fired on it, and the
on-call agent diagnosed and fixed it. Timestamps are from GitHub (PR, issue and run metadata)
unless noted.

| Time (UTC) | Event |
| --- | --- |
| 21:08:28 | Synthetic bug [#151](https://github.com/Tselmeg-C/call-center-2026/pull/151) merged (`GET /version` returns a handled 500) as `d2a810c`. [CI run](https://github.com/Tselmeg-C/call-center-2026/actions/runs/35920558099) deployed it to `development` |
| 21:12:29 | Orchestrator starts the traffic loop: `GET /version` on dev every 5 s, ran about 45 min (orchestrator's record) |
| 21:14:50 | `oncall-error-rate-development` Normal -> Pending, 5xx share 0.36 (Grafana state history, `/api/v1/rules/history`) |
| 21:24:50 | Pending -> Alerting (`Firing`), 5xx share 0.92 (Grafana state history; matches the alert issue body) |
| 21:25:21 | Webhook opens alert issue [#152](https://github.com/Tselmeg-C/call-center-2026/issues/152) (error-rate, `warning`), 12m52s after traffic started. No email expected (warning goes to GitHub only) |
| 21:25:24 | On-call agent [run 35922335624](https://github.com/Tselmeg-C/call-center-2026/actions/runs/35922335624) starts; finishes in 1m42s, pushes branch `claude/issue-152-20260923-2125` with a "Create PR" link |
| 21:30:28 | Orchestrator runs `pytest apps/api observability infra` locally (299 passed, 148 Postgres-only skipped) and opens fix PR [#153](https://github.com/Tselmeg-C/call-center-2026/pull/153) from the agent's branch. [CI `check`](https://github.com/Tselmeg-C/call-center-2026/actions/runs/35922868969) passed |
| 21:35:24 | #153 merged as `ebf8486` ([CI run](https://github.com/Tselmeg-C/call-center-2026/actions/runs/35923385721) deployed it to `development`) |
| 21:35:25 | #152 auto-closed by the #153 merge (`Closes #152`), before the rule cleared |
| 21:38:55 | Railway shows dev `api` running image `ebf8486` |
| 21:41:50 | Alerting -> Normal, about 3 min after the fix deployed (Grafana state history) |
| 2026-09-24 06:50 | Verified: dev `GET /version` returns 200, and all 4 Grafana alert rules are inactive (`Normal`) |

- **Root cause found by the agent:** `GET /version` in `apps/api/main.py`, the synthetic-bug marker
  comment from #151. Regression test: `test_version_endpoint_returns_ok` in
  `apps/api/test/test_auth.py`.
- **Live telemetry: not used.** The owner chose to run without a read-only Grafana token (#148
  comment), so the agent diagnosed from code and git history only.
- **Agent output:** a pushed branch plus a "Create PR" link, not a PR (see step 3 above). The push
  did not trigger CI; opening #153 did.
- **Production:** never had the bug (#151 was never promoted). The owner then released the fix as
  tag `v1.0.1` on `f16e7d9` ([run 35971145054](https://github.com/Tselmeg-C/call-center-2026/actions/runs/35971145054),
  `production` gate approved by the owner). `f16e7d9` is a descendant of `ebf8486` with identical
  `apps/` code, so promoting `ebf8486` itself would have rolled prod back. Prod `/api/version` and
  `/api/health/ready` return 200 with `x-app-version` `f16e7d9`. The agent did not promote: the
  only `promote-production.yml` run predates the drill, and both tags were pushed by the owner.
- **Not drilled:** the `/health/ready` and p95 rules. `/health/ready` can't be broken past Railway's
  deploy healthcheck without a contrived bug; its alert path was already proven by #136 and #149.
  The p95 path was shown firing only in rule Preview (#35/#146).

**The error-rate and latency-breach rules** are enabled (#35). Their PromQL was checked live
against `development` telemetry, and each was shown to reach `Firing` with a lowered threshold in
rule **Preview** only, never saved, so no real issue was opened. A real end-to-end drill of these
two paths is part of the same follow-up as above.

## What's left for the owner

1. ~~**Create the fine-grained GitHub PAT**~~ -- **done** (#138). GitHub -> Settings -> Developer settings -> Fine-grained
   tokens -> generate one scoped to only `Tselmeg-C/call-center-2026`, permission "Issues: Read and
   write" only. There is no API for this step.
2. ~~**Supply Grafana Cloud credentials**~~ -- **done**, in the gitignored `.env` by variable name. Originally: (`grafana_stack_url`, a service-account token scoped to
   `alerting:write`/`dashboards:write`, and the stack's Prometheus datasource UID) to a session
   that can run `infra/grafana_alerting_apply.py` -- or apply `infra/grafana-alerting/*.json`
   manually through the Grafana UI using those files as the exact reference.
3. ~~**Paste the PAT from step 1 into the Grafana contact point's secure `authorization_credentials`
   field**~~ -- **done** (#138). Never into a file, commit, issue, or chat message.
4. ~~Create the Synthetic Monitoring HTTP check for `/health/ready` on `development`~~ -- **done.**
   Check id `91042` (London probe), applied via `infra/grafana_sm_apply.py`. The one remaining
   manual part was the one-time Synthetics setup in the Grafana UI (**Testing & synthetics ->
   Synthetics**, then **Synthetics -> Config** for an access token) -- there's no API for that
   step, but check creation/updates themselves are now code (see
   `infra/grafana-alerting/README.md`).
5. ~~Run the follow-up end-to-end drill~~ -- **done for the error-rate path** (#148, see
   *Error-rate drill* above). The `/health/ready` and p95 paths were not drilled, for the reasons
   given there. The fix is in production as `v1.0.1`
   (`f16e7d9`, same `apps/` code as `ebf8486`).

**Confirmed live, 2026-09-23:** the full loop fired for real -- `/health/ready` alerted on a
genuine `NoData` gap (this SM check didn't exist yet), the webhook opened
[#136](https://github.com/Tselmeg-C/call-center-2026/issues/136), and the on-call agent
investigated and correctly reported no code regression (the gap was infra setup, not a bug).
Closed once the check above made the underlying condition resolve for real.
