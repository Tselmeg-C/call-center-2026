"""Tests for issue #34's OpenTelemetry wiring.

Every test here uses in-memory/console OTel SDK exporters -- never a live Grafana Cloud
endpoint (none is available to this task; see issue #34's Constraints/Out of scope). No
test ever sets OTEL_EXPORTER_OTLP_ENDPOINT to a real network address.

OTel instrumentation (FastAPI + SQLAlchemy) is process-wide, singleton-guarded machinery,
same as it would be in a real deployment -- it is configured once for this module (not
uninstrumented/reinstrumented per test, which is fragile and unrepresentative of real
usage) and each test just clears its own view of the in-memory exporters first.
"""
import json
import logging
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.sdk._logs.export import InMemoryLogRecordExporter
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from sqlalchemy import create_engine

from . import otel_setup
from apps.api.db_auth import AuthDatabase
from apps.api.main import app

client = TestClient(app, base_url="http://localhost")
DASHBOARD_PATH = Path(__file__).resolve().parent / "grafana-dashboard.json"


def test_grafana_dashboard_is_a_valid_structural_model():
    dashboard = json.loads(DASHBOARD_PATH.read_text())
    assert dashboard["title"]
    non_row_panels = [p for p in dashboard["panels"] if p["type"] != "row"]
    assert len(non_row_panels) >= 4  # rate, errors, duration, log volume (at minimum)
    for panel in non_row_panels:
        assert panel["title"]
        assert panel["targets"], panel["title"]
        for target in panel["targets"]:
            assert target["expr"]

    # The dashboard is a static model, but it must query the exact metric/label names this
    # issue's instrumentation actually emits (Prometheus/Loki naming, once Grafana Cloud's
    # OTLP ingest converts http.server.request.duration -> http_server_request_duration_seconds
    # and dotted attribute keys -> underscored labels).
    text = json.dumps(dashboard)
    # otel_setup.METRIC_VIEWS targets the "http.server.request.duration" instrument (seconds
    # histogram) that FastAPIInstrumentor emits under OTEL_SEMCONV_STABILITY_OPT_IN=http.
    assert "http_server_request_duration_seconds" in text
    for attribute in ("http.route", "http.response.status_code"):
        assert attribute.replace(".", "_") in text
    assert "deployment_environment" in text
    for route in ("/customers", "/sales/workload", "/admin/reports"):
        assert route in text


DASHBOARD_ROUTES = ("/customers", "/workload", "/sales/workload", "/admin/reports")
ENV_JOIN = (
    '* on (job, instance) group_left(deployment_environment) '
    'max by (job, instance, deployment_environment) '
    '(target_info{job="call-center-api", deployment_environment="$environment"})'
)


def _dashboard_panels():
    return [p for p in json.loads(DASHBOARD_PATH.read_text())["panels"] if p["type"] != "row"]


def test_dashboard_route_regex_matches_all_request_routes_exactly():
    panels = _dashboard_panels()
    assert panels
    for panel in panels:
        for target in panel["targets"]:
            found = re.findall(r'(?:http_route|route)=~"([^"]*)"', target["expr"])
            assert found, (panel["title"], target["expr"])
            for pattern in found:
                pattern = pattern.replace("\\/", "/")
                for route in DASHBOARD_ROUTES:
                    assert re.fullmatch(pattern, route), (panel["title"], route)
                for route in ("/workloads", "/sales"):
                    assert not re.fullmatch(pattern, route), (panel["title"], route)
        if panel["type"] == "timeseries" and panel["datasource"]["type"] == "prometheus":
            assert "/workload" in panel["title"]
    dashboard = json.loads(DASHBOARD_PATH.read_text())
    assert "/workload," in dashboard["description"]
    assert all("/workload," in p["title"] for p in dashboard["panels"] if p["type"] == "row" and p["title"].startswith("HTTP"))


def test_dashboard_metric_panels_join_environment_from_target_info():
    dashboard = json.loads(DASHBOARD_PATH.read_text())
    metric_panels = [p for p in _dashboard_panels() if p["datasource"]["type"] == "prometheus"]
    assert len(metric_panels) == 3
    for panel in metric_panels:
        for target in panel["targets"]:
            assert ENV_JOIN in target["expr"], panel["title"]
            # Only target_info carries deployment_environment; the request metric must not filter on it.
            assert target["expr"].count("deployment_environment=") == 1, panel["title"]
    environment = next(t for t in dashboard["templating"]["list"] if t["name"] == "environment")
    assert environment["query"] == 'label_values(target_info{job="call-center-api"}, deployment_environment)'


def test_dashboard_uses_datasource_variables_not_hardcoded_names():
    dashboard = json.loads(DASHBOARD_PATH.read_text())
    text = json.dumps(dashboard)
    assert "Grafana Cloud Metrics" not in text and "Grafana Cloud Logs" not in text
    variables = {t["name"]: t for t in dashboard["templating"]["list"]}
    assert (variables["metrics"]["type"], variables["metrics"]["query"]) == ("datasource", "prometheus")
    assert (variables["logs"]["type"], variables["logs"]["query"]) == ("datasource", "loki")
    for panel in _dashboard_panels():
        assert panel["datasource"] in ({"type": "prometheus", "uid": "${metrics}"}, {"type": "loki", "uid": "${logs}"})
    assert variables["environment"]["datasource"] == {"type": "prometheus", "uid": "${metrics}"}


def test_default_exporters_use_otlp_http_paths(monkeypatch):
    """Grafana Cloud's /otlp gateway is OTLP/HTTP: the default exporters must append the per-signal
    paths. export() is stubbed on every exporter class so nothing reaches the network."""
    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

    for exporter_class in (OTLPSpanExporter, OTLPLogExporter, OTLPMetricExporter):
        monkeypatch.setattr(exporter_class, "export", lambda self, *a, **k: pytest.fail("network export attempted"))
    for name in ("TRACES", "METRICS", "LOGS"):
        monkeypatch.delenv(f"OTEL_EXPORTER_OTLP_{name}_ENDPOINT", raising=False)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://example.invalid/otlp")
    scratch_app = FastAPI()
    state = otel_setup.configure_otel(scratch_app)
    try:
        span_exporter = state["tracer_provider"]._active_span_processor._span_processors[0]._batch_processor._exporter._wrapped
        log_exporter = state["logger_provider"]._multi_log_record_processor._log_record_processors[0]._batch_processor._exporter._wrapped
        metric_exporter = state["meter_provider"]._metric_readers[0]._exporter
        assert isinstance(span_exporter, OTLPSpanExporter)
        assert isinstance(log_exporter, OTLPLogExporter)
        assert isinstance(metric_exporter, OTLPMetricExporter)
        assert span_exporter._endpoint == "https://example.invalid/otlp/v1/traces"
        assert metric_exporter._endpoint == "https://example.invalid/otlp/v1/metrics"
        assert log_exporter._endpoint == "https://example.invalid/otlp/v1/logs"
    finally:
        for exporter_class in (OTLPSpanExporter, OTLPLogExporter, OTLPMetricExporter):
            monkeypatch.setattr(exporter_class, "export", lambda self, *a, **k: None)
        otel_setup.shutdown_otel(scratch_app)


def test_disabled_when_otlp_endpoint_unset(monkeypatch, caplog):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    scratch_app = FastAPI()
    with caplog.at_level(logging.WARNING):
        result = otel_setup.configure_otel(scratch_app)
    assert result is None
    assert getattr(scratch_app, "_is_instrumented_by_opentelemetry", False) is False
    # No OTel warning/error noise (retry/connection-error chatter) from constructing nothing.
    assert not [r for r in caplog.records if "opentelemetry" in r.name]
    # The app still serves traffic normally with OTel untouched.
    assert TestClient(scratch_app).get("/").status_code == 404


def test_deployment_environment_resource_attribute(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    monkeypatch.setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=prod")
    scratch_app = FastAPI()
    state = otel_setup.configure_otel(scratch_app, span_exporter=InMemorySpanExporter())
    try:
        assert state["tracer_provider"].resource.attributes["deployment.environment"] == "prod"
    finally:
        otel_setup.shutdown_otel(scratch_app)


def test_instrumenting_multiple_engines_does_not_duplicate_connect_spans(monkeypatch):
    """Regression test for the leak QA reproduced: main.py's own pattern is one
    instrument_engine() call per adapter engine, in a loop over 4 engines. Instrumenting
    N engines that way must still produce exactly one "connect" span per actual
    engine.connect() call -- not N, which is what SQLAlchemyInstrumentor()._instrument
    (engine=...) used to leak (it re-wrapped Engine.connect, a class-level/shared
    monkeypatch, once per call, and wrapt does not dedupe repeated wraps)."""
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    scratch_app = FastAPI()
    span_exporter = InMemorySpanExporter()
    state = otel_setup.configure_otel(scratch_app, span_exporter=span_exporter)
    assert state is not None
    engines = [create_engine("sqlite+pysqlite:///:memory:") for _ in range(3)]
    try:
        for engine in engines:
            otel_setup.instrument_engine(engine)

        for index, engine in enumerate(engines):
            span_exporter.clear()
            with engine.connect():
                pass
            state["tracer_provider"].force_flush()
            connect_spans = [s for s in span_exporter.get_finished_spans() if s.name == "connect"]
            assert len(connect_spans) == 1, (index, connect_spans)
    finally:
        for engine in engines:
            engine.dispose()
        otel_setup.shutdown_otel(scratch_app)


@pytest.fixture(scope="module")
def otel_exporters(monkeypatch_module_env):
    """Configures OTel on the real app once for every test below, against in-memory exporters."""
    span_exporter = InMemorySpanExporter()
    log_exporter = InMemoryLogRecordExporter()
    metric_reader = InMemoryMetricReader()
    state = otel_setup.configure_otel(app, span_exporter=span_exporter, log_exporter=log_exporter, metric_reader=metric_reader)
    assert state is not None
    database = AuthDatabase("sqlite+pysqlite:///:memory:")
    otel_setup.instrument_engine(database.engine)
    yield span_exporter, log_exporter, metric_reader, database
    state["tracer_provider"].force_flush()
    state["logger_provider"].force_flush()
    otel_setup.shutdown_otel(app)


@pytest.fixture(scope="module")
def monkeypatch_module_env():
    import os
    had = "OTEL_EXPORTER_OTLP_ENDPOINT" in os.environ
    saved = os.environ.pop("OTEL_EXPORTER_OTLP_ENDPOINT", None)
    yield
    if had:
        os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = saved


@pytest.fixture
def otel(otel_exporters):
    """Per-test view: fresh spans/logs, the module-wide instrumentation stays up."""
    span_exporter, log_exporter, metric_reader, database = otel_exporters
    span_exporter.clear()
    log_exporter.clear()
    yield span_exporter, log_exporter, metric_reader, database


def _flush():
    otel_setup._state["tracer_provider"].force_flush()
    otel_setup._state["logger_provider"].force_flush()


def test_request_produces_span_with_db_child_span(otel):
    span_exporter, _log_exporter, metric_reader, database = otel
    database.issue("otel-test-user")  # a real DB write through the instrumented engine

    response = client.get("/health/live")
    assert response.status_code == 200
    _flush()

    spans = span_exporter.get_finished_spans()
    request_spans = [s for s in spans if s.name == "GET /health/live"]
    assert request_spans, [s.name for s in spans]
    request_span = request_spans[0]
    assert request_span.attributes["http.request.method"] == "GET"
    assert request_span.attributes["http.route"] == "/health/live"
    assert request_span.attributes["http.response.status_code"] == 200

    db_spans = [s for s in spans if s.attributes.get("db.system") == "sqlite"]
    assert db_spans, "expected at least one SQLAlchemy child span"

    metrics_data = metric_reader.get_metrics_data()
    duration_points = [
        dp
        for rm in metrics_data.resource_metrics
        for sm in rm.scope_metrics
        for metric in sm.metrics
        if metric.name == "http.server.request.duration"
        for dp in metric.data.data_points
    ]
    assert any(dp.attributes.get("http.route") == "/health/live" for dp in duration_points)


def test_request_id_correlates_span_and_log(otel):
    span_exporter, log_exporter, _metric_reader, _database = otel
    response = client.get("/health/live")
    request_id = response.headers["x-request-id"]
    assert request_id
    _flush()

    spans = span_exporter.get_finished_spans()
    matching = [s for s in spans if s.attributes.get("request_id") == request_id]
    assert matching, [s.attributes for s in spans if s.name == "GET /health/live"]

    logs = log_exporter.get_finished_logs()
    bodies = [item.log_record.body for item in logs]
    assert any(request_id in (body or "") for body in bodies), bodies
    assert any(item.log_record.attributes.get("request_id") == request_id for item in logs)


def test_sensitive_values_are_redacted(otel):
    span_exporter, log_exporter, metric_reader, database = otel
    secret_cookie = "call_center_session=super-secret-session-token"
    secret_auth = "Bearer super-secret-bearer-token"
    fake_connection_string = "postgresql://dbuser:hunter2@internal-db.example:5432/call_center"
    note_text = "customer workbook note: churn risk, do not share"

    client.get(
        "/customers",
        params={"q": f"{fake_connection_string} {note_text}"},
        headers={"Cookie": secret_cookie, "Authorization": secret_auth},
    )
    # A real connect+query cycle on the already-instrumented engine, so the
    # db.client.connections.usage gauge gets a fresh measurement -- and, since it's taken
    # while the "connect" span is the current recording span, an exemplar -- to check below.
    database.issue("otel-redact-test-user")
    _flush()

    secrets = ["super-secret-session-token", "super-secret-bearer-token", "hunter2", "churn risk", fake_connection_string]

    spans = span_exporter.get_finished_spans()
    assert spans
    for span in spans:
        assert set(span.attributes.keys()) <= otel_setup.ALLOWED_ATTRIBUTES, span.attributes
        serialized = " ".join(f"{k}={v}" for k, v in span.attributes.items())
        for secret in secrets:
            assert secret not in serialized

    logs = log_exporter.get_finished_logs()
    assert logs
    for item in logs:
        body = str(item.log_record.body or "")
        attrs = item.log_record.attributes or {}
        assert set(attrs.keys()) <= otel_setup.ALLOWED_ATTRIBUTES, attrs
        for secret in secrets:
            assert secret not in body
            assert secret not in " ".join(str(v) for v in attrs.values())

    metrics_data = metric_reader.get_metrics_data()
    connection_usage_points = []
    for rm in metrics_data.resource_metrics:
        for sm in rm.scope_metrics:
            for metric in sm.metrics:
                for dp in metric.data.data_points:
                    for value in dp.attributes.values():
                        for secret in secrets:
                            assert secret not in str(value)
                    # The gap QA found: a View-dropped attribute (like "pool.name") never
                    # showed up in dp.attributes, but survived unredacted in exemplars.
                    for exemplar in dp.exemplars:
                        assert "pool.name" not in exemplar.filtered_attributes, exemplar.filtered_attributes
                        for value in exemplar.filtered_attributes.values():
                            for secret in secrets:
                                assert secret not in str(value)
                    if metric.name == "db.client.connections.usage":
                        connection_usage_points.append(dp)

    # Not just "no secrets leaked" -- the connection-pool gauge's exemplars must actually have
    # been exercised by this test (via database.issue() above), and pool.name must be dropped
    # from them exactly as it is from the main attribute set, per the View comment/deployment.md.
    assert connection_usage_points
    assert any(dp.exemplars for dp in connection_usage_points), "expected at least one exemplar"
    for dp in connection_usage_points:
        assert "pool.name" not in dp.attributes
        for exemplar in dp.exemplars:
            assert "pool.name" not in exemplar.filtered_attributes
