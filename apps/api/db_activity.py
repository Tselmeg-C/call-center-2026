from datetime import datetime, timezone
from hashlib import sha256
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool

class ActivityBase(DeclarativeBase): pass

class ActivityRow(ActivityBase):
    __tablename__ = "activities"
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    bcn: Mapped[str] = mapped_column(String(64))
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
    bcn: Mapped[str] = mapped_column(String(64)); actor_id: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(32)); due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True); status: Mapped[str] = mapped_column(String(16)); note: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=0); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True)); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

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
            session.add(IdempotencyRow(actor_id=actor_id, operation=operation, submission_id=submission_id, fingerprint=fingerprint(payload), result=result, completed_at=datetime.now(timezone.utc))); session.commit(); return result

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
                result.setdefault(item.bcn, []).append({"id": item.id, "bcn": item.bcn, "kind": item.kind, "outcome": item.outcome, "note": None if item.deleted_at else item.text, "actorId": item.actor_id, "timestamp": item.created_at.isoformat(), "deleted": item.deleted_at is not None})
            return result

    def soft_delete(self, record_id: str, actor_id: str) -> bool:
        with Session(self.engine) as session:
            row = session.get(ActivityRow, record_id)
            if not row: return False
            row.deleted_at = datetime.now(timezone.utc); row.deleted_by = actor_id; session.commit(); return True

    def save_activity(self, *, record_id: str, bcn: str, actor_id: str, kind: str, outcome: str | None, text: str | None) -> None:
        with Session(self.engine) as session:
            session.add(ActivityRow(id=record_id, bcn=bcn, actor_id=actor_id, kind=kind, outcome=outcome, text=text, created_at=datetime.now(timezone.utc))); session.commit()

    def save_followup(self, record: dict) -> None:
        with Session(self.engine) as session:
            row = session.get(FollowUpRow, record["id"]) or FollowUpRow(id=record["id"], bcn=record["bcn"], actor_id=record["actorId"], type=record["type"], due=datetime.fromisoformat(record["due"]) if record.get("due") else None, status=record["status"], note=record.get("note"), version=0, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc))
            row.type = record["type"]; row.due = datetime.fromisoformat(record["due"]) if record.get("due") else None; row.status = record["status"]; row.note = record.get("note"); row.version = record.get("version", row.version); row.updated_at = datetime.now(timezone.utc); session.add(row); session.commit()

    def complete_followup(self, record: dict, interaction: dict) -> None:
        with Session(self.engine) as session:
            row = session.get(FollowUpRow, record["id"])
            if not row: raise ValueError("follow-up not found")
            row.status = "Completed"; row.updated_at = datetime.now(timezone.utc)
            session.add(ActivityRow(id=interaction["id"], bcn=interaction["bcn"], actor_id=interaction["actorId"], kind="Interaction", outcome=interaction.get("outcome"), text=interaction.get("note"), created_at=datetime.now(timezone.utc)))
            session.add(row); session.commit()

    def followups(self, bcn: str) -> list[FollowUpRow]:
        with Session(self.engine) as session: return list(session.scalars(select(FollowUpRow).where(FollowUpRow.bcn == bcn).order_by(FollowUpRow.created_at, FollowUpRow.id)))

    def all_followups(self) -> list[FollowUpRow]:
        with Session(self.engine) as session: return list(session.scalars(select(FollowUpRow).order_by(FollowUpRow.created_at, FollowUpRow.id)))

    def save_reason(self, reason: dict) -> None:
        with Session(self.engine) as session:
            row = session.get(ClosureReasonRow, reason["id"]) or ClosureReasonRow(id=reason["id"], label=reason["label"], active=reason["active"])
            row.label = reason["label"]; row.active = reason["active"]; session.add(row); session.commit()

    def reasons(self) -> list[ClosureReasonRow]:
        with Session(self.engine) as session: return list(session.scalars(select(ClosureReasonRow).order_by(ClosureReasonRow.id)))
