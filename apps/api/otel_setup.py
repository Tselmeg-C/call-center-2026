"""OpenTelemetry wiring for apps/api (issue #34).

Configured entirely from the standard OTel environment variables --
``OTEL_EXPORTER_OTLP_ENDPOINT``, ``OTEL_EXPORTER_OTLP_HEADERS``, ``OTEL_SERVICE_NAME``,
``OTEL_RESOURCE_ATTRIBUTES`` (which carries ``deployment.environment``) -- so this module
never hardcodes an endpoint or a credential. See ``_docs/deployment.md`` for the exact
variables and values for dev/prod.

When ``OTEL_EXPORTER_OTLP_ENDPOINT`` is unset (local dev, CI) and no exporter override is
given, ``configure_otel`` constructs nothing at all: no TracerProvider/MeterProvider/
LoggerProvider, no OTLP exporter, no background export thread, no network call. That is
the disabled path exercised by ``test_otel.py::test_disabled_when_otlp_endpoint_unset``.

Tests instead pass ``span_exporter`` / ``log_exporter`` / ``metric_reader`` pointed at the
SDK's in-memory exporters, never a live Grafana Cloud endpoint (none is available to this
task -- see issue #34's Out of scope / Constraints).

Every span, log record, and metric data point -- including each data point's exemplars, which
the SDK's View mechanism does not touch on its own -- is passed through an explicit attribute
allowlist (``ALLOWED_ATTRIBUTES`` / the per-metric ``Views`` and ``_redact_metrics_data`` below)
before it reaches an exporter, so a cookie, an auth header, a connection string, or note/workbook
free text that an auto-instrumentation library might otherwise attach can never be logged or
exported -- see AGENTS.md's credential rule.
"""
import dataclasses
import logging
import os

import sqlalchemy.ext.asyncio  # noqa: F401  -- forces sqlalchemy.ext.asyncio to exist as an
# attribute chain: opentelemetry-instrumentation-sqlalchemy's uninstrument() accesses it via a
# literal `sqlalchemy.ext.asyncio` expression, which AttributeErrors if nothing ever imported
# that submodule -- true here, since every db_*.py adapter is sync-only.

from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.instrumentation.sqlalchemy.engine import EngineTracer
from opentelemetry.metrics import get_meter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.metrics.view import View
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.semconv.metrics import MetricInstruments
from opentelemetry.trace import get_tracer

# The new-style stable HTTP semantic conventions give clean, low-cardinality attributes
# (http.route instead of a raw path+query target) on both spans *and* the request-duration
# metric -- the old default otherwise puts the query string on every span, which is exactly
# the kind of free text this issue's redaction step exists to keep out of Grafana.
os.environ.setdefault("OTEL_SEMCONV_STABILITY_OPT_IN", "http")

REQUEST_ID_ATTRIBUTE = "request_id"

# Everything this app allows onto an exported span or log record. Anything else a library
# attaches automatically (cookies, auth headers, raw connection strings, query-string /
# free-text content) is stripped before export, never partially -- the key itself is removed.
ALLOWED_ATTRIBUTES = frozenset({
    "http.request.method",
    "http.route",
    "http.response.status_code",
    "network.protocol.version",
    "url.scheme",
    "db.system",
    "db.operation",
    REQUEST_ID_ATTRIBUTE,
})

# Same idea for metrics, via the SDK's own View mechanism: request duration keeps only the
# allowlisted labels, and the SQLAlchemy connection-pool gauge drops "pool.name" entirely --
# by default it reports the (password-masked, but still host/user/db-carrying) DSN as a label.
METRIC_VIEWS = (
    View(
        instrument_name="http.server.request.duration",
        attribute_keys={"http.request.method", "http.route", "http.response.status_code"},
    ),
    View(instrument_name="db.client.connections.usage", attribute_keys={"state"}),
)

# A View's attribute_keys only trims a datapoint's *main* attribute set -- the SDK's exemplar
# reservoir independently keeps every attribute a View dropped in that datapoint's
# exemplars[].filtered_attributes (that is what "filtered" means there: filtered out of the
# aggregation, not out of export). So the same per-instrument allowlist has to be re-applied to
# exemplars too, via _redact_metrics_data below -- otherwise a dropped attribute like
# "pool.name" still reaches the exported metric stream through the back door.
_METRIC_ATTRIBUTE_ALLOWLISTS = {view._instrument_name: view._attribute_keys for view in METRIC_VIEWS}


def _redact(attributes: dict | None, allowed: frozenset = ALLOWED_ATTRIBUTES) -> dict:
    return {key: value for key, value in (attributes or {}).items() if key in allowed}


def _redact_metrics_data(metrics_data) -> None:
    """Drops every non-allowlisted key from each datapoint's attributes AND its exemplars'
    filtered_attributes, in place -- symmetric with _RedactingSpanExporter/_RedactingLogExporter.
    """
    for resource_metrics in metrics_data.resource_metrics:
        for scope_metrics in resource_metrics.scope_metrics:
            for metric in scope_metrics.metrics:
                allowed = _METRIC_ATTRIBUTE_ALLOWLISTS.get(metric.name, ALLOWED_ATTRIBUTES)
                for point in metric.data.data_points:
                    # attributes/exemplars are frozen dataclass fields, but the dict/list
                    # values they hold are ordinary mutable objects -- mutate those in place
                    # rather than reassigning the (frozen) field itself. Redact first, then
                    # clear+update -- clearing before reading would redact against nothing.
                    redacted_attributes = _redact(point.attributes, allowed)
                    point.attributes.clear()
                    point.attributes.update(redacted_attributes)
                    point.exemplars[:] = [
                        dataclasses.replace(exemplar, filtered_attributes=_redact(exemplar.filtered_attributes, allowed))
                        for exemplar in point.exemplars
                    ]


def _redact_metric_reader(metric_reader):
    """Patches ``metric_reader`` in place so every batch of metrics it receives is redacted
    first. Patches the instance itself (rather than wrapping it in a new object) because
    callers -- including tests -- keep their own reference to the exact reader they passed to
    ``configure_otel`` and read metrics back off that same object.
    """
    original_receive_metrics = metric_reader._receive_metrics

    def _receive_metrics(metrics_data, timeout_millis: int = 10_000, **kwargs):
        _redact_metrics_data(metrics_data)
        return original_receive_metrics(metrics_data, timeout_millis=timeout_millis, **kwargs)

    metric_reader._receive_metrics = _receive_metrics
    return metric_reader


class _RedactingSpanExporter:
    """Wraps any SpanExporter, dropping every non-allowlisted attribute before export."""

    def __init__(self, wrapped):
        self._wrapped = wrapped

    def export(self, spans):
        for span in spans:
            span._attributes = _redact(span._attributes)
        return self._wrapped.export(spans)

    def shutdown(self):
        return self._wrapped.shutdown()

    def force_flush(self, timeout_millis: int = 30000):
        return self._wrapped.force_flush(timeout_millis)


class _RedactingLogExporter:
    """Wraps any LogRecordExporter, dropping every non-allowlisted log attribute before export."""

    def __init__(self, wrapped):
        self._wrapped = wrapped

    def export(self, batch):
        for item in batch:
            item.log_record.attributes = _redact(item.log_record.attributes)
        return self._wrapped.export(batch)

    def shutdown(self):
        return self._wrapped.shutdown()

    def force_flush(self, timeout_millis: int = 30000):
        return self._wrapped.force_flush(timeout_millis)


_state = {"enabled": False, "tracer_provider": None, "logger_provider": None, "meter_provider": None, "log_handler": None}


def configure_otel(app, *, span_exporter=None, log_exporter=None, metric_reader=None):
    """Instruments ``app`` (FastAPI + every SQLAlchemy engine via ``instrument_engine``).

    With no keyword arguments this builds real OTLP exporters purely from environment
    variables. Pass ``span_exporter`` / ``log_exporter`` / ``metric_reader`` (SDK in-memory
    exporters) to verify the wiring in a test with no live collector.

    Returns the internal state dict once enabled, or ``None`` when
    ``OTEL_EXPORTER_OTLP_ENDPOINT`` is unset and no override was given -- the clean,
    nothing-constructed disabled path.
    """
    if _state["enabled"]:
        return _state
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not endpoint and span_exporter is None and log_exporter is None and metric_reader is None:
        return None

    resource = Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME") or "call-center-api"})

    if span_exporter is None:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        span_exporter = OTLPSpanExporter()
    if log_exporter is None:
        from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
        log_exporter = OTLPLogExporter()
    if metric_reader is None:
        from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
        metric_reader = PeriodicExportingMetricReader(OTLPMetricExporter())
    _redact_metric_reader(metric_reader)

    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(_RedactingSpanExporter(span_exporter)))

    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(BatchLogRecordProcessor(_RedactingLogExporter(log_exporter)))
    log_handler = LoggingHandler(level=logging.INFO, logger_provider=logger_provider)
    api_logger = logging.getLogger("call-center.api")
    if api_logger.getEffectiveLevel() > logging.INFO:
        api_logger.setLevel(logging.INFO)  # the request log this bridges is logger.info(...)
    api_logger.addHandler(log_handler)

    meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader], views=list(METRIC_VIEWS))

    FastAPIInstrumentor.instrument_app(app, tracer_provider=tracer_provider, meter_provider=meter_provider)
    # Starlette caches app.middleware_stack after the first request; instrument_app only
    # patches build_middleware_stack, so force an immediate rebuild -- otherwise an app that
    # already served a request before configure_otel() ran (as in this repo's own test suite,
    # which imports the app once and reuses it across files) would silently keep serving
    # every later request through the old, uninstrumented stack.
    app.middleware_stack = app.build_middleware_stack()

    _state.update(
        enabled=True,
        tracer_provider=tracer_provider,
        logger_provider=logger_provider,
        meter_provider=meter_provider,
        log_handler=log_handler,
    )
    return _state


def instrument_engine(engine) -> None:
    """Adds one span per DB query and one span per physical connect() on ``engine``.
    No-op when OTel is disabled or engine is None.

    Calling ``SQLAlchemyInstrumentor()._instrument(engine=...)`` once per engine (this app has
    4) used to leak: it monkeypatches ``Engine.connect`` at the *class* level -- shared by every
    engine in the process -- via wrapt on every single call, and wrapt doesn't dedupe repeated
    wraps, so each call nested another wrapper around the same class method. A single connect()
    on the 4th engine then emitted 4 duplicate "connect" spans, one per prior call.

    The fix: that class-level wrap must happen at most once per process. The *public*,
    singleton-guarded ``instrument()`` gives exactly that for free (guarded by
    ``is_instrumented_by_opentelemetry``, so a second call is a no-op instead of a second wrap).
    Each engine then only needs its own ``EngineTracer`` -- the same per-engine object
    ``_instrument(engine=...)`` builds internally -- which registers plain SQLAlchemy event
    listeners scoped to that one engine *instance* (query spans, pool metrics). That part was
    never duplicated (SQLAlchemy's event system is already per-instance) and is exactly as safe
    to repeat per engine as the docstring here used to claim the whole thing was.
    """
    if not (_state["enabled"] and engine is not None):
        return
    instrumentor = SQLAlchemyInstrumentor()
    if not instrumentor.is_instrumented_by_opentelemetry:
        instrumentor.instrument(tracer_provider=_state["tracer_provider"], meter_provider=_state["meter_provider"])
    tracer = get_tracer(__name__, tracer_provider=_state["tracer_provider"])
    meter = get_meter(__name__, meter_provider=_state["meter_provider"])
    connections_usage = meter.create_up_down_counter(
        name=MetricInstruments.DB_CLIENT_CONNECTIONS_USAGE,
        unit="connections",
        description="The number of connections that are currently in state described by the state attribute.",
    )
    EngineTracer(tracer, engine, connections_usage)


def annotate_request_id(request_id: str) -> None:
    """Attaches the origin_guard-generated request ID to the current span, if any."""
    span = trace.get_current_span()
    if span.is_recording():
        span.set_attribute(REQUEST_ID_ATTRIBUTE, request_id)


def shutdown_otel(app=None) -> None:
    """Reverses configure_otel: for tests, and for a clean process shutdown otherwise."""
    if not _state["enabled"]:
        return
    _state["tracer_provider"].shutdown()
    _state["logger_provider"].shutdown()
    _state["meter_provider"].shutdown()
    logging.getLogger("call-center.api").removeHandler(_state["log_handler"])
    if app is not None:
        FastAPIInstrumentor().uninstrument_app(app)
    instrumentor = SQLAlchemyInstrumentor()
    if instrumentor.is_instrumented_by_opentelemetry:
        instrumentor.uninstrument()  # public call: also resets the singleton flag instrument_engine checks
    _state.update(enabled=False, tracer_provider=None, logger_provider=None, meter_provider=None, log_handler=None)
