"""One-off generator for observability/grafana-dashboard.json (issue #34).

Not part of the running API -- a local authoring/validation tool only (uses grafanalib,
which is not an apps/api runtime dependency: `pip install grafanalib` to regenerate).
Run as a module (not a bare script) so it doesn't pick up apps/api/operator.py in place of
the stdlib `operator` module (that collision hits any bare-script invocation whose own
directory shadows a stdlib module -- running via `-m` from the repo root avoids it):
    python3 -m observability._gen_grafana_dashboard > observability/grafana-dashboard.json

Every metric/label name below matches exactly what observability/otel_setup.py emits and what
Grafana Cloud's OTLP ingest promotes to Prometheus/Loki naming:
  - http.server.request.duration (histogram, seconds) -> http_server_request_duration_seconds
  - allowlisted attributes http.route / http.request.method / http.response.status_code
    -> labels http_route / http_request_method / http_response_status_code
  - the deployment.environment resource attribute -> label deployment_environment
  - the origin_guard request log line ("request id=... method=... route=... status=...
    duration_ms=... error=...") is logfmt-shaped, so Loki panels parse it with `| logfmt`.
"""
import json

from grafanalib._gen import DashboardEncoder
from grafanalib.core import (
    Dashboard,
    GridPos,
    Logs,
    RowPanel,
    Target,
    Templating,
    TimeSeries,
    Template,
)

ROUTES = ["/customers", "/workload", "/sales/workload", "/admin/reports"]
ROUTE_LIST = ", ".join(ROUTES)
# Plain "/" -- no "\/" escaping: "/" isn't a regex metacharacter, and "\/" is an invalid escape
# inside PromQL/LogQL double-quoted strings.
ROUTE_REGEX = "|".join(ROUTES)
JOB = "call-center-api"
ENV_LABEL = "deployment_environment"
ENV_FILTER = f'{ENV_LABEL}="$environment"'
# Datasource template variables, so the dashboard binds to whatever the stack's Prometheus/Loki
# datasources are called (grafanacloud-<stack>-prom / -logs) without hand-editing panels.
METRICS_DS = {"type": "prometheus", "uid": "${metrics}"}
LOGS_DS = {"type": "loki", "uid": "${logs}"}
# deployment.environment is a *resource* attribute: Grafana Cloud's OTLP ingest puts it only on
# target_info, not on every series. So metric panels join it in. `max by` collapses several
# target_info series per (job, instance) (replicas, redeploys) so the join never goes many-to-many.
ENV_JOIN = (
    f"* on (job, instance) group_left({ENV_LABEL}) "
    f'max by (job, instance, {ENV_LABEL}) (target_info{{job="{JOB}", {ENV_FILTER}}})'
)


def route_panels(y):
    panels = []
    x = 0
    for title, expr, unit in [
        (
            "Request rate",
            f'sum by (http_route) (rate(http_server_request_duration_seconds_count{{job="{JOB}", http_route=~"{ROUTE_REGEX}"}}[5m]) {ENV_JOIN})',
            "reqps",
        ),
        (
            "Error rate (5xx)",
            f'sum by (http_route) (rate(http_server_request_duration_seconds_count{{job="{JOB}", http_route=~"{ROUTE_REGEX}", http_response_status_code=~"5.."}}[5m]) {ENV_JOIN})',
            "reqps",
        ),
        (
            "Duration p95",
            f'histogram_quantile(0.95, sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket{{job="{JOB}", http_route=~"{ROUTE_REGEX}"}}[5m]) {ENV_JOIN}))',
            "s",
        ),
    ]:
        panels.append(
            TimeSeries(
                title=f"{title} -- {ROUTE_LIST} ($environment)",
                dataSource=METRICS_DS,
                targets=[Target(expr=expr, legendFormat="{{http_route}}")],
                unit=unit,
                gridPos=GridPos(h=8, w=8, x=x, y=y),
            )
        )
        x += 8
    return panels


def log_volume_panel(y):
    logql = (
        'sum by (route) (count_over_time({service_name="call-center-api", '
        f'{ENV_LABEL}="$environment"}} | logfmt | route=~"{ROUTE_REGEX}" [5m]))'
    )
    return TimeSeries(
        title="Log volume by route ($environment)",
        dataSource=LOGS_DS,
        targets=[Target(expr=logql, legendFormat="{{route}}")],
        unit="short",
        gridPos=GridPos(h=8, w=16, x=0, y=y),
    )


def raw_logs_panel(y):
    logql = (
        '{service_name="call-center-api", '
        f'{ENV_LABEL}="$environment"}} | logfmt | route=~"{ROUTE_REGEX}"'
    )
    return Logs(
        title="Recent request log lines ($environment)",
        dataSource=LOGS_DS,
        targets=[Target(expr=logql)],
        gridPos=GridPos(h=8, w=16, x=0, y=y + 8),
    )


dashboard = Dashboard(
    title="Call Center API -- Request Telemetry",
    uid="call-center-api",
    description=(
        f"Request rate/error rate/duration for {ROUTE_LIST}, "
        "plus correlated log volume, split by deployment.environment (metrics via a join on "
        "target_info). Sourced from "
        "apps/api's OpenTelemetry instrumentation (issue #34) via Grafana Cloud OTLP ingest "
        "(traces->Tempo, metrics->Mimir/Prometheus, logs->Loki)."
    ),
    tags=["call-center", "api", "otel"],
    timezone="utc",
    panels=[
        RowPanel(title=f"HTTP -- {ROUTE_LIST}", gridPos=GridPos(h=1, w=24, x=0, y=0)),
        *route_panels(1),
        RowPanel(title="Logs", gridPos=GridPos(h=1, w=24, x=0, y=9)),
        log_volume_panel(10),
        raw_logs_panel(10),
    ],
    templating=Templating(
        list=[
            Template(name="metrics", type="datasource", query="prometheus", label="Metrics datasource"),
            Template(name="logs", type="datasource", query="loki", label="Logs datasource"),
            Template(
                name="environment",
                query=f'label_values(target_info{{job="{JOB}"}}, {ENV_LABEL})',
                dataSource=METRICS_DS,
                default="dev",
                label="Environment",
            ),
        ]
    ),
).auto_panel_ids()

print(json.dumps(dashboard.to_json_data(), indent=2, sort_keys=True, cls=DashboardEncoder))
