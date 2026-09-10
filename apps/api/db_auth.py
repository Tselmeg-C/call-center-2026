from datetime import datetime, timedelta, timezone
from hashlib import sha256
from sqlalchemy import Boolean, DateTime, ForeignKey, String, create_engine, select
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

class AuthDatabase:
    def __init__(self, url: str):
        self.engine = create_engine(url)
        Base.metadata.create_all(self.engine)

    def user_for_session(self, token: str) -> UserRow | None:
        now = datetime.now(timezone.utc)
        with Session(self.engine) as session:
            row = session.scalar(select(SessionRow).where(SessionRow.digest == digest(token), SessionRow.revoked_at.is_(None), SessionRow.expires_at > now))
            return session.get(UserRow, row.user_id) if row else None

    def create_user(self, *, user_id: str, name: str, email: str, role: str, password_hash: str) -> UserRow:
        with Session(self.engine) as session:
            row = UserRow(id=user_id, name=name, email=email, role=role, active=True, password_hash=password_hash)
            session.add(row); session.commit(); session.refresh(row); return row

    def user_by_email(self, email: str) -> UserRow | None:
        with Session(self.engine) as session: return session.scalar(select(UserRow).where(UserRow.email == email))

    def issue(self, user_id: str, lifetime: int = 8 * 60 * 60) -> tuple[str, datetime]:
        token = token_urlsafe(32); now = datetime.now(timezone.utc); expires = now + timedelta(seconds=lifetime)
        with Session(self.engine) as session:
            session.add(SessionRow(digest=digest(token), user_id=user_id, issued_at=now, expires_at=expires)); session.commit()
        return token, expires

    def revoke(self, token: str) -> None:
        with Session(self.engine) as session:
            row = session.get(SessionRow, digest(token))
            if row: row.revoked_at = datetime.now(timezone.utc); session.commit()
