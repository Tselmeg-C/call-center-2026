from datetime import datetime, timezone
from hashlib import sha256
from sqlalchemy import Boolean, DateTime, ForeignKey, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

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

    def revoke(self, token: str) -> None:
        with Session(self.engine) as session:
            row = session.get(SessionRow, digest(token))
            if row: row.revoked_at = datetime.now(timezone.utc); session.commit()
