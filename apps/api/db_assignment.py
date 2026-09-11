from datetime import datetime, timedelta, timezone
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, create_engine, func, select
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
    owner_id: Mapped[str | None] = mapped_column(String(120), nullable=True)

class AuditRow(AssignmentBase):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    action: Mapped[str] = mapped_column(String(120))
    target: Mapped[str] = mapped_column(String(255))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class AssignmentHistoryRow(AssignmentBase):
    __tablename__ = "assignment_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bcn: Mapped[str] = mapped_column(String(128)); actor_id: Mapped[str | None] = mapped_column(String(120), nullable=True); old_owner_id: Mapped[str | None] = mapped_column(String(120), nullable=True); new_owner_id: Mapped[str | None] = mapped_column(String(120), nullable=True); reason: Mapped[str] = mapped_column(String(255)); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class AssignmentRunRow(AssignmentBase):
    __tablename__ = "assignment_runs"
    submission_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    scope: Mapped[str] = mapped_column(String(32)); result: Mapped[dict] = mapped_column(JSON); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class AssignmentSettingRow(AssignmentBase):
    __tablename__ = "assignment_settings"
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)

class AssignmentDatabase:
    def __init__(self, url: str, *, create_schema: bool = True):
        options = {"connect_args": {"check_same_thread": False}, "poolclass": StaticPool} if ":memory:" in url else {}
        self.engine = create_engine(url, **options)
        if create_schema: AssignmentBase.metadata.create_all(self.engine)

    def create_rule(self, *, rule_id: str, name: str, position: int, actor_id: str, owner_id: str | None = None) -> RuleRow:
        with Session(self.engine) as session:
            row = RuleRow(id=rule_id, name=name, position=position, active=True, version=0, owner_id=owner_id); session.add(row); session.add(AuditRow(actor_id=actor_id, action="Assignment rule created", target=rule_id, details={"name": name, "ownerId": owner_id}, created_at=datetime.now(timezone.utc))); session.commit(); session.refresh(row); return row

    def update_rule(self, rule_id: str, patch: dict, actor_id: str) -> RuleRow | None:
        with Session(self.engine) as session:
            row = session.get(RuleRow, rule_id)
            if not row: return None
            for key in ("name", "position", "active", "owner_id"):
                if key in patch: setattr(row, key, patch[key])
            row.version += 1; session.add(AuditRow(actor_id=actor_id, action="Assignment rule changed", target=rule_id, details={key: patch[key] for key in patch if key in {"name", "position", "active"}}, created_at=datetime.now(timezone.utc))); session.commit(); session.refresh(row); return row

    def ordered_rules(self) -> list[RuleRow]:
        with Session(self.engine) as session: return list(session.scalars(select(RuleRow).order_by(RuleRow.position, RuleRow.id)))

    def audit(self, page: int = 1, page_size: int = 25, *, actor: str | None = None, action: str | None = None, target: str | None = None, start: str | None = None, end: str | None = None) -> tuple[list[AuditRow], int]:
        with Session(self.engine) as session:
            query = select(AuditRow)
            if actor: query = query.where(AuditRow.actor_id.ilike(f"%{actor}%"))
            if action: query = query.where(AuditRow.action.ilike(f"%{action}%"))
            if target: query = query.where(AuditRow.target.ilike(f"%{target}%"))
            if start: query = query.where(AuditRow.created_at >= datetime.fromisoformat(start))
            if end: query = query.where(AuditRow.created_at < datetime.fromisoformat(end) + timedelta(days=1))
            filtered = query.order_by(AuditRow.id)
            total = session.scalar(select(func.count()).select_from(filtered.order_by(None).subquery())) or 0
            return list(session.scalars(filtered.offset((page - 1) * page_size).limit(page_size))), total

    def append_audit(self, *, actor_id: str | None, action: str, target: str, details: dict) -> None:
        with Session(self.engine) as session:
            session.add(AuditRow(actor_id=actor_id, action=action, target=target, details=details, created_at=datetime.now(timezone.utc))); session.commit()

    def append_assignment(self, *, bcn: str, actor_id: str, old_owner_id: str | None, new_owner_id: str | None, reason: str) -> None:
        with Session(self.engine) as session:
            session.add(AssignmentHistoryRow(bcn=bcn, actor_id=actor_id, old_owner_id=old_owner_id, new_owner_id=new_owner_id, reason=reason, created_at=datetime.now(timezone.utc))); session.commit()

    def save_run(self, *, submission_id: str, scope: str, result: dict) -> dict:
        with Session(self.engine) as session:
            row = session.get(AssignmentRunRow, submission_id)
            if row: return row.result
            session.add(AssignmentRunRow(submission_id=submission_id, scope=scope, result=result, created_at=datetime.now(timezone.utc))); session.commit(); return result

    def get_run(self, submission_id: str) -> dict | None:
        with Session(self.engine) as session:
            row = session.get(AssignmentRunRow, submission_id)
            return row.result if row else None

    def get_setting(self, key: str) -> dict | None:
        with Session(self.engine) as session:
            row = session.get(AssignmentSettingRow, key)
            return row.value if row else None

    def set_setting(self, key: str, value: dict) -> None:
        with Session(self.engine) as session:
            row = session.get(AssignmentSettingRow, key) or AssignmentSettingRow(key=key, value=value)
            row.value = value; session.add(row); session.commit()
