from datetime import datetime, timedelta, timezone
from hashlib import sha256
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, create_engine, func, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool
from .db_customers import CustomerRow
from .db_auth import StorageError, UserRow, SessionRow

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
    __table_args__ = (UniqueConstraint("actor_id", "submission_id", name="uq_assignment_actor_submission"),)
    actor_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    submission_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    scope: Mapped[str] = mapped_column(String(32)); fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True); result: Mapped[dict] = mapped_column(JSON); created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

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

    def update_rule(self, rule_id: str, patch: dict, actor_id: str, expected_version: int) -> RuleRow | None:
        try:
            with Session(self.engine, expire_on_commit=False) as session, session.begin():
                row = session.get(RuleRow, rule_id)
                if not row: return None
                changed = session.execute(update(AssignmentSettingRow).where(AssignmentSettingRow.key == "assignment_version", AssignmentSettingRow.value["value"].as_integer() == expected_version).values(value={"value": expected_version + 1}))
                if changed.rowcount != 1: raise ValueError("Assignment configuration is stale.")
                for key in ("name", "position", "active", "owner_id"):
                    if key in patch: setattr(row, key, patch[key])
                row.version += 1
                session.add(AuditRow(actor_id=actor_id, action="Assignment rule changed", target=rule_id, details={key: patch[key] for key in patch if key in {"name", "position", "active"}}, created_at=datetime.now(timezone.utc)))
            return row
        except IntegrityError:
            raise ValueError("Rule already exists.") from None
        except SQLAlchemyError:
            raise StorageError("Storage operation failed.") from None

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

    def save_run(self, *, actor_id: str, submission_id: str, scope: str, result: dict, payload: str | None = None) -> dict:
        digest = sha256(payload.encode()).hexdigest() if payload is not None else None
        with Session(self.engine) as session:
            row = session.get(AssignmentRunRow, (actor_id, submission_id))
            if row:
                if digest is not None and row.fingerprint not in (None, digest): raise ValueError("submission already used")
                return row.result
            session.add(AssignmentRunRow(actor_id=actor_id, submission_id=submission_id, scope=scope, fingerprint=digest, result=result, created_at=datetime.now(timezone.utc)))
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                row = session.get(AssignmentRunRow, (actor_id, submission_id))
                if row is not None:
                    if digest is not None and row.fingerprint not in (None, digest): raise ValueError("submission already used")
                    return row.result
                raise
            return result

    def run_bulk(self, *, actor_id: str, submission_id: str, scope: str, owner_id: str | None) -> tuple[dict, list[dict]]:
        try:
            with Session(self.engine) as session, session.begin():
                run = AssignmentRunRow(actor_id=actor_id, submission_id=submission_id, scope=scope, fingerprint=sha256(scope.encode()).hexdigest(), result={}, created_at=datetime.now(timezone.utc))
                session.add(run)
                # The unique run key serializes retries before any customer mutation.
                session.flush()
                query = select(CustomerRow).where(CustomerRow.status == "Open")
                if scope == "unassigned": query = query.where(CustomerRow.owner_id.is_(None))
                rows = list(session.scalars(query.order_by(CustomerRow.bcn).with_for_update()))
                changes = []
                for row in rows:
                    if owner_id is None or row.owner_id == owner_id: continue
                    old_owner = row.owner_id
                    row.owner_id = owner_id; row.version += 1
                    changes.append({"bcn": row.bcn, "ownerId": owner_id, "version": row.version})
                    session.add(AssignmentHistoryRow(bcn=row.bcn, actor_id=actor_id, old_owner_id=old_owner, new_owner_id=owner_id, reason="Bulk assignment", created_at=run.created_at))
                    session.add(AuditRow(actor_id=actor_id, action="Customer assigned", target=row.bcn, details={"oldOwner": old_owner, "newOwner": owner_id, "source": "bulk"}, created_at=run.created_at))
                result = {"submissionId": submission_id, "scope": scope, "candidates": len(rows), "assigned": len(changes), "skipped": len(rows) - len(changes)}
                run.result = result
            return result, changes
        except IntegrityError:
            persisted = self.get_run(actor_id, submission_id, scope)
            if persisted is not None: return persisted, []
            raise StorageError("Storage operation failed.") from None
        except SQLAlchemyError:
            raise StorageError("Storage operation failed.") from None

    def update_identity(self, user_id: str, changes: dict, actor_id: str) -> tuple[dict, list[dict]] | None:
        try:
            with Session(self.engine) as session, session.begin():
                user = session.scalar(select(UserRow).where(UserRow.id == user_id).with_for_update())
                if user is None: return None
                was_sales = user.active and user.role == "Sales"
                now = datetime.now(timezone.utc)
                if any(key in changes and changes[key] != getattr(user, key) for key in ("role", "active")):
                    for token in session.scalars(select(SessionRow).where(SessionRow.user_id == user_id, SessionRow.revoked_at.is_(None))):
                        token.revoked_at = now
                for key in ("name", "role", "active"):
                    if key in changes: setattr(user, key, changes[key])
                released = []
                if was_sales and (not user.active or user.role != "Sales"):
                    rows = session.scalars(select(CustomerRow).where(CustomerRow.owner_id == user_id, CustomerRow.status == "Open").order_by(CustomerRow.bcn).with_for_update())
                    for row in rows:
                        row.owner_id = None; row.version += 1
                        released.append({"bcn": row.bcn, "version": row.version})
                        session.add(AssignmentHistoryRow(bcn=row.bcn, actor_id=actor_id, old_owner_id=user_id, new_owner_id=None, reason="Owner deactivated", created_at=now))
                        session.add(AuditRow(actor_id=actor_id, action="Customer ownership released", target=row.bcn, details={"oldOwner": user_id, "newOwner": None, "reason": "Owner deactivated"}, created_at=now))
                session.add(AuditRow(actor_id=actor_id, action="User changed", target=user_id, details={key: changes[key] for key in ("name", "role", "active") if key in changes}, created_at=now))
                result = {key: getattr(user, key) for key in ("id", "name", "email", "role", "active")}
            return result, released
        except SQLAlchemyError:
            raise StorageError("Storage operation failed.") from None

    def assign_manual(self, *, bcn: str, owner_id: str | None, expected_version: int | None, actor_id: str) -> dict | None:
        try:
            with Session(self.engine) as session, session.begin():
                row = session.scalar(select(CustomerRow).where(CustomerRow.bcn == bcn).with_for_update())
                if row is None: return None
                if expected_version is not None and row.version != expected_version:
                    raise ValueError("Customer version is stale.")
                old_owner = row.owner_id
                now = datetime.now(timezone.utc)
                if old_owner != owner_id:
                    row.owner_id = owner_id; row.version += 1
                    session.add(AssignmentHistoryRow(bcn=bcn, actor_id=actor_id, old_owner_id=old_owner, new_owner_id=owner_id, reason="Manual assignment", created_at=now))
                    session.add(AuditRow(actor_id=actor_id, action="Customer assigned", target=bcn, details={"oldOwner": old_owner, "newOwner": owner_id}, created_at=now))
                result = {"oldOwner": old_owner, "ownerId": row.owner_id, "version": row.version, "timestamp": now.isoformat()}
            return result
        except SQLAlchemyError:
            raise StorageError("Storage operation failed.") from None

    def get_run(self, actor_id: str, submission_id: str, payload: str | None = None) -> dict | None:
        with Session(self.engine) as session:
            row = session.get(AssignmentRunRow, (actor_id, submission_id))
            if row and payload is not None and row.fingerprint not in (None, sha256(payload.encode()).hexdigest()): raise ValueError("submission already used")
            return row.result if row else None

    def get_setting(self, key: str) -> dict | None:
        with Session(self.engine) as session:
            row = session.get(AssignmentSettingRow, key)
            return row.value if row else None

    def set_setting(self, key: str, value: dict) -> None:
        with Session(self.engine) as session:
            row = session.get(AssignmentSettingRow, key) or AssignmentSettingRow(key=key, value=value)
            row.value = value; session.add(row); session.commit()
