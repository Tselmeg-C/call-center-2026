"""One-off generator for _docs/grafana-dashboard.json (issue #34).

Not part of the running API -- a local authoring/validation tool only (uses grafanalib,
which is not an apps/api runtime dependency: `pip install grafanalib` to regenerate).
Run as a module (not a bare script) so it doesn't pick up apps/api/operator.py in place of
the stdlib `operator` module:
    python3 -m apps.api._gen_grafana_dashboard > _docs/grafana-dashboard.json

Every metric/label name below matches exactly what apps/api/otel_setup.py emits and what
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

ROUTES = ["/customers", "/sales/workload", "/admin/reports"]
ROUTE_REGEX = "|".join(route.replace("/", r"\/") for route in ROUTES)
ENV_LABEL = "deployment_environment"
ENV_FILTER = f'{ENV_LABEL}="$environment"'


def route_panels(y):
    panels = []
    x = 0
    for title, expr, unit in [
        (
            "Request rate",
            f'sum by (http_route) (rate(http_server_request_duration_seconds_count{{http_route=~"{ROUTE_REGEX}", {ENV_FILTER}}}[5m]))',
            "reqps",
        ),
        (
            "Error rate (5xx)",
            f'sum by (http_route) (rate(http_server_request_duration_seconds_count{{http_route=~"{ROUTE_REGEX}", http_response_status_code=~"5..", {ENV_FILTER}}}[5m]))',
            "reqps",
        ),
        (
            "Duration p95",
            f'histogram_quantile(0.95, sum by (le, http_route) (rate(http_server_request_duration_seconds_bucket{{http_route=~"{ROUTE_REGEX}", {ENV_FILTER}}}[5m])))',
            "s",
        ),
    ]:
        panels.append(
            TimeSeries(
                title=f"{title} -- /customers, /sales/workload, /admin/reports ($environment)",
                dataSource="Grafana Cloud Metrics",
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
        dataSource="Grafana Cloud Logs",
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
        dataSource="Grafana Cloud Logs",
        targets=[Target(expr=logql)],
        gridPos=GridPos(h=8, w=16, x=0, y=y + 8),
    )


dashboard = Dashboard(
    title="Call Center API -- Request Telemetry",
    description=(
        "Request rate/error rate/duration for /customers, /sales/workload, /admin/reports, "
        "plus correlated log volume, split by deployment.environment. Sourced from "
        "apps/api's OpenTelemetry instrumentation (issue #34) via Grafana Cloud OTLP ingest "
        "(traces->Tempo, metrics->Mimir/Prometheus, logs->Loki)."
    ),
    tags=["call-center", "api", "otel"],
    timezone="utc",
    panels=[
        RowPanel(title="HTTP -- /customers, /sales/workload, /admin/reports", gridPos=GridPos(h=1, w=24, x=0, y=0)),
        *route_panels(1),
        RowPanel(title="Logs", gridPos=GridPos(h=1, w=24, x=0, y=9)),
        log_volume_panel(10),
        raw_logs_panel(10),
    ],
    templating=Templating(
        list=[
            Template(
                name="environment",
                query="label_values(http_server_request_duration_seconds_count, deployment_environment)",
                dataSource="Grafana Cloud Metrics",
                default="prod",
                label="Environment",
            )
        ]
    ),
).auto_panel_ids()

print(json.dumps(dashboard.to_json_data(), indent=2, sort_keys=True, cls=DashboardEncoder))
