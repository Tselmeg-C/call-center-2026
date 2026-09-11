from datetime import datetime, timezone
from sqlalchemy import JSON, ForeignKey, Integer, String, DateTime, UniqueConstraint, create_engine, select, func, or_
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool

class CustomerBase(DeclarativeBase): pass

class CustomerRow(CustomerBase):
    __tablename__ = "customers"
    bcn: Mapped[str] = mapped_column(String(128), primary_key=True)
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
    primary: Mapped[bool] = mapped_column("is_primary", default=False)

class ImportJobRow(CustomerBase):
    __tablename__ = "import_jobs"
    __table_args__ = (UniqueConstraint("actor_id", "submission_id", name="uq_import_actor_submission"),)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    submission_id: Mapped[str] = mapped_column(String(120))
    actor_id: Mapped[str] = mapped_column(String(120))
    filename: Mapped[str] = mapped_column(String(255))
    processed: Mapped[int] = mapped_column(Integer)
    created: Mapped[int] = mapped_column(Integer)
    updated: Mapped[int] = mapped_column(Integer)
    error_rows: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class ImportErrorRow(CustomerBase):
    __tablename__ = "import_row_errors"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(120), ForeignKey("import_jobs.id", ondelete="CASCADE"))
    row_number: Mapped[int] = mapped_column(Integer)
    field: Mapped[str] = mapped_column(String(120))
    reason: Mapped[str] = mapped_column(String(255))

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
            existing = session.scalars(select(PhoneRow).where(PhoneRow.bcn == bcn, PhoneRow.primary.is_(True))).first()
            if primary_phone:
                if existing: existing.phone = primary_phone
                else: session.add(PhoneRow(bcn=bcn, phone=primary_phone, primary=True))
            elif existing:
                session.delete(existing)
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

    def all_with_phones(self) -> list[tuple[CustomerRow, list[str]]]:
        with Session(self.engine) as session:
            rows = list(session.scalars(select(CustomerRow).order_by(CustomerRow.bcn)))
            phones = {}
            for row in session.scalars(select(PhoneRow).order_by(PhoneRow.id)): phones.setdefault(row.bcn, []).append(row.phone)
            return [(row, phones.get(row.bcn, [])) for row in rows]

    def search(self, *, page: int, page_size: int, owner_id: str | None = None, unassigned: bool = False, status: str | None = None, query: str = "") -> tuple[list[tuple[CustomerRow, list[str]]], int]:
        with Session(self.engine) as session:
            statement = select(CustomerRow)
            count = select(func.count()).select_from(CustomerRow)
            conditions = []
            if owner_id is not None: conditions.append(CustomerRow.owner_id == owner_id)
            if unassigned: conditions.append(CustomerRow.owner_id.is_(None))
            if status is not None: conditions.append(CustomerRow.status == status)
            if query:
                needle = f"%{query.casefold()}%"
                phone_match = select(PhoneRow.bcn).where(PhoneRow.phone.ilike(needle))
                conditions.append(or_(func.lower(CustomerRow.bcn).like(needle), func.lower(CustomerRow.name).like(needle), CustomerRow.bcn.in_(phone_match)))
            if conditions:
                statement = statement.where(*conditions); count = count.where(*conditions)
            total = session.scalar(count) or 0
            rows = list(session.scalars(statement.order_by(CustomerRow.bcn).offset((page - 1) * page_size).limit(page_size)))
            phones = {}
            for row in session.scalars(select(PhoneRow).where(PhoneRow.bcn.in_([item.bcn for item in rows])).order_by(PhoneRow.id)): phones.setdefault(row.bcn, []).append(row.phone)
            return [(row, phones.get(row.bcn, [])) for row in rows], total

    def open_owned(self, owner_id: str) -> list[tuple[CustomerRow, list[str]]]:
        with Session(self.engine) as session:
            rows = list(session.scalars(select(CustomerRow).where(CustomerRow.owner_id == owner_id, CustomerRow.status == "Open").order_by(CustomerRow.bcn)))
            phones = {}
            for phone in session.scalars(select(PhoneRow).where(PhoneRow.bcn.in_([row.bcn for row in rows])).order_by(PhoneRow.id)): phones.setdefault(phone.bcn, []).append(phone.phone)
            return [(row, phones.get(row.bcn, [])) for row in rows]

    def owner_counts(self) -> list[tuple[str | None, str, int]]:
        with Session(self.engine) as session:
            return list(session.execute(select(CustomerRow.owner_id, CustomerRow.status, func.count(CustomerRow.bcn)).group_by(CustomerRow.owner_id, CustomerRow.status)))

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

    def release_open_owner(self, owner_id: str) -> None:
        with Session(self.engine) as session:
            rows = session.scalars(select(CustomerRow).where(CustomerRow.owner_id == owner_id, CustomerRow.status == "Open")).all()
            for row in rows: row.owner_id = None; row.version += 1
            session.commit()

    def import_job(self, actor_id: str, submission_id: str) -> dict | None:
        with Session(self.engine) as session:
            row = session.scalar(select(ImportJobRow).where(ImportJobRow.actor_id == actor_id, ImportJobRow.submission_id == submission_id))
            if row is None:
                return None
            errors = session.scalars(select(ImportErrorRow).where(ImportErrorRow.job_id == row.id).order_by(ImportErrorRow.id))
            return {"jobId": row.id, "submissionId": row.submission_id, "filename": row.filename, "completedAt": row.created_at.isoformat(), "status": row.status, "created": row.created, "updated": row.updated, "processed": row.processed, "errorRows": row.error_rows, "errors": [{"row": item.row_number, "field": item.field, "reason": item.reason} for item in errors], "actorId": row.actor_id}

    def save_import_job(self, result: dict) -> None:
        with Session(self.engine) as session:
            if session.scalar(select(ImportJobRow).where(ImportJobRow.actor_id == result["actorId"], ImportJobRow.submission_id == result["submissionId"])):
                return
            job = ImportJobRow(id=result["jobId"], submission_id=result["submissionId"], actor_id=result["actorId"], filename=result["filename"], processed=result["processed"], created=result["created"], updated=result["updated"], error_rows=result["errorRows"], status=result["status"], created_at=datetime.now(timezone.utc))
            session.add(job); session.flush()
            session.add_all(ImportErrorRow(job_id=job.id, row_number=item["row"], field=item["field"], reason=item["reason"]) for item in result["errors"])
            session.commit()

    def ingest_sources(self, records: list[dict], result: dict) -> None:
        """Commit source rows, phones, import summary, and row errors together."""
        with Session(self.engine) as session:
            for record in records:
                row = session.get(CustomerRow, record["bcn"])
                if row is None:
                    row = CustomerRow(bcn=record["bcn"], name=record["name"] or record["bcn"], status="Open", source={})
                    session.add(row)
                row.name = record["name"] or row.name
                row.source = record["source"]
                phone = record.get("primary_phone")
                existing = session.scalars(select(PhoneRow).where(PhoneRow.bcn == record["bcn"], PhoneRow.primary.is_(True))).first()
                if phone:
                    if existing: existing.phone = phone
                    else: session.add(PhoneRow(bcn=record["bcn"], phone=phone, primary=True))
                elif existing:
                    session.delete(existing)
            job = ImportJobRow(id=result["jobId"], submission_id=result["submissionId"], actor_id=result["actorId"], filename=result["filename"], processed=result["processed"], created=result["created"], updated=result["updated"], error_rows=result["errorRows"], status=result["status"], created_at=datetime.now(timezone.utc))
            session.add(job); session.flush()
            session.add_all(ImportErrorRow(job_id=job.id, row_number=item["row"], field=item["field"], reason=item["reason"]) for item in result["errors"])
            session.commit()
