"""Shared login-failure counters for CALL_CENTER_STORAGE=postgres, so the 5/email+IP and 50/IP,
15-minute throttle (apps/api/main.py's login()) is enforced across every API replica instead of
just the process that saw the attempt. Append-only event table + sliding-window COUNT(*), mirroring
the in-memory list-filtering logic memory mode still uses -- no atomic incr-with-TTL primitive
needed. Follows db_auth.py's plain-SQLAlchemy-table style: no new ORM/repository layer.
"""
from datetime import datetime, timedelta
from sqlalchemy import DateTime, Index, Integer, String, create_engine, delete, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


class Base(DeclarativeBase): pass


class LoginFailureEventRow(Base):
    __tablename__ = "login_failure_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(254))
    ip: Mapped[str] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        Index("ix_login_failure_events_ip_occurred", "ip", "occurred_at"),
        Index("ix_login_failure_events_email_ip_occurred", "email", "ip", "occurred_at"),
    )


class LoginThrottleStore:
    def __init__(self, url: str, *, create_schema: bool = True):
        self.engine = create_engine(url, hide_parameters=True, pool_pre_ping=True)
        if create_schema: Base.metadata.create_all(self.engine)

    def counts(self, email: str, ip: str, now: datetime, window: timedelta) -> tuple[int, int]:
        """(email+ip count, ip count) of failures within the trailing `window`."""
        cutoff = now - window
        with Session(self.engine) as session:
            email_ip = session.scalar(select(func.count()).select_from(LoginFailureEventRow).where(LoginFailureEventRow.email == email, LoginFailureEventRow.ip == ip, LoginFailureEventRow.occurred_at > cutoff))
            by_ip = session.scalar(select(func.count()).select_from(LoginFailureEventRow).where(LoginFailureEventRow.ip == ip, LoginFailureEventRow.occurred_at > cutoff))
        return email_ip, by_ip

    def record_failure(self, email: str, ip: str, now: datetime, window: timedelta) -> None:
        """Insert this failure and delete rows that have aged out of the window, in one
        transaction -- the write-time prune that keeps the table bounded without a cron job."""
        cutoff = now - window
        with Session(self.engine) as session, session.begin():
            session.execute(delete(LoginFailureEventRow).where(LoginFailureEventRow.occurred_at < cutoff))
            session.add(LoginFailureEventRow(email=email, ip=ip, occurred_at=now))

    def clear(self, email: str, ip: str) -> None:
        """Mirrors repo.login_failures.pop(key, None) on successful login -- clears only the
        email+IP key, not the by-IP store (existing asymmetry, carried forward as-is)."""
        with Session(self.engine) as session, session.begin():
            session.execute(delete(LoginFailureEventRow).where(LoginFailureEventRow.email == email, LoginFailureEventRow.ip == ip))
