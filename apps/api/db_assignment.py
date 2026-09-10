from datetime import datetime, timezone
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool

class AssignmentBase(DeclarativeBase): pass

class RuleRow(AssignmentBase):
    __tablename__ = "assignment_rules"
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    position: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=0)

class AuditRow(AssignmentBase):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    action: Mapped[str] = mapped_column(String(120))
    target: Mapped[str] = mapped_column(String(255))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class AssignmentDatabase:
    def __init__(self, url: str, *, create_schema: bool = True):
        options = {"connect_args": {"check_same_thread": False}, "poolclass": StaticPool} if ":memory:" in url else {}
        self.engine = create_engine(url, **options)
        if create_schema: AssignmentBase.metadata.create_all(self.engine)

    def create_rule(self, *, rule_id: str, name: str, position: int, actor_id: str) -> RuleRow:
        with Session(self.engine) as session:
            row = RuleRow(id=rule_id, name=name, position=position, active=True, version=0); session.add(row); session.add(AuditRow(actor_id=actor_id, action="Assignment rule created", target=rule_id, details={"name": name}, created_at=datetime.now(timezone.utc))); session.commit(); session.refresh(row); return row

    def update_rule(self, rule_id: str, patch: dict, actor_id: str) -> RuleRow | None:
        with Session(self.engine) as session:
            row = session.get(RuleRow, rule_id)
            if not row: return None
            for key in ("name", "position", "active"):
                if key in patch: setattr(row, key, patch[key])
            row.version += 1; session.add(AuditRow(actor_id=actor_id, action="Assignment rule changed", target=rule_id, details={key: patch[key] for key in patch if key in {"name", "position", "active"}}, created_at=datetime.now(timezone.utc))); session.commit(); session.refresh(row); return row

    def ordered_rules(self) -> list[RuleRow]:
        with Session(self.engine) as session: return list(session.scalars(select(RuleRow).order_by(RuleRow.position, RuleRow.id)))

    def audit(self, page: int = 1, page_size: int = 25) -> tuple[list[AuditRow], int]:
        with Session(self.engine) as session:
            total = session.query(AuditRow).count(); rows = list(session.scalars(select(AuditRow).order_by(AuditRow.id).offset((page - 1) * page_size).limit(page_size))); return rows, total

    def append_audit(self, *, actor_id: str | None, action: str, target: str, details: dict) -> None:
        with Session(self.engine) as session:
            session.add(AuditRow(actor_id=actor_id, action=action, target=target, details=details, created_at=datetime.now(timezone.utc))); session.commit()
