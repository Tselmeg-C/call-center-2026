# Grafana Cloud alerting as code (#35)

Config-as-code for the on-call agent's Grafana Cloud alert rules, webhook contact point and
notification-policy route. These files are the source of truth; `../grafana_alerting_apply.py`
applies them to the live stack through the [Grafana Alerting Provisioning HTTP
API](https://grafana.com/docs/grafana/latest/developers/http_api/alerting_provisioning/), the
same kind of stack this repo already talks to for `observability/grafana-dashboard.json` (#34/#44).

**Applied and live** (as of #135/#138/#95's Synthetic Monitoring follow-up): the contact point,
notification-policy route, and `/health/ready` alert rule are all live on the stack, backed by a
real Synthetic Monitoring check (see `synthetic-monitoring-check-health-ready.json` below). The
two OTel-sourced rules stay `isPaused: true`, blocked on #44. See `_docs/on-call.md` for the
runbook and #35's issue thread for status.

## Files

| File | What it is | Status |
| --- | --- | --- |
| `alert-rule-health-ready.json` | Alert rule: `/health/ready` failing on `development`, sourced from a Grafana Synthetic Monitoring HTTP check's `probe_success` metric. Does not depend on OTel export. | **Applied and live.** |
| `synthetic-monitoring-check-health-ready.json` | The Synthetic Monitoring HTTP check itself (`../grafana_sm_apply.py` applies it) -- `probe_success` for this exact target is what the rule above queries. | **Applied and live** (check id `91042`, London probe). |
| `alert-rule-health-ready-production.json` / `synthetic-monitoring-check-health-ready-production.json` | Same pair for `production` (#28), probing `https://frontend-prod-production-d39f.up.railway.app/api/health/ready` through the frontend's `/api` proxy (api-prod has no public domain), so it also catches a broken frontend-to-API upstream. Both apply scripts pick it up automatically. | **Applied and live** (2026-09-23, London probe, `probe_success = 1`). |
| `alert-rule-error-rate.json` | Alert rule: 5xx error rate > 5% on `development`, sourced from OTel metrics (#34/#44). | **`isPaused: true`. Blocked on #44** -- authored only, not verified. |
| `alert-rule-latency-p95.json` | Alert rule: p95 request duration > 1s on `development`, sourced from OTel metrics (#34/#44), matching the 1s p95 target in `_docs/persistence.md`. | **`isPaused: true`. Blocked on #44** -- authored only, not verified. |
| `contact-point-github-issue.json` | Webhook contact point: `POST https://api.github.com/repos/Tselmeg-C/call-center-2026/issues` with a custom JSON payload template (title/body/labels), no hosted middleman. | **Applied and live**, real PAT set (see #138 -- `authorization_credentials` lives in `settings`, not a `secureSettings` sibling). |
| `notification-policy-route.json` | One child route (not the whole policy tree) to merge into the stack's existing root notification policy, matching `team=on-call`/`service=call-center-api` labels to the contact point above, with `group_interval`/`repeat_interval` set. | **Applied and live**; `grafana_alerting_apply.py` does a GET-merge-PUT so it never clobbers unrelated routes. |

## Why Synthetic Monitoring for the readiness rule

The acceptance criteria call for "Grafana Synthetic Monitoring or an equivalent HTTP probe hitting
the live URL directly." Grafana Alerting itself has no built-in "GET this URL and check the status
code" query type; Synthetic Monitoring is the Grafana Cloud product that does that and publishes
`probe_success`/`probe_http_status_code` etc. as ordinary Prometheus series in the stack's metrics
datasource, which `alert-rule-health-ready.json` then queries like any other metric. Its `instance`
label is the check's target URL, which is exactly what `alert-rule-health-ready.json`'s query
filters on.

**Creating the check requires a human step first, but not the check creation itself.** Synthetic
Monitoring uses its own API/token scope, not the `alerting:write`/`dashboards:write`
service-account scope named in #35's constraints -- and until a human finishes the one-time
Synthetics setup in the Grafana UI (**Testing & synthetics -> Synthetics**, then **Synthetics ->
Config** to generate an access token, saved as `grafana_sm_access_token`), there's no "Synthetic
Monitoring" datasource on the stack and the SM API 403s regardless of token. There is no API for
that one-time setup step. Once it's done, `../grafana_sm_apply.py` creates/updates the check itself
from `synthetic-monitoring-check-health-ready.json` -- no further UI clicking needed. It discovers
this tenant's region-specific SM API host (`https://synthetic-monitoring-api-<region>.grafana.net`
-- not a fixed hostname) by reading that datasource's `jsonData.apiHost`, and sends the check's
enum fields (`ipVersion`, `method`) as their string name (`"V4"`, `"GET"`) -- the API's JSON
decoder rejects an int here with `"invalid ip version string"` despite these being protobuf enums.

## Applying

```sh
# Never put values on the command line or in this file. Load from wherever this repo's
# convention keeps them (e.g. .env), by variable name only:
#   grafana_stack_url, grafana_service_account_token, GRAFANA_PROM_DATASOURCE_UID
set -a; . ./.env 2>/dev/null; set +a
GRAFANA_STACK_URL="$grafana_stack_url" GRAFANA_SERVICE_ACCOUNT_TOKEN="$grafana_service_account_token" \
  python3 infra/grafana_alerting_apply.py --dry-run   # prints what it WOULD send, no network call
GRAFANA_STACK_URL="$grafana_stack_url" GRAFANA_SERVICE_ACCOUNT_TOKEN="$grafana_service_account_token" \
  python3 infra/grafana_alerting_apply.py             # applies contact point, notification-policy route,
                                                        # and the health-ready rule only
GRAFANA_STACK_URL="$grafana_stack_url" GRAFANA_SERVICE_ACCOUNT_TOKEN="$grafana_service_account_token" \
  python3 infra/grafana_alerting_apply.py --include-blocked  # also applies the two disabled #44-blocked rules

# Synthetic Monitoring check -- separate token/API, see the section above for why:
GRAFANA_STACK_URL="$grafana_stack_url" GRAFANA_SERVICE_ACCOUNT_TOKEN="$grafana_service_account_token" \
  GRAFANA_SM_ACCESS_TOKEN="$grafana_sm_access_token" python3 infra/grafana_sm_apply.py --dry-run
GRAFANA_STACK_URL="$grafana_stack_url" GRAFANA_SERVICE_ACCOUNT_TOKEN="$grafana_service_account_token" \
  GRAFANA_SM_ACCESS_TOKEN="$grafana_sm_access_token" python3 infra/grafana_sm_apply.py
```

The script never prints token values, only HTTP status codes. It does **not** set the GitHub PAT --
that field is left as the placeholder string in `contact-point-github-issue.json` on purpose; paste
the real fine-grained PAT into the contact point's `authorization_credentials` field directly in the
Grafana UI (or pass it out-of-band via `GITHUB_ONCALL_PAT` to the apply script, which forwards it
without printing it -- see the script's `--help`), never into a file this repo tracks.

**Custom payload support varies by Grafana version.** `contact-point-github-issue.json`'s
`settings.payload` field assumes the live stack's webhook integration supports a full custom JSON
payload template ("Optional Webhook settings -> Payload" in the Grafana Cloud UI, generally
available on current Grafana Cloud stacks). Confirm that field exists in the UI before applying; if
it doesn't, the stack needs updating rather than this repo inventing a hosted middleman to work
around it (out of scope, see #35's constraints).

## Duplicate/flapping behavior

`group_interval: 5m` / `repeat_interval: 4h` on the notification-policy route means: while an alert
stays continuously firing, Grafana re-sends within a firing group at most every 5 minutes for new
alerts joining the group, and re-notifies an unchanged firing group at most every 4 hours -- so a
single continuously-firing alert does not repeatedly re-open GitHub issues. The webhook is a
stateless `POST` with no lookup against existing open issues: if the alert **resolves and re-fires**
(a flap), Grafana's alerting engine treats that as a new firing instance and the contact point
fires again, opening a second `on-call`-labeled issue. This is an accepted, documented limitation
(see `_docs/on-call.md` for how an operator spots and closes/merges the duplicate), not built-in
dedup logic (out of scope per #35).
