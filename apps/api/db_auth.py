from datetime import datetime, timedelta, timezone
from hashlib import sha256
from sqlalchemy import Boolean, DateTime, ForeignKey, String, create_engine, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from contextlib import contextmanager
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from secrets import token_urlsafe

class Base(DeclarativeBase): pass

class UserRow(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(16))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    password_hash: Mapped[str] = mapped_column(String(255))

class SessionRow(Base):
    __tablename__ = "sessions"
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

def digest(token: str) -> str:
    return sha256(token.encode()).hexdigest()

def utcnow():
    return datetime.now(timezone.utc)


class StorageError(RuntimeError):
    pass


class AuthDatabase:
    def __init__(self, url: str, *, create_schema: bool = True):
        self.engine = create_engine(url, hide_parameters=True, pool_pre_ping=True)
        if create_schema: Base.metadata.create_all(self.engine)

    @contextmanager
    def transaction(self):
        try:
            with Session(self.engine, expire_on_commit=False) as session:
                with session.begin():
                    yield session
        except IntegrityError as exc:
            if getattr(exc.orig, "sqlstate", None) == "23505" or self.engine.dialect.name == "sqlite":
                raise ValueError("normalized identity already exists") from None
            raise StorageError("Storage operation failed.") from None
        except SQLAlchemyError:
            raise StorageError("Storage operation failed.") from None

    def user_for_session(self, token: str) -> UserRow | None:
        now = utcnow()
        with self.transaction() as session:
            row = session.scalar(select(SessionRow).where(SessionRow.digest == digest(token), SessionRow.revoked_at.is_(None), SessionRow.expires_at > now))
            return session.get(UserRow, row.user_id) if row else None

    def create_user(self, *, user_id: str, name: str, email: str, role: str, password_hash: str) -> UserRow:
        with self.transaction() as session:
            row = UserRow(id=user_id, name=name, email=email.strip().casefold(), role=role, active=True, password_hash=password_hash)
            session.add(row)
            session.flush(); return row

    def user_by_email(self, email: str) -> UserRow | None:
        with self.transaction() as session: return session.scalar(select(UserRow).where(UserRow.email == email.strip().casefold()))

    def all_users(self) -> list[UserRow]:
        with self.transaction() as session: return list(session.scalars(select(UserRow)))

    def update_user(self, user_id: str, changes: dict) -> UserRow | None:
        with self.transaction() as session:
            row = session.get(UserRow, user_id)
            if not row: return None
            if any(key in changes and changes[key] != getattr(row, key) for key in ("role", "active")):
                for token in session.scalars(select(SessionRow).where(SessionRow.user_id == user_id, SessionRow.revoked_at.is_(None))):
                    token.revoked_at = utcnow()
            for key in ("name", "role", "active"):
                if key in changes: setattr(row, key, changes[key])
            session.flush(); return row

    def revoke_user_sessions(self, user_id: str) -> None:
        with self.transaction() as session:
            for token in session.scalars(select(SessionRow).where(SessionRow.user_id == user_id, SessionRow.revoked_at.is_(None))): token.revoked_at = utcnow()

    def issue(self, user_id: str, lifetime: int = 8 * 60 * 60) -> tuple[str, datetime]:
        token = token_urlsafe(32); now = utcnow(); expires = now + timedelta(seconds=lifetime)
        with self.transaction() as session:
            session.add(SessionRow(digest=digest(token), user_id=user_id, issued_at=now, expires_at=expires))
        return token, expires

    def revoke(self, token: str) -> None:
        with self.transaction() as session:
            row = session.get(SessionRow, digest(token))
            if row: row.revoked_at = utcnow()

    def reset_password(self, user_id: str, password_hash: str) -> UserRow | None:
        with self.transaction() as session:
            row = session.get(UserRow, user_id)
            if not row: return None
            row.password_hash = password_hash
            for token in session.scalars(select(SessionRow).where(SessionRow.user_id == user_id, SessionRow.revoked_at.is_(None))): token.revoked_at = utcnow()
            session.flush(); return row
