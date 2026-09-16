"""Real-PostgreSQL query benchmark for #26.

Seeds synthetic customers and interaction/follow-up/audit rows into an isolated PostgreSQL
schema, then times real HTTP requests against the FastAPI app running in `CALL_CENTER_STORAGE=
postgres` mode. Reports dataset size, machine/database resources, an EXPLAIN summary per query
shape, and p50/p95 timings for /customers search, /sales/workload, /admin/reports, and
/admin/audit. Prints no customer payloads or credentials.

Usage (from the repository root, so alembic.ini's relative script_location resolves):
    DATABASE_URL=postgresql+psycopg://postgres@localhost:55432/call_center_bench \\
        python -m apps.api.benchmark

    BENCHMARK_SCALE=ci python -m apps.api.benchmark   # small CI-smoke scale, see SCALES below

The target database name must end in _test, _ci, or _bench -- the same isolated-database guard
_docs/persistence.md documents for the acceptance test database -- so this can never run against
real data. Each run creates a throwaway schema, seeds it, benchmarks, and drops it: every run is
already a "reset" of the benchmark dataset.
"""
import os
import platform
from datetime import datetime, timedelta, timezone
from time import perf_counter
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

# "full" matches the 10,000 customers / 150,000 combined interaction+follow-up+audit rows
# documented in _docs/persistence.md. "ci" is a deliberately small smoke scale for CI -- it
# proves the benchmark script and its query paths execute against real PostgreSQL, not that
# the 1s/p95 target holds at full scale; see .github/workflows/frontend.yml.
SCALES = {
    "full": {"customers": 10_000, "interactions": 50_000, "followups": 50_000, "audit": 50_000, "owners": 25},
    "ci": {"customers": 300, "interactions": 1_500, "followups": 1_500, "audit": 1_500, "owners": 5},
}

def _resolve_url() -> str:
    raw = os.getenv("BENCHMARK_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not raw:
        raise SystemExit("Set BENCHMARK_DATABASE_URL or DATABASE_URL to an isolated PostgreSQL database (name ending in _test, _ci, or _bench) before running the benchmark.")
    url = make_url(raw)
    if url.get_backend_name() != "postgresql" or not (url.database or "").endswith(("_test", "_ci", "_bench")):
        raise SystemExit("Use a dedicated PostgreSQL database ending in _test, _ci, or _bench -- never a real/production database.")
    return raw


def _machine_resources() -> dict:
    ram_gb = None
    try:
        with open("/proc/meminfo") as handle:
            for line in handle:
                if line.startswith("MemTotal:"):
                    ram_gb = round(int(line.split()[1]) / 1024 / 1024, 1)
                    break
    except OSError:
        pass
    return {"cpuCount": os.cpu_count(), "ramGb": ram_gb, "platform": platform.platform()}


def _database_resources(engine) -> dict:
    with engine.connect() as connection:
        version = connection.execute(text("SELECT version()")).scalar()
        size = connection.execute(text("SELECT pg_size_pretty(pg_database_size(current_database()))")).scalar()
    return {"serverVersion": version, "databaseSize": size}


def _explain(engine, statement) -> str:
    compiled = statement.compile(engine, compile_kwargs={"literal_binds": True})
    with engine.connect() as connection:
        rows = connection.execute(text(f"EXPLAIN ANALYZE {compiled}")).fetchall()
    return "\n".join(row[0] for row in rows)


def seed(*, customer_url: str, activity_url: str, assignment_url: str, auth_url: str, scale: dict) -> None:
    from .db_auth import UserRow
    from .db_customers import CustomerRow, PhoneRow
    from .db_activity import ActivityRow, FollowUpRow
    from .db_assignment import AuditRow

    auth_engine = create_engine(auth_url)
    customer_engine = create_engine(customer_url)
    activity_engine = create_engine(activity_url)
    assignment_engine = create_engine(assignment_url)

    from pwdlib import PasswordHash
    hashed = PasswordHash.recommended().hash("synthetic-benchmark-only-not-a-real-secret")  # one hash, reused: these accounts are never logged into by password

    owners = [f"bench-sales-{n}" for n in range(scale["owners"])]
    with Session(auth_engine) as session:
        session.execute(UserRow.__table__.insert(), [{"id": "bench-admin", "name": "Bench Admin", "email": "bench-admin@example.test", "role": "Admin", "active": True, "password_hash": hashed}])
        session.execute(UserRow.__table__.insert(), [{"id": owner, "name": owner, "email": f"{owner}@example.test", "role": "Sales", "active": True, "password_hash": hashed} for owner in owners])
        session.commit()

    customer_count = scale["customers"]
    bcns = [f"{i:06d}" for i in range(customer_count)]
    with Session(customer_engine) as session:
        for start in range(0, customer_count, 2000):
            batch = bcns[start:start + 2000]
            session.execute(CustomerRow.__table__.insert(), [{"bcn": bcn, "name": f"Customer {bcn}", "status": "Open" if index % 10 else "Closed", "owner_id": owners[index % len(owners)] if index % 8 else None, "source": {}, "version": 0} for index, bcn in enumerate(batch, start)])
            session.execute(PhoneRow.__table__.insert(), [{"bcn": bcn, "phone": f"555-{bcn}", "is_primary": True} for bcn in batch])
        session.commit()

    now = datetime.now(timezone.utc)
    with Session(activity_engine) as session:
        for start in range(0, scale["interactions"], 5000):
            count = min(5000, scale["interactions"] - start)
            session.execute(ActivityRow.__table__.insert(), [{"id": f"bench-interaction-{start + i}", "bcn": bcns[(start + i) % customer_count], "actor_id": owners[(start + i) % len(owners)], "kind": "Interaction", "outcome": "Attempt" if i % 2 else "Contact", "text": None, "created_at": now - timedelta(minutes=start + i)} for i in range(count)])
        session.commit()
        for start in range(0, scale["followups"], 5000):
            count = min(5000, scale["followups"] - start)
            session.execute(FollowUpRow.__table__.insert(), [{"id": f"bench-followup-{start + i}", "bcn": bcns[(start + i) % customer_count], "actor_id": owners[(start + i) % len(owners)], "type": "Reminder", "due": now + timedelta(days=(i % 14) - 7) if i % 3 else None, "status": "Open" if i % 4 else "Completed", "note": None, "version": 0, "created_at": now, "updated_at": now} for i in range(count)])
        session.commit()

    with Session(assignment_engine) as session:
        for start in range(0, scale["audit"], 5000):
            count = min(5000, scale["audit"] - start)
            session.execute(AuditRow.__table__.insert(), [{"actor_id": owners[(start + i) % len(owners)], "action": "Customer assigned", "target": bcns[(start + i) % customer_count], "details": {}, "created_at": now - timedelta(minutes=start + i)} for i in range(count)])
        session.commit()

    for engine in (auth_engine, customer_engine, activity_engine, assignment_engine):
        engine.dispose()


def run(scale_name: str | None = None) -> dict:
    scale_name = scale_name or os.getenv("BENCHMARK_SCALE", "full")
    scale = SCALES[scale_name]
    base_url = _resolve_url()
    root = make_url(base_url)
    engine = create_engine(root, hide_parameters=True)
    schema = "bench_" + uuid4().hex
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = root.update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(hide_password=False)

    try:
        os.environ["DATABASE_URL"] = isolated
        command.upgrade(Config("apps/api/alembic.ini"), "head")

        from . import main
        from .db_auth import AuthDatabase
        from .db_customers import CustomerDatabase, CustomerRow
        from .db_activity import ActivityDatabase, ActivityRow
        from .db_assignment import AssignmentDatabase, AuditRow

        seed(customer_url=isolated, activity_url=isolated, assignment_url=isolated, auth_url=isolated, scale=scale)

        auth = AuthDatabase(isolated, create_schema=False)
        customers = CustomerDatabase(isolated, create_schema=False)
        activities = ActivityDatabase(isolated, create_schema=False)
        assignments = AssignmentDatabase(isolated, create_schema=False)
        main.auth_db, main.customer_db, main.activity_db, main.assignment_db = auth, customers, activities, assignments
        main.repo.reset()

        # BENCHMARK_OTEL=1 re-runs this same benchmark with the OTel SDK instrumenting every
        # request/DB query, exporting to in-memory (no network, no real Grafana Cloud endpoint)
        # exporters -- issue #34 wants the resulting p50/p95 compared against a plain run to
        # show the SDK's overhead, not network export latency to a live collector.
        otel_enabled = os.getenv("BENCHMARK_OTEL", "").casefold() in {"1", "true", "yes"}
        if otel_enabled:
            from . import otel_setup
            from opentelemetry.sdk._logs.export import InMemoryLogRecordExporter
            from opentelemetry.sdk.metrics.export import InMemoryMetricReader
            from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

            otel_setup.configure_otel(
                main.app,
                span_exporter=InMemorySpanExporter(),
                log_exporter=InMemoryLogRecordExporter(),
                metric_reader=InMemoryMetricReader(),
            )
            for engine in (auth.engine, customers.engine, activities.engine, assignments.engine):
                otel_setup.instrument_engine(engine)

        database_resources = _database_resources(auth.engine)
        explains = {
            "search": _explain(customers.engine, select(CustomerRow).where(func.lower(CustomerRow.name).like("%005%")).order_by(CustomerRow.bcn).limit(25)),
        }

        admin_token, _ = auth.issue("bench-admin")
        owner_token, _ = auth.issue("bench-sales-0")

        timings = {"search": [], "workload": [], "reports": [], "audit": []}
        with TestClient(main.app, base_url="http://localhost") as admin_client, TestClient(main.app, base_url="http://localhost") as owner_client:
            admin_client.cookies.set("call_center_session", admin_token)
            owner_client.cookies.set("call_center_session", owner_token)
            samples = 30
            for _ in range(3):  # warm-up, not recorded
                admin_client.get("/customers", params={"q": "005", "page_size": 25})
                owner_client.get("/sales/workload")
                admin_client.get("/admin/reports")
                admin_client.get("/admin/audit", params={"page_size": 25})
            for _ in range(samples):
                started = perf_counter(); admin_client.get("/customers", params={"q": "005", "page_size": 25}); timings["search"].append((perf_counter() - started) * 1000)
                started = perf_counter(); owner_client.get("/sales/workload"); timings["workload"].append((perf_counter() - started) * 1000)
                started = perf_counter(); admin_client.get("/admin/reports"); timings["reports"].append((perf_counter() - started) * 1000)
                started = perf_counter(); admin_client.get("/admin/audit", params={"page_size": 25}); timings["audit"].append((perf_counter() - started) * 1000)

        explains["workload"] = _explain(customers.engine, select(CustomerRow).where(CustomerRow.owner_id == "bench-sales-0", CustomerRow.status == "Open"))
        explains["reports"] = _explain(activities.engine, select(ActivityRow.bcn, ActivityRow.outcome, func.count(ActivityRow.id)).where(ActivityRow.kind == "Interaction", ActivityRow.deleted_at.is_(None)).group_by(ActivityRow.bcn, ActivityRow.outcome))
        explains["audit"] = _explain(assignments.engine, select(AuditRow).order_by(AuditRow.id).limit(25))

        percentile = lambda values, p: round(sorted(values)[max(0, int(len(values) * p) - 1)], 3)
        report = {
            "scale": scale_name,
            "otel_enabled": otel_enabled,
            "dataset": {"customers": scale["customers"], "interactions": scale["interactions"], "followups": scale["followups"], "audit": scale["audit"]},
            "machine": _machine_resources(),
            "database": database_resources,
            "samples": samples,
            "queries": {name: {"p50_ms": percentile(values, .5), "p95_ms": percentile(values, .95)} for name, values in timings.items()},
            "explain": explains,
        }
        for database in (auth, customers, activities, assignments): database.engine.dispose()
        return report
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        engine.dispose()


if __name__ == "__main__":
    result = run()
    print(f"OTel enabled: {result['otel_enabled']}")
    print(f"Dataset: {result['dataset']}")
    print(f"Machine: {result['machine']}")
    print(f"Database: {result['database']}")
    for name, timing in result["queries"].items():
        print(f"{name}: p50={timing['p50_ms']}ms p95={timing['p95_ms']}ms (target <= 1000ms)")
    print("\nEXPLAIN summaries:")
    for name, plan in result["explain"].items():
        print(f"-- {name} --\n{plan}\n")
