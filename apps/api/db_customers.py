from sqlalchemy import JSON, ForeignKey, Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool

class CustomerBase(DeclarativeBase): pass

class CustomerRow(CustomerBase):
    __tablename__ = "customers"
    bcn: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="Open")
    owner_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=0)

class PhoneRow(CustomerBase):
    __tablename__ = "customer_phones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bcn: Mapped[str] = mapped_column(ForeignKey("customers.bcn", ondelete="CASCADE"))
    phone: Mapped[str] = mapped_column(String(64))
    primary: Mapped[bool] = mapped_column(default=False)

class CustomerDatabase:
    def __init__(self, url: str, *, create_schema: bool = True):
        options = {"connect_args": {"check_same_thread": False}, "poolclass": StaticPool} if ":memory:" in url else {}
        self.engine = create_engine(url, **options)
        if create_schema: CustomerBase.metadata.create_all(self.engine)

    def upsert_source(self, *, bcn: str, name: str, source: dict, primary_phone: str | None = None) -> CustomerRow:
        with Session(self.engine) as session:
            row = session.get(CustomerRow, bcn)
            if row is None: row = CustomerRow(bcn=bcn, name=name or bcn, status="Open", source={}); session.add(row)
            row.name = name or row.name; row.source = source
            if primary_phone is not None:
                existing = session.scalars(select(PhoneRow).where(PhoneRow.bcn == bcn, PhoneRow.primary.is_(True))).first()
                if existing: existing.phone = primary_phone
                else: session.add(PhoneRow(bcn=bcn, phone=primary_phone, primary=True))
            session.commit(); session.refresh(row); return row

    def upsert_sources(self, records: list[dict]) -> None:
        with Session(self.engine) as session:
            for record in records:
                row = session.get(CustomerRow, record["bcn"])
                if row is None: row = CustomerRow(bcn=record["bcn"], name=record["name"] or record["bcn"], status="Open", source={}); session.add(row)
                row.name = record["name"] or row.name; row.source = record["source"]
                phone = record.get("primary_phone")
                existing = session.scalars(select(PhoneRow).where(PhoneRow.bcn == record["bcn"], PhoneRow.primary.is_(True))).first()
                if phone:
                    if existing: existing.phone = phone
                    else: session.add(PhoneRow(bcn=record["bcn"], phone=phone, primary=True))
                elif existing:
                    session.delete(existing)
            session.commit()

    def all(self) -> list[CustomerRow]:
        with Session(self.engine) as session: return list(session.scalars(select(CustomerRow).order_by(CustomerRow.bcn)))

    def get(self, bcn: str) -> CustomerRow | None:
        with Session(self.engine) as session: return session.get(CustomerRow, bcn)

    def phones(self, bcn: str) -> list[str]:
        with Session(self.engine) as session: return list(session.scalars(select(PhoneRow.phone).where(PhoneRow.bcn == bcn).order_by(PhoneRow.id)))

    def save_operational(self, *, bcn: str, owner_id: str | None, status: str, version: int) -> None:
        with Session(self.engine) as session:
            row = session.get(CustomerRow, bcn)
            if row:
                row.owner_id, row.status, row.version = owner_id, status, version
                session.commit()
