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
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.sdk._logs.export import InMemoryLogRecordExporter
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from . import otel_setup
from .db_auth import AuthDatabase
from .main import app

client = TestClient(app, base_url="http://localhost")
DASHBOARD_PATH = Path(__file__).resolve().parents[2] / "_docs" / "grafana-dashboard.json"


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
    span_exporter, log_exporter, metric_reader, _database = otel
    secret_cookie = "call_center_session=super-secret-session-token"
    secret_auth = "Bearer super-secret-bearer-token"
    fake_connection_string = "postgresql://dbuser:hunter2@internal-db.example:5432/call_center"
    note_text = "customer workbook note: churn risk, do not share"

    client.get(
        "/customers",
        params={"q": f"{fake_connection_string} {note_text}"},
        headers={"Cookie": secret_cookie, "Authorization": secret_auth},
    )
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
    for rm in metrics_data.resource_metrics:
        for sm in rm.scope_metrics:
            for metric in sm.metrics:
                for dp in metric.data.data_points:
                    for value in dp.attributes.values():
                        for secret in secrets:
                            assert secret not in str(value)
