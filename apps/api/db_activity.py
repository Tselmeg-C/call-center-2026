from datetime import datetime, timezone
from hashlib import sha256
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, create_engine, select, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool
from .db_auth import StorageError
from .db_assignment import AuditRow

class ActivityBase(DeclarativeBase): pass

class ActivityRow(ActivityBase):
    __tablename__ = "activities"
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    bcn: Mapped[str] = mapped_column(String(128))
    actor_id: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(32))
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class FollowUpRow(ActivityBase):
    __tablename__ = "follow_ups"
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    bcn: Mapped[str] = mapped_column(String(128)); actor_id: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(32)); due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True); status: Mapped[str] = mapped_column(String(16)); note: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=0); interaction_id: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True)); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class IdempotencyRow(ActivityBase):
    __tablename__ = "idempotency_records"
    actor_id: Mapped[str] = mapped_column(String(120), primary_key=True); operation: Mapped[str] = mapped_column(String(80), primary_key=True); submission_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(128)); result: Mapped[dict] = mapped_column(JSON); completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class ClosureReasonRow(ActivityBase):
    __tablename__ = "closure_reasons"
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    label: Mapped[str] = mapped_column(String(120), unique=True)
    active: Mapped[bool] = mapped_column(default=True)

def fingerprint(payload: str | bytes) -> str: return sha256(payload if isinstance(payload, bytes) else payload.encode()).hexdigest()

class ActivityDatabase:
    def __init__(self, url: str, *, create_schema: bool = True):
        options = {"connect_args": {"check_same_thread": False}, "poolclass": StaticPool} if ":memory:" in url else {}
        self.engine = create_engine(url, **options)
        if create_schema: ActivityBase.metadata.create_all(self.engine)

    def save_idempotent(self, *, actor_id: str, operation: str, submission_id: str, payload: str | bytes, result: dict) -> dict:
        with Session(self.engine) as session:
            row = session.get(IdempotencyRow, (actor_id, operation, submission_id))
            if row:
                if row.fingerprint != fingerprint(payload): raise ValueError("submission already used")
                return row.result
            session.add(IdempotencyRow(actor_id=actor_id, operation=operation, submission_id=submission_id, fingerprint=fingerprint(payload), result=result, completed_at=datetime.now(timezone.utc)))
            try:
                session.commit()
            except IntegrityError:
                session.rollback(); row = session.get(IdempotencyRow, (actor_id, operation, submission_id))
                if row is not None:
                    if row.fingerprint != fingerprint(payload): raise ValueError("submission already used")
                    return row.result
                raise
            return result

    def get_idempotent(self, *, actor_id: str, operation: str, submission_id: str, payload: str | bytes) -> dict | None:
        with Session(self.engine) as session:
            row = session.get(IdempotencyRow, (actor_id, operation, submission_id))
            if not row: return None
            if row.fingerprint != fingerprint(payload): raise ValueError("submission already used")
            return row.result

    def history(self, bcn: str, page: int = 1, page_size: int = 25) -> tuple[list[ActivityRow], int]:
        with Session(self.engine) as session:
            query = select(ActivityRow).where(ActivityRow.bcn == bcn).order_by(ActivityRow.created_at, ActivityRow.id); total = session.query(ActivityRow).filter(ActivityRow.bcn == bcn).count(); return list(session.scalars(query.offset((page - 1) * page_size).limit(page_size))), total

    def history_map(self, bcns: list[str]) -> dict[str, list[dict]]:
        if not bcns: return {}
        with Session(self.engine) as session:
            rows = session.scalars(select(ActivityRow).where(ActivityRow.bcn.in_(bcns)).order_by(ActivityRow.created_at, ActivityRow.id))
            result = {}
            for item in rows:
                result.setdefault(item.bcn, []).append({"id": item.id, "bcn": item.bcn, "kind": item.kind, "outcome": item.outcome, "note": None if item.deleted_at else item.text, "actorId": item.actor_id, "timestamp": item.created_at.isoformat(), "deleted": item.deleted_at is not None, "deletedBy": item.deleted_by, "deletedAt": item.deleted_at.isoformat() if item.deleted_at else None})
            return result

    def soft_delete(self, record_id: str, actor_id: str) -> bool:
        with Session(self.engine) as session:
            row = session.get(ActivityRow, record_id)
            if not row: return False
            row.deleted_at = datetime.now(timezone.utc); row.deleted_by = actor_id; session.commit(); return True

    def save_activity(self, *, record_id: str, bcn: str, actor_id: str, kind: str, outcome: str | None, text: str | None) -> None:
        with Session(self.engine) as session:
            session.add(ActivityRow(id=record_id, bcn=bcn, actor_id=actor_id, kind=kind, outcome=outcome, text=text, created_at=datetime.now(timezone.utc))); session.commit()

    def create_activity(self, record: dict, *, operation: str, submission_id: str, payload: str) -> dict:
        try:
            with Session(self.engine) as session, session.begin():
                now = datetime.fromisoformat(record["timestamp"])
                session.add(IdempotencyRow(actor_id=record["actorId"], operation=operation, submission_id=submission_id, fingerprint=fingerprint(payload), result=record, completed_at=now))
                session.flush()
                session.add(ActivityRow(id=record["id"], bcn=record["bcn"], actor_id=record["actorId"], kind=record["kind"], outcome=record.get("outcome"), text=record.get("text") or record.get("note"), created_at=now))
                session.add(AuditRow(actor_id=record["actorId"], action="Interaction created" if operation == "interaction" else "Note created", target=record["bcn"], details={"outcome": record["outcome"]} if operation == "interaction" else {}, created_at=now))
            return record
        except IntegrityError:
            prior = self.get_idempotent(actor_id=record["actorId"], operation=operation, submission_id=submission_id, payload=payload)
            if prior is not None: return prior
            raise StorageError("Storage operation failed.") from None
        except SQLAlchemyError:
            raise StorageError("Storage operation failed.") from None

    def save_followup(self, record: dict) -> None:
        with Session(self.engine) as session:
            row = session.get(FollowUpRow, record["id"]) or FollowUpRow(id=record["id"], bcn=record["bcn"], actor_id=record["actorId"], type=record["type"], due=datetime.fromisoformat(record["due"]) if record.get("due") else None, status=record["status"], note=record.get("note"), version=0, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
            row.type = record["type"]; row.due = datetime.fromisoformat(record["due"]) if record.get("due") else None; row.status = record["status"]; row.note = record.get("note"); row.version = record.get("version", row.version); row.updated_at = datetime.now(timezone.utc); session.add(row); session.commit()

    def create_followup(self, record: dict, *, submission_id: str, payload: str) -> dict:
        try:
            with Session(self.engine) as session, session.begin():
                now = datetime.fromisoformat(record["createdAt"])
                session.add(IdempotencyRow(actor_id=record["actorId"], operation="followup", submission_id=submission_id, fingerprint=fingerprint(payload), result=record, completed_at=now))
                session.flush()
                session.add(FollowUpRow(id=record["id"], bcn=record["bcn"], actor_id=record["actorId"], type=record["type"], due=datetime.fromisoformat(record["due"]) if record.get("due") else None, status=record["status"], note=record.get("note"), version=0, created_at=now, updated_at=now))
                session.add(ActivityRow(id=record["id"], bcn=record["bcn"], actor_id=record["actorId"], kind="Follow-up", text=record.get("note"), created_at=now))
            return record
        except IntegrityError:
            prior = self.get_idempotent(actor_id=record["actorId"], operation="followup", submission_id=submission_id, payload=payload)
            if prior is not None: return prior
            raise StorageError("Storage operation failed.") from None
        except SQLAlchemyError:
            raise StorageError("Storage operation failed.") from None

    def complete_followup(self, record: dict, interaction: dict, idempotency: dict | None = None) -> None:
        with Session(self.engine) as session:
            row = session.get(FollowUpRow, record["id"], with_for_update=True)
            if not row: raise ValueError("follow-up not found")
            if row.bcn != interaction.get("bcn"): raise ValueError("interaction belongs to another customer")
            if row.status != "Open": raise ValueError("follow-up is no longer open")
            row.status = "Completed"; row.interaction_id = interaction["id"]; row.updated_at = datetime.now(timezone.utc)
            session.add(ActivityRow(id=interaction["id"], bcn=interaction["bcn"], actor_id=interaction["actorId"], kind="Interaction", outcome=interaction.get("outcome"), text=interaction.get("note"), created_at=datetime.now(timezone.utc)))
            if idempotency:
                session.add(IdempotencyRow(actor_id=idempotency["actor_id"], operation=idempotency["operation"], submission_id=idempotency["submission_id"], fingerprint=fingerprint(idempotency["payload"]), result=idempotency["result"], completed_at=datetime.now(timezone.utc)))
            session.add(row); session.commit()

    def close_lifecycle(self, bcn: str, event: dict, *, actor_id: str, submission_id: str, payload: str, result: dict) -> None:
        with Session(self.engine) as session:
            for row in session.scalars(select(FollowUpRow).where(FollowUpRow.bcn == bcn, FollowUpRow.status == "Open")):
                row.status = "Cancelled"; row.updated_at = datetime.now(timezone.utc)
                session.add(ActivityRow(id=f"activity-{row.id}-cancel", bcn=bcn, actor_id=actor_id, kind="Follow-up cancel", text="Customer closed", created_at=datetime.now(timezone.utc)))
            session.add(ActivityRow(id=event["id"], bcn=bcn, actor_id=actor_id, kind="Closure", text=event["reason"], created_at=datetime.fromisoformat(event["timestamp"])))
            session.add(IdempotencyRow(actor_id=actor_id, operation="close", submission_id=submission_id, fingerprint=fingerprint(payload), result=result, completed_at=datetime.now(timezone.utc)))
            session.commit()

    def followups(self, bcn: str) -> list[FollowUpRow]:
        with Session(self.engine) as session: return list(session.scalars(select(FollowUpRow).where(FollowUpRow.bcn == bcn).order_by(FollowUpRow.created_at, FollowUpRow.id)))

    def all_followups(self) -> list[FollowUpRow]:
        with Session(self.engine) as session: return list(session.scalars(select(FollowUpRow).order_by(FollowUpRow.created_at, FollowUpRow.id)))

    def followup_summary(self, bcns: list[str], today: str) -> dict[str, dict[str, int]]:
        if not bcns: return {}
        with Session(self.engine) as session:
            rows = session.execute(select(FollowUpRow.bcn, FollowUpRow.due, FollowUpRow.status, func.count(FollowUpRow.id)).where(FollowUpRow.bcn.in_(bcns)).group_by(FollowUpRow.bcn, FollowUpRow.due, FollowUpRow.status)).all()
        result = {bcn: {"overdue": 0, "today": 0, "undated": 0, "open": 0} for bcn in bcns}
        for bcn, due, status, count in rows:
            if status != "Open": continue
            result[bcn]["open"] += count
            if due is None: result[bcn]["undated"] += count
            elif due.date().isoformat() < today: result[bcn]["overdue"] += count
            elif due.date().isoformat() == today: result[bcn]["today"] += count
        return result

    def interaction_counts(self, bcns: list[str]) -> dict[str, int]:
        if not bcns: return {}
        with Session(self.engine) as session:
            rows = session.execute(select(ActivityRow.bcn, func.count(ActivityRow.id)).where(ActivityRow.bcn.in_(bcns), ActivityRow.kind == "Interaction", ActivityRow.deleted_at.is_(None)).group_by(ActivityRow.bcn)).all()
            return dict(rows)

    def report_interactions(self, start: str | None = None, end: str | None = None) -> tuple[dict[str, dict[str, int]], dict[str, dict[str, int]]]:
        with Session(self.engine) as session:
            query = select(ActivityRow.bcn, ActivityRow.outcome, func.date(ActivityRow.created_at), func.count(ActivityRow.id)).where(ActivityRow.kind == "Interaction", ActivityRow.deleted_at.is_(None))
            if start: query = query.where(func.date(ActivityRow.created_at) >= start)
            if end: query = query.where(func.date(ActivityRow.created_at) <= end)
            rows = session.execute(query.group_by(ActivityRow.bcn, ActivityRow.outcome, func.date(ActivityRow.created_at))).all()
        by_customer: dict[str, dict[str, int]] = {}; daily: dict[str, dict[str, int]] = {}
        for bcn, outcome, date, count in rows:
            key = "attempts" if outcome == "Attempt" else "contacts"; by_customer.setdefault(bcn, {"attempts": 0, "contacts": 0})[key] += count; daily.setdefault(str(date), {"date": str(date), "attempts": 0, "contacts": 0})[key] += count
        return by_customer, daily

    def save_reason(self, reason: dict) -> None:
        with Session(self.engine) as session:
            row = session.get(ClosureReasonRow, reason["id"]) or ClosureReasonRow(id=reason["id"], label=reason["label"], active=reason["active"])
            row.label = reason["label"]; row.active = reason["active"]; session.add(row); session.commit()

    def reasons(self) -> list[ClosureReasonRow]:
        with Session(self.engine) as session: return list(session.scalars(select(ClosureReasonRow).order_by(ClosureReasonRow.id)))
