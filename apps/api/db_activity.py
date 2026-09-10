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
    type: Mapped[str] = mapped_column(String(32)); status: Mapped[str] = mapped_column(String(16)); note: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=0); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True)); updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class IdempotencyRow(ActivityBase):
    __tablename__ = "idempotency_records"
    actor_id: Mapped[str] = mapped_column(String(120), primary_key=True); operation: Mapped[str] = mapped_column(String(80), primary_key=True); submission_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(128)); result: Mapped[dict] = mapped_column(JSON); completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

def fingerprint(payload: str) -> str: return sha256(payload.encode()).hexdigest()

class ActivityDatabase:
    def __init__(self, url: str, *, create_schema: bool = True):
        options = {"connect_args": {"check_same_thread": False}, "poolclass": StaticPool} if ":memory:" in url else {}
        self.engine = create_engine(url, **options)
        if create_schema: ActivityBase.metadata.create_all(self.engine)

    def save_idempotent(self, *, actor_id: str, operation: str, submission_id: str, payload: str, result: dict) -> dict:
        with Session(self.engine) as session:
            row = session.get(IdempotencyRow, (actor_id, operation, submission_id))
            if row:
                if row.fingerprint != fingerprint(payload): raise ValueError("submission already used")
                return row.result
            session.add(IdempotencyRow(actor_id=actor_id, operation=operation, submission_id=submission_id, fingerprint=fingerprint(payload), result=result, completed_at=datetime.now(timezone.utc))); session.commit(); return result

    def history(self, bcn: str, page: int = 1, page_size: int = 25) -> tuple[list[ActivityRow], int]:
        with Session(self.engine) as session:
            query = select(ActivityRow).where(ActivityRow.bcn == bcn).order_by(ActivityRow.created_at, ActivityRow.id); total = session.query(ActivityRow).filter(ActivityRow.bcn == bcn).count(); return list(session.scalars(query.offset((page - 1) * page_size).limit(page_size))), total

    def save_activity(self, *, record_id: str, bcn: str, actor_id: str, kind: str, outcome: str | None, text: str | None) -> None:
        with Session(self.engine) as session:
            session.add(ActivityRow(id=record_id, bcn=bcn, actor_id=actor_id, kind=kind, outcome=outcome, text=text, created_at=datetime.now(timezone.utc))); session.commit()
